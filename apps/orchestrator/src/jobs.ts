import { nanoid } from "nanoid";
import path from "node:path";
import {
  DEFAULT_LIBRARY_ID,
  DEFAULT_OUTPUT_SIZE_IDS,
  assemblyRecipeTotalSeconds,
  assemblySceneFrames,
  cellNeedsVariantGen,
  ensureSceneSlots,
  estimateQueueJobSeconds,
  formatSceneSlotsSummary,
  genDimsForSize,
  isPlateReady,
  normalizeAssemblyRecipe,
  outputPathCellKey,
  resolveMatrixCell,
  resolveOutputSizes,
  type Campaign,
  type Copy,
  type Job,
  type LibraryItem,
  type MatrixCell,
  type OutputSize,
  type RemotionProps,
  type RetiredMatrixCell,
  type SceneMediaItem,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import { runComfyJob } from "./comfyAdapter.js";
import {
  attachJobControl,
  assertJobNotCancelled,
  finishJobControl,
  isCancelledError,
  setJobComfyPromptId,
} from "./jobControl.js";
import { lookupPlateCache, putPlateCache } from "./plateCache.js";
import { buildPromptPack, pickVariantKnob } from "./promptPack.js";
import { filterLibraryForCampaign } from "./policy.js";
import { renderAd } from "./render.js";
import { resolveDataMediaPath } from "./mediaPaths.js";
import {
  campaignOutputPath,
  getCampaign,
  getJob,
  getTokens,
  libraryAbsolutePath,
  listLibrary,
  saveCampaign,
  updateCampaign,
  upsertJob,
} from "./store.js";

export type AssembleCopyPlate = {
  id: string;
  label: string;
  copy: Copy;
};

export type BatchOpts = {
  cellIds?: string[];
  /**
   * Skip cell Comfy before assemble. Default true — use library plates + any
   * existing sizeAssets.genPath from Generate variants.
   */
  skipComfy?: boolean;
  /** Re-run Comfy even if genPath already exists */
  forceRegen?: boolean;
  /**
   * Copy plate IDs to append at Remotion assemble (cartesian with cells).
   * Omit / empty → all activated ready copy plates; if none, use each cell's baked copy.
   */
  copyIds?: string[];
  /** Limit Remotion jobs to these size ids (default: all campaign sizes). */
  sizeIds?: string[];
  /**
   * Only queue cell×size pairs that still lack preview (preview stage) or
   * final output (render stage). Reuses existing Comfy genPath — no re-gen.
   */
  onlyMissing?: boolean;
};

/**
 * Align sizeAssets to campaign.outputSizes.
 * Do NOT copy genPath across different aspects — Remotion crops; Comfy must
 * generate each aspect separately.
 */
export function syncCampaignSizeAssets(campaign: Campaign): void {
  const sizes = campaignSizes(campaign);
  const pools: Array<{ sizeAssets: Campaign["matrix"]["cells"][number]["sizeAssets"] }> = [
    ...campaign.matrix.cells,
    ...(campaign.matrix.retired ?? []),
  ];
  for (const cell of pools) {
    const existing = new Map((cell.sizeAssets || []).map((a) => [a.sizeId, a]));
    cell.sizeAssets = sizes.map((s) => {
      const prev = existing.get(s.id);
      if (prev) {
        prev.width = s.width;
        prev.height = s.height;
        prev.aspect = s.aspect;
        if (prev.promptHash === undefined) prev.promptHash = null;
        // Drop inherited cross-aspect gens (same path as a different aspect)
        if (prev.genPath?.trim()) {
          const sharedWrong = [...existing.values()].some(
            (o) =>
              o.sizeId !== s.id &&
              o.aspect !== s.aspect &&
              o.genPath === prev.genPath,
          );
          if (sharedWrong) {
            prev.genPath = null;
            prev.promptHash = null;
            if (prev.status !== "failed") prev.status = "pending";
          }
        }
        return prev;
      }
      return {
        sizeId: s.id,
        width: s.width,
        height: s.height,
        aspect: s.aspect,
        previewPath: null,
        outputPath: null,
        genPath: null,
        promptHash: null,
        status: "pending" as const,
        error: null,
      };
    });
  }
}

/** Soft gate: cell has at least one Comfy variant plate ready to assemble. */
export function cellHasVariantReady(
  cell: Campaign["matrix"]["cells"][number],
): boolean {
  return (cell.sizeAssets ?? []).some(
    (a) => Boolean(a.genPath?.trim()) && a.status !== "failed",
  );
}

function assetNeedsAssemble(
  cell: Campaign["matrix"]["cells"][number],
  sizeId: string,
  _stage: "preview" | "render",
): boolean {
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  // Single hi-res assemble: need master outputPath (previewPath alone is not enough)
  return !asset?.outputPath?.trim();
}

/** Normalize legacy "preview" stage to hi-res assemble (same as render). */
function assembleStage(
  stage: "preview" | "render",
): "render" {
  return "render";
}

/** True when this size needs its own Comfy pass (missing or shared wrong-aspect gen). */
export function sizeNeedsComfyGen(
  cell: Campaign["matrix"]["cells"][number],
  size: OutputSize,
): boolean {
  if (!cellNeedsVariantGen(cell)) return false;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === size.id);
  if (!asset?.genPath?.trim()) return true;
  return (cell.sizeAssets ?? []).some(
    (a) =>
      a.sizeId !== size.id &&
      a.aspect !== size.aspect &&
      a.genPath === asset.genPath,
  );
}

/** Active ready copy plates for assemble — never a Comfy / generate axis. */
export function resolveAssembleCopyPlates(
  campaign: Campaign,
  lib: LibraryItem[],
  copyIds?: string[],
): AssembleCopyPlate[] {
  const active = filterLibraryForCampaign(campaign, lib).filter(
    (i) => i.kind === "copy" && isPlateReady(i) && i.copy,
  );
  const wanted = copyIds?.filter((id) => id?.trim()) ?? [];
  const picked = wanted.length
    ? active.filter((i) => wanted.includes(i.id))
    : active;
  return picked.map((i) => ({
    id: i.id,
    label: i.label,
    copy: i.copy!,
  }));
}

/** Resolve a Comfy genPath (absolute or under data/) for Remotion. */
function resolveMediaPath(p: string): string {
  return resolveDataMediaPath(p);
}

function requireResolvedCell(campaign: Campaign, ref: string) {
  const resolved = resolveMatrixCell(campaign, ref);
  if (!resolved) throw new Error(`Unknown cell ref ${ref}`);
  return resolved;
}

function patchResolvedCell(
  campaign: Campaign,
  ref: string,
  patch: (cell: MatrixCell | RetiredMatrixCell) => void,
): void {
  const resolved = requireResolvedCell(campaign, ref);
  if (resolved.pool === "live") {
    patch(campaign.matrix.cells[resolved.index]!);
  } else {
    if (!campaign.matrix.retired) campaign.matrix.retired = [];
    patch(campaign.matrix.retired[resolved.index]!);
  }
}

/**
 * Assemble slots: talent + hands from library, overridden by cell variant media.
 * attire/background/prop Comfy stills feed the talent slot (face-protect plate);
 * hands/prop-as-hands knob feeds the hands slot.
 * `cellRef` may be a live cellId or archive:<archiveId>.
 */
async function buildProps(
  campaign: Campaign,
  cellRef: string,
  size: OutputSize,
  copyOverride?: Copy | null,
): Promise<RemotionProps> {
  const { cell } = requireResolvedCell(campaign, cellRef);
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const talent = lib.find((i) => i.id === cell.talentTakeId);
  if (!talent) throw new Error("Missing talent library item for cell");
  const hands = cell.handsId
    ? lib.find((i) => i.id === cell.handsId) ?? null
    : null;

  const tokens = await getTokens(cell.designTokenPackId);
  const knob = pickVariantKnob(cell, campaign);
  const asset =
    cell.sizeAssets?.find((a) => a.sizeId === size.id) ||
    cell.sizeAssets?.find((a) => a.genPath);
  const genPath = asset?.genPath?.trim() ? resolveMediaPath(asset.genPath) : null;

  let talentVideoSrc = libraryAbsolutePath(talent);
  // No hands plate → punchline reuses talent (or BG/attire gen still)
  let handsVideoSrc = hands ? libraryAbsolutePath(hands) : talentVideoSrc;
  if (genPath) {
    if (knob === "attire" || knob === "background") {
      talentVideoSrc = genPath;
      if (!hands) handsVideoSrc = genPath;
    } else {
      // hands | prop → punchline / product plate
      handsVideoSrc = genPath;
    }
  }

  const assemblyRecipe = normalizeAssemblyRecipe(campaign.assemblyRecipe);
  const slots = ensureSceneSlots(cell, assemblyRecipe);
  const sceneFrames = assemblySceneFrames(assemblyRecipe, 30);
  const totalSec = assemblyRecipeTotalSeconds(assemblyRecipe);

  const mediaKind = (src: string): "video" | "still" =>
    /\.(png|jpe?g|webp|gif)$/i.test(src) ? "still" : "video";

  const sceneMedia: SceneMediaItem[] = slots.map((slot) => {
    if (slot.source === "endcard") {
      return { sceneId: slot.sceneId, src: "", kind: "endcard" };
    }
    let src = "";
    if (slot.source === "talent") src = talentVideoSrc;
    else if (slot.source === "hands") src = handsVideoSrc;
    else if (slot.source === "gen") src = genPath || "";
    return {
      sceneId: slot.sceneId,
      src,
      kind: src ? mediaKind(src) : "video",
    };
  });

  console.log(
    `[assemble] recipe ${campaign.id} · ${sceneFrames.length} scenes · ${totalSec}s · ${formatSceneSlotsSummary(slots)} · ${sceneFrames
      .map((s) => `${s.label}=${s.frames}f`)
      .join(", ")}`,
  );

  return {
    talentVideoSrc,
    handsVideoSrc,
    motionToken: cell.motionToken || "none",
    copy: copyOverride ?? cell.copy,
    designTokens: tokens,
    width: size.width,
    height: size.height,
    sizeId: size.id,
    aspect: size.aspect,
    assemblyRecipe,
    sceneMedia,
  };
}

/** Talent required for assemble; hands only when the cell pins one. BG/attire/prop are Comfy refs. */
export async function assertIngredientPlatesReady(
  campaign: Campaign,
  cellIds: string[],
): Promise<void> {
  if (!campaign.ingredientSet?.requireReadyMedia) return;
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const byId = new Map(lib.map((i) => [i.id, i]));
  const missing: string[] = [];

  for (const cellRef of cellIds) {
    const resolved = resolveMatrixCell(campaign, cellRef);
    if (!resolved) continue;
    const cell = resolved.cell;
    const ids = [cell.talentTakeId, cell.handsId].filter((x): x is string =>
      Boolean(x && String(x).trim()),
    );
    for (const id of ids) {
      const item = byId.get(id);
      if (!item || !isPlateReady(item)) {
        missing.push(`${id} (cell ${cellRef})`);
      }
    }
  }

  if (missing.length) {
    const uniq = [...new Set(missing)];
    throw new Error(
      `Missing ready plates: ${uniq.join(", ")}. Upload on Ingredients, then assemble.`,
    );
  }
}

/** Talent plate required as face lock for variant Comfy. */
export async function assertTalentReadyForVariants(
  campaign: Campaign,
  cellIds: string[],
): Promise<void> {
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const byId = new Map(lib.map((i) => [i.id, i]));
  const missing: string[] = [];
  for (const cellId of cellIds) {
    const cell = campaign.matrix.cells.find((c) => c.cellId === cellId);
    if (!cell || !cellNeedsVariantGen(cell)) continue;
    const talent = byId.get(cell.talentTakeId);
    if (!talent || !isPlateReady(talent)) {
      missing.push(`${cell.talentTakeId} (cell ${cellId})`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Variant gen needs a ready talent take: ${[...new Set(missing)].join(", ")}.`,
    );
  }
}

function campaignSizes(campaign: Campaign): OutputSize[] {
  return campaign.outputSizes?.length
    ? campaign.outputSizes
    : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);
}

function touchJob(job: Job, patch: Partial<Job>) {
  return upsertJob({
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function markJobCancelledOrFailed(job: Job, err: unknown, signal?: AbortSignal) {
  if (
    isCancelledError(err) ||
    signal?.aborted ||
    getJob(job.id)?.status === "cancelled"
  ) {
    if (getJob(job.id)?.status !== "cancelled") {
      touchJob(job, {
        status: "cancelled",
        message: "Cancelled — tokens saved where possible",
        progress: 1,
      });
    }
    finishJobControl(job.id);
    return;
  }
  touchJob(job, {
    status: "failed",
    progress: 1,
    message: err instanceof Error ? err.message : String(err),
  });
  finishJobControl(job.id);
}

function ensureSizeAssets(campaign: Campaign, cellRef: string) {
  const sizes = campaignSizes(campaign);
  patchResolvedCell(campaign, cellRef, (cell) => {
    const existing = new Map((cell.sizeAssets || []).map((a) => [a.sizeId, a]));
    cell.sizeAssets = sizes.map((s) => {
      const prev = existing.get(s.id);
      if (prev) {
        if (prev.promptHash === undefined) prev.promptHash = null;
        prev.width = s.width;
        prev.height = s.height;
        prev.aspect = s.aspect;
        return prev;
      }
      return {
        sizeId: s.id,
        width: s.width,
        height: s.height,
        aspect: s.aspect,
        previewPath: null,
        outputPath: null,
        genPath: null,
        promptHash: null,
        status: "pending" as const,
        error: null,
      };
    });
  });
}

/** Write genPath onto one size only (each aspect needs its own Comfy pass). */
function applyGenPathToSize(
  cell: Campaign["matrix"]["cells"][number],
  sizeId: string,
  assetPath: string,
  promptHash: string,
) {
  const a = cell.sizeAssets.find((x) => x.sizeId === sizeId);
  if (!a) return;
  a.genPath = assetPath;
  a.promptHash = promptHash;
  if (a.status === "failed") a.status = "pending";
  a.error = null;
}

async function runComfyForCellSize(
  campaign: Campaign,
  cellId: string,
  size: OutputSize,
  forceRegen: boolean,
  onProgress?: (progress: number, message: string) => void,
  control?: { signal?: AbortSignal; jobId?: string },
): Promise<{ assetPath: string; lineage: Record<string, unknown> } | null> {
  const cell = campaign.matrix.cells.find((c) => c.cellId === cellId);
  if (!cell) throw new Error("Cell missing");
  ensureSizeAssets(campaign, cellId);
  const pack = await buildPromptPack(campaign, cell, size);
  const slot = cell.sizeAssets.find((a) => a.sizeId === size.id);

  // 1) This size already has matching variant media
  if (
    !forceRegen &&
    slot?.genPath &&
    slot.promptHash === pack.promptHash &&
    !sizeNeedsComfyGen(cell, size)
  ) {
    return {
      assetPath: slot.genPath,
      lineage: { reused: true, reason: "cell_asset", promptHash: pack.promptHash, sizeId: size.id },
    };
  }
  if (!forceRegen && slot?.genPath && !slot.promptHash && !sizeNeedsComfyGen(cell, size)) {
    applyGenPathToSize(cell, size.id, slot.genPath, pack.promptHash);
    await saveCampaign(campaign);
    return {
      assetPath: slot.genPath,
      lineage: { reused: true, reason: "legacy_genPath", promptHash: pack.promptHash, sizeId: size.id },
    };
  }

  // 2) Cross-cell cache: same combo + size context (promptHash includes dims)
  if (!forceRegen) {
    const hit = await lookupPlateCache(pack.promptHash);
    if (hit) {
      applyGenPathToSize(cell, size.id, hit.assetPath, pack.promptHash);
      await saveCampaign(campaign);
      return {
        assetPath: hit.assetPath,
        lineage: {
          reused: true,
          reason: "plate_cache",
          promptHash: pack.promptHash,
          fromCellId: hit.cellId,
          sizeId: size.id,
        },
      };
    }
  }

  const pipeline = String(pack.patches?.videoPipeline || "still");
  const isVideo = pipeline === "bria_replace" || pipeline === "minimax_h3_r2v";
  // Still path: wrap PNG→MP4 for Remotion. Video path: keep native MP4.
  const prevWrap = process.env.COMFY_WRAP_MP4;
  if (!isVideo) process.env.COMFY_WRAP_MP4 = "1";
  try {
    const gen = await runComfyJob({
      workflowId: pack.workflowId,
      modelProfileId: campaign.modelProfileId,
      cellId: `${cellId}:${size.id}`,
      knob: pack.knob,
      patches: {
        ...pack.patches,
        wrapMp4: !isVideo,
        forceRegen,
      },
      onProgress,
      signal: control?.signal,
      onPromptId: control?.jobId
        ? (promptId) => setJobComfyPromptId(control.jobId!, promptId)
        : undefined,
    });
    applyGenPathToSize(cell, size.id, gen.assetPath, pack.promptHash);
    await saveCampaign(campaign);
    await putPlateCache({
      promptHash: pack.promptHash,
      assetPath: gen.assetPath,
      workflowId: pack.workflowId,
      modelProfileId: campaign.modelProfileId,
      knob: pack.knob,
      sizeId: size.id,
      createdAt: new Date().toISOString(),
      cellId,
    });
    return gen;
  } finally {
    if (prevWrap === undefined) delete process.env.COMFY_WRAP_MP4;
    else process.env.COMFY_WRAP_MP4 = prevWrap;
  }
}

export async function enqueueCellSizeJob(
  campaignId: string,
  cellId: string,
  size: OutputSize,
  stage: "preview" | "render",
  opts: BatchOpts & { copyPlate?: AssembleCopyPlate | null; updateCellPaths?: boolean } = {},
): Promise<Job> {
  const copyPlate = opts.copyPlate ?? null;
  const updateCellPaths = opts.updateCellPaths !== false;
  // Default assemble-only from ingredient plates / existing genPath
  const skipComfy = opts.skipComfy !== false;
  const remotionStage = assembleStage(stage);
  const etaSeconds = estimateQueueJobSeconds({
    stage: remotionStage,
    includesComfy: !skipComfy,
  });
  const job: Job = {
    id: nanoid(10),
    campaignId,
    cellId,
    copyId: copyPlate?.id ?? null,
    sizeId: size.id,
    width: size.width,
    height: size.height,
    stage: remotionStage,
    status: "queued",
    progress: 0,
    message: copyPlate
      ? `Queued ${size.label} · ${copyPlate.label}`
      : `Queued ${size.label}`,
    resultPath: null,
    etaSeconds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertJob(job);
  const signal = attachJobControl(job.id);

  void (async () => {
    try {
      assertJobNotCancelled(job.id);
      touchJob(job, {
        status: "running",
        message: copyPlate
          ? `${size.aspect} ${size.width}×${size.height} · ${copyPlate.label}`
          : `${size.aspect} ${size.width}×${size.height}`,
        progress: 0.05,
      });
      let campaign = await getCampaign(campaignId);
      ensureSizeAssets(campaign, cellId);
      await saveCampaign(campaign);
      campaign = await getCampaign(campaignId);

      const forceRegen = Boolean(opts.forceRegen);

      if (!skipComfy) {
        touchJob(job, {
          message: `Comfy ${campaign.modelProfileId} → ${size.aspect}`,
          progress: 0.12,
        });
        try {
          await runComfyForCellSize(
            campaign,
            cellId,
            size,
            forceRegen,
            (p, message) => {
              // Comfy soft 0–1 → job band 0.12–0.52
              touchJob(job, {
                progress: 0.12 + Math.min(0.4, p * 0.4),
                message,
              });
            },
            { signal, jobId: job.id },
          );
        } catch (err) {
          if (isCancelledError(err) || signal.aborted) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          campaign = await getCampaign(campaignId);
          ensureSizeAssets(campaign, cellId);
          patchResolvedCell(campaign, cellId, (cell) => {
            const asset = cell.sizeAssets.find((a) => a.sizeId === size.id);
            if (asset) {
              asset.status = "failed";
              asset.error = msg;
            }
          });
          await saveCampaign(campaign);
          throw err;
        }
        campaign = await getCampaign(campaignId);
      }

      assertJobNotCancelled(job.id);
      const remotionStage = assembleStage(stage);
      const recipeShort = (() => {
        const r = normalizeAssemblyRecipe(campaign.assemblyRecipe);
        const { cell: c } = requireResolvedCell(campaign, cellId);
        const slots = ensureSceneSlots(c, r);
        return `${r.scenes.length} scenes · ${assemblyRecipeTotalSeconds(r)}s · ${formatSceneSlotsSummary(slots)}`;
      })();
      touchJob(job, {
        message: copyPlate
          ? `Remotion assemble · ${copyPlate.label} · ${recipeShort}`
          : `Remotion assemble ${size.width}×${size.height} · ${recipeShort}`,
        progress: skipComfy ? 0.15 : 0.55,
      });
      const props = await buildProps(campaign, cellId, size, copyPlate?.copy);
      const outputPath = campaignOutputPath(
        campaignId,
        outputPathCellKey(cellId),
        remotionStage,
        size.id,
        copyPlate?.id,
      );
      const remotionLo = skipComfy ? 0.15 : 0.55;
      const remotionSpan = 0.98 - remotionLo;
      await renderAd({
        props,
        outputPath,
        scale: 1,
        signal,
        onProgress: (p, detail) => {
          touchJob(job, {
            progress: remotionLo + p * remotionSpan,
            message: detail,
          });
        },
      });

      if (updateCellPaths) {
        // Re-read under campaign lock so parallel size jobs don't clobber paths
        await updateCampaign(campaignId, (camp) => {
          ensureSizeAssets(camp, cellId);
          patchResolvedCell(camp, cellId, (c) => {
            if (copyPlate?.copy) {
              c.copy = copyPlate.copy;
            }
            const assetIdx = c.sizeAssets.findIndex((a) => a.sizeId === size.id);
            if (assetIdx >= 0) {
              c.sizeAssets[assetIdx] = {
                ...c.sizeAssets[assetIdx],
                outputPath,
                // Compat: mirror so older UI that reads previewPath still finds media
                previewPath: outputPath,
                status: "ready",
                error: null,
              };
            }
            const primary = c.sizeAssets[0];
            c.outputPath = primary?.outputPath ?? outputPath;
            c.previewPath = primary?.previewPath ?? outputPath;
            c.previewOk = c.sizeAssets.every(
              (a) => a.status === "ready" || Boolean(a.outputPath?.trim()),
            );
            c.status = c.sizeAssets.every((a) => a.status === "ready")
              ? "ready"
              : "rendering";
          });
        });
      }

      touchJob(job, {
        status: "done",
        progress: 1,
        message: skipComfy
          ? copyPlate
            ? `Assembled ${size.aspect} · ${copyPlate.label}`
            : `Assembled ${size.aspect} (Comfy skipped)`
          : `Generated + assembled ${size.aspect}`,
        resultPath: outputPath,
      });
      finishJobControl(job.id);
    } catch (err) {
      markJobCancelledOrFailed(job, err, signal);
    }
  })();

  return job;
}

/** @deprecated use enqueueCellSizeJob — fans all campaign sizes */
export async function enqueueCellJob(
  campaignId: string,
  cellId: string,
  stage: "preview" | "render",
  opts: BatchOpts = {},
) {
  const campaign = await getCampaign(campaignId);
  const jobs: Job[] = [];
  for (const size of campaignSizes(campaign)) {
    jobs.push(await enqueueCellSizeJob(campaignId, cellId, size, stage, opts));
  }
  return jobs[0];
}

export async function enqueueBatch(
  campaignId: string,
  stage: "preview" | "render",
  cellIds?: string[],
  opts: BatchOpts = {},
) {
  let campaign = await getCampaign(campaignId);
  // New delivery sizes often land before any job — sync rows + inherit genPath
  syncCampaignSizeAssets(campaign);
  await saveCampaign(campaign);
  campaign = await getCampaign(campaignId);

  const allSizes = campaignSizes(campaign);
  const sizeFilter = opts.sizeIds?.filter(Boolean) ?? [];
  const sizes = sizeFilter.length
    ? allSizes.filter((s) => sizeFilter.includes(s.id))
    : allSizes;
  if (!sizes.length) throw new Error("No matching output sizes to assemble");

  // Soft gate: when no cellIds, assemble cells that have variant plates ready
  const ids = (
    cellIds?.length
      ? cellIds
      : campaign.matrix.cells
          .filter((c) => cellHasVariantReady(c))
          .map((c) => c.cellId)
  ).filter(Boolean);

  await assertIngredientPlatesReady(campaign, ids);

  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const copyPlates = resolveAssembleCopyPlates(campaign, lib, opts.copyIds);
  // No active copy plates → one assemble per cell using baked cell.copy
  const copyAxis: (AssembleCopyPlate | null)[] = copyPlates.length
    ? copyPlates
    : [null];

  const jobs: Job[] = [];
  for (const id of ids) {
    const resolved = resolveMatrixCell(campaign, id);
    if (!resolved) continue;
    for (const [copyIdx, copyPlate] of copyAxis.entries()) {
      for (const size of sizes) {
        if (
          opts.onlyMissing &&
          !assetNeedsAssemble(resolved.cell, size.id, stage)
        ) {
          continue;
        }
        jobs.push(
          await enqueueCellSizeJob(campaignId, id, size, stage, {
            skipComfy: opts.skipComfy !== false,
            forceRegen: opts.forceRegen,
            copyPlate,
            // Multi-copy: keep matrix thumb on the first copy plate only
            updateCellPaths: copyIdx === 0,
          }),
        );
      }
    }
  }
  if (!jobs.length && opts.onlyMissing) {
    throw new Error(
      "No missing masters — every selected cell already has assembled output for those sizes",
    );
  }
  if (!jobs.length && !opts.onlyMissing) {
    throw new Error(
      "No cells ready to assemble — generate Comfy variants on Matrix first, then Assemble from Review",
    );
  }
  return jobs;
}

/**
 * Queue Comfy variant media for matrix cells at primary size only.
 * Other aspects need enqueueMissingSizeVariantBatch (own Comfy pass).
 */
export async function enqueueVariantBatch(
  campaignId: string,
  cellIds?: string[],
  opts: BatchOpts = {},
) {
  let campaign = await getCampaign(campaignId);
  syncCampaignSizeAssets(campaign);
  await saveCampaign(campaign);
  campaign = await getCampaign(campaignId);

  const sizes = campaignSizes(campaign);
  const primary = sizes[0];
  if (!primary) throw new Error("Campaign has no output sizes");

  // Empty array means "all cells" (UI sometimes posts cellIds: [] when nothing is selected).
  const requested =
    cellIds?.length ? cellIds : campaign.matrix.cells.map((c) => c.cellId);
  const ids = requested.filter((id) => {
    const cell = campaign.matrix.cells.find((c) => c.cellId === id);
    return Boolean(cell && cellNeedsVariantGen(cell));
  });

  if (!ids.length) {
    throw new Error(
      "No cells need variant generation. Pin hands, attire, background, or prop on the rail (or open as a fan), then Build from rail.",
    );
  }

  await assertTalentReadyForVariants(campaign, ids);

  const jobs: Job[] = [];

  for (const cellId of ids) {
    const job: Job = {
      id: nanoid(10),
      campaignId,
      cellId,
      copyId: null,
      sizeId: primary.id,
      width: primary.width,
      height: primary.height,
      stage: "plates",
      status: "queued",
      progress: 0,
      message: `Variant ${primary.label}`,
      resultPath: null,
      etaSeconds: estimateQueueJobSeconds({
        stage: "plates",
        includesComfy: true,
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertJob(job);
    jobs.push(job);
    const signal = attachJobControl(job.id);

    void (async () => {
      try {
        assertJobNotCancelled(job.id);
        touchJob(job, {
          status: "running",
          message: `Comfy variant ${primary.aspect}`,
          progress: 0.08,
        });
        let camp = await getCampaign(campaignId);
        ensureSizeAssets(camp, cellId);
        await saveCampaign(camp);
        camp = await getCampaign(campaignId);
        const gen = await runComfyForCellSize(
          camp,
          cellId,
          primary,
          Boolean(opts.forceRegen),
          (p, message) => {
            touchJob(job, {
              progress: 0.08 + Math.min(0.88, p * 0.88),
              message,
            });
          },
          { signal, jobId: job.id },
        );
        touchJob(job, {
          status: "done",
          progress: 1,
          message: `Variant ready @ ${primary.aspect} — use Fill missing sizes for other aspects`,
          resultPath: gen?.assetPath ?? null,
        });
        finishJobControl(job.id);
      } catch (err) {
        if (!isCancelledError(err) && !signal.aborted) {
          try {
            const camp = await getCampaign(campaignId);
            ensureSizeAssets(camp, cellId);
            const cell = camp.matrix.cells.find((c) => c.cellId === cellId);
            if (cell) {
              const asset = cell.sizeAssets.find((a) => a.sizeId === primary.id);
              if (asset) {
                asset.status = "failed";
                asset.error = err instanceof Error ? err.message : String(err);
              }
              await saveCampaign(camp);
            }
          } catch {
            /* ignore */
          }
        }
        markJobCancelledOrFailed(job, err, signal);
      }
    })();
  }
  return jobs;
}

/**
 * Comfy-generate each missing (or wrong-aspect) size slot, then Remotion-assemble it.
 * Does not re-run sizes that already have their own genPath.
 */
export async function enqueueMissingSizeVariantBatch(
  campaignId: string,
  cellIds?: string[],
  opts: BatchOpts = {},
) {
  let campaign = await getCampaign(campaignId);
  syncCampaignSizeAssets(campaign);
  await saveCampaign(campaign);
  campaign = await getCampaign(campaignId);

  const allSizes = campaignSizes(campaign);
  const sizeFilter = opts.sizeIds?.filter(Boolean) ?? [];
  const sizes = sizeFilter.length
    ? allSizes.filter((s) => sizeFilter.includes(s.id))
    : allSizes;
  if (!sizes.length) throw new Error("No output sizes configured");

  const requested =
    cellIds?.length ? cellIds : campaign.matrix.cells.map((c) => c.cellId);
  const pairs: { cellId: string; size: OutputSize }[] = [];
  for (const cellId of requested) {
    const cell = campaign.matrix.cells.find((c) => c.cellId === cellId);
    if (!cell || !cellNeedsVariantGen(cell)) continue;
    for (const size of sizes) {
      if (opts.forceRegen || sizeNeedsComfyGen(cell, size)) {
        pairs.push({ cellId, size });
      }
    }
  }

  if (!pairs.length) {
    throw new Error(
      "No missing size gens — every selected cell already has Comfy media per aspect",
    );
  }

  await assertTalentReadyForVariants(
    campaign,
    [...new Set(pairs.map((p) => p.cellId))],
  );

  const jobs: Job[] = [];
  for (const { cellId, size } of pairs) {
    const job: Job = {
      id: nanoid(10),
      campaignId,
      cellId,
      copyId: null,
      sizeId: size.id,
      width: size.width,
      height: size.height,
      stage: "plates",
      status: "queued",
      progress: 0,
      message: `Comfy ${size.aspect} ${size.width}×${size.height}`,
      resultPath: null,
      etaSeconds: estimateQueueJobSeconds({
        stage: "plates",
        includesComfy: true,
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertJob(job);
    jobs.push(job);
    const signal = attachJobControl(job.id);

    void (async () => {
      try {
        assertJobNotCancelled(job.id);
        touchJob(job, {
          status: "running",
          message: `Comfy ${size.aspect}`,
          progress: 0.08,
        });
        let camp = await getCampaign(campaignId);
        ensureSizeAssets(camp, cellId);
        await saveCampaign(camp);
        camp = await getCampaign(campaignId);
        const gen = await runComfyForCellSize(
          camp,
          cellId,
          size,
          Boolean(opts.forceRegen),
          (p, message) => {
            touchJob(job, {
              progress: 0.08 + Math.min(0.88, p * 0.88),
              message,
            });
          },
          { signal, jobId: job.id },
        );
        assertJobNotCancelled(job.id);
        // Do not auto-assemble — operator reviews variants then Assembles from Review
        touchJob(job, {
          status: "done",
          progress: 1,
          message: `Comfy ready @ ${size.aspect} — review variants, then Assemble on Review`,
          resultPath: gen?.assetPath ?? null,
        });
        finishJobControl(job.id);
      } catch (err) {
        if (!isCancelledError(err) && !signal.aborted) {
          try {
            const camp = await getCampaign(campaignId);
            ensureSizeAssets(camp, cellId);
            const cell = camp.matrix.cells.find((c) => c.cellId === cellId);
            const asset = cell?.sizeAssets.find((a) => a.sizeId === size.id);
            if (asset) {
              asset.status = "failed";
              asset.error = err instanceof Error ? err.message : String(err);
              await saveCampaign(camp);
            }
          } catch {
            /* ignore */
          }
        }
        markJobCancelledOrFailed(job, err, signal);
      }
    })();
  }
  return jobs;
}

/** @deprecated alias — use enqueueVariantBatch */
export const enqueuePlateBatch = enqueueVariantBatch;

export function plannedAssets(campaign: Campaign) {
  const sizes = campaignSizes(campaign);
  const rows = [];
  for (const cell of campaign.matrix.cells) {
    for (const size of sizes) {
      const asset = cell.sizeAssets?.find((a) => a.sizeId === size.id);
      rows.push({
        cellId: cell.cellId,
        sizeId: size.id,
        label: size.label,
        aspect: size.aspect,
        width: size.width,
        height: size.height,
        gen: genDimsForSize(size),
        status: asset?.status || "pending",
        previewPath: asset?.previewPath || null,
        outputPath: asset?.outputPath || null,
        genPath: asset?.genPath || null,
        error: asset?.error || null,
      });
    }
  }
  return {
    modelProfileId: campaign.modelProfileId,
    sizes,
    total: rows.length,
    rows,
  };
}
