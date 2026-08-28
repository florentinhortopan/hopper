import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  DEFAULT_LIBRARY_ID,
  DEFAULT_TALENT_CONTRACT,
  LIBRARY_KINDS,
  LibraryItemSchema,
  getIngredientKind,
  isPlateReady,
  type LibraryItem,
  type LibraryItemPatch,
  type LibraryKind,
  type MediaType,
  type TalentContract,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import { packKindDir, packRelPrefix } from "./libraryPacks.js";
import { libraryAbsolutePath } from "./store.js";
import { runComfyJob } from "./comfyAdapter.js";

function kindDir(kind: LibraryKind, libraryId = DEFAULT_LIBRARY_ID) {
  return packKindDir(libraryId, kind);
}

function mediaRelPath(
  libraryId: string,
  kind: LibraryKind,
  id: string,
  ext: string,
) {
  return `${packRelPrefix(libraryId)}/${kind}/${id}${ext}`;
}

async function readKind(
  kind: LibraryKind,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem[]> {
  const metaPath = path.join(kindDir(kind, libraryId), "index.json");
  try {
    const raw = JSON.parse(await readFile(metaPath, "utf8"));
    return raw.map((item: unknown) => LibraryItemSchema.parse(item));
  } catch {
    return [];
  }
}

async function writeKind(
  kind: LibraryKind,
  items: LibraryItem[],
  libraryId = DEFAULT_LIBRARY_ID,
) {
  await mkdir(kindDir(kind, libraryId), { recursive: true });
  await writeFile(
    path.join(kindDir(kind, libraryId), "index.json"),
    JSON.stringify(items, null, 2),
  );
}

/** Locate an ingredient and which folder index currently holds it. */
async function findLibraryItem(
  id: string,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<{ item: LibraryItem; folderKind: LibraryKind; libraryId: string } | null> {
  for (const folderKind of LIBRARY_KINDS) {
    const items = await readKind(folderKind, libraryId);
    const item = items.find((i) => i.id === id);
    if (item) return { item, folderKind, libraryId };
  }
  // Fallback: scan all packs if not in requested pack (media URL by id)
  if (libraryId !== DEFAULT_LIBRARY_ID) {
    return findLibraryItem(id, DEFAULT_LIBRARY_ID);
  }
  return null;
}

/**
 * Legacy bug: PATCH used to rewrite `kind` in-place inside the wrong folder
 * index (e.g. hands/index.json with kind:"background"). Move into the folder
 * that matches metadata.kind so Rail filters see the plate.
 */
async function repairMismatchedFolder(
  item: LibraryItem,
  folderKind: LibraryKind,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem> {
  if (item.kind === folderKind) return item;
  const declared = item.kind;
  // Temporarily treat as folder kind so rekind can move declared←folder
  const fromItems = await readKind(folderKind, libraryId);
  const idx = fromItems.findIndex((i) => i.id === item.id);
  if (idx < 0) return item;
  fromItems[idx] = LibraryItemSchema.parse({ ...item, kind: folderKind });
  await writeKind(folderKind, fromItems, libraryId);
  return rekindLibraryItem(item.id, declared, libraryId);
}

export function slugId(label: string, kind: string) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${base || kind}_${nanoid(6)}`;
}

/** Clear plates left in `generating` after a killed/restarted orchestrator. */
export async function reclaimStaleGenerating(
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<number> {
  let n = 0;
  for (const kind of LIBRARY_KINDS) {
    const items = await readKind(kind, libraryId);
    let dirty = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.status !== "generating") continue;
      items[i] = LibraryItemSchema.parse({ ...items[i], status: "failed" });
      dirty = true;
      n += 1;
    }
    if (dirty) await writeKind(kind, items, libraryId);
  }
  return n;
}

function mediaTypeFromFilename(filename: string, kind: LibraryKind): MediaType {
  const ext = path.extname(filename).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm"].includes(ext)) return "video";
  if (ext === ".json") return "json";
  const def = getIngredientKind(kind);
  return def.mediaModes[0] ?? "none";
}

export async function getLibraryItem(
  id: string,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem | null> {
  const hit = await findLibraryItem(id, libraryId);
  if (!hit) return null;
  if (hit.item.kind !== hit.folderKind) {
    return repairMismatchedFolder(hit.item, hit.folderKind, hit.libraryId);
  }
  return hit.item;
}

/**
 * Scan all kind indexes and move any plate whose `kind` field does not match
 * its folder (legacy in-place PATCH). Safe to call on list endpoints.
 */
export async function repairLibraryKindIndexes(
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<number> {
  let moved = 0;
  for (const folderKind of LIBRARY_KINDS) {
    const items = await readKind(folderKind, libraryId);
    const mismatched = items.filter((i) => i.kind !== folderKind);
    for (const item of mismatched) {
      await repairMismatchedFolder(item, folderKind, libraryId);
      moved += 1;
    }
  }
  return moved;
}

export async function createLibraryIngredient(opts: {
  kind: LibraryKind;
  label: string;
  tags: string[];
  promptHint?: string;
  negativeHint?: string;
  locks?: LibraryItem["locks"];
  contract?: TalentContract;
  sourceTalentId?: string | null;
  filename?: string;
  buffer?: Buffer;
  intensity?: number;
  /** Structured copy for kind=copy */
  copy?: LibraryItem["copy"];
  /** Allow creating without media (prompt-only draft for later gen) */
  allowNoMedia?: boolean;
  libraryId?: string;
}): Promise<LibraryItem> {
  const libraryId = opts.libraryId || DEFAULT_LIBRARY_ID;
  const def = getIngredientKind(opts.kind);
  const id = slugId(opts.label, opts.kind);
  const allowNoMedia = opts.allowNoMedia !== false;

  if (opts.kind === "copy") {
    const copy = opts.copy ?? {
      setup: opts.promptHint || opts.label,
      punchline: "",
      endcard: "",
      cta: "Learn more",
    };
    const rel = mediaRelPath(libraryId, "copy", id, ".json");
    const abs = path.join(PATHS.data, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ id, label: opts.label, copy }, null, 2));
    const item = LibraryItemSchema.parse({
      id,
      kind: "copy",
      label: opts.label,
      path: rel,
      tags: opts.tags,
      promptHint: opts.promptHint ?? opts.label,
      negativeHint: opts.negativeHint ?? "",
      mediaType: "json",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
      copy,
    });
    const items = await readKind("copy", libraryId);
    items.push(item);
    await writeKind("copy", items, libraryId);
    return item;
  }

  if (opts.kind === "motion") {
    const rel = mediaRelPath(libraryId, "motion", id, ".json");
    const abs = path.join(PATHS.data, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(
      abs,
      JSON.stringify(
        {
          id,
          intensity: opts.intensity ?? 0.5,
          label: opts.label,
          promptHint: opts.promptHint ?? "",
        },
        null,
        2,
      ),
    );
    const item = LibraryItemSchema.parse({
      id,
      kind: "motion",
      label: opts.label,
      path: rel,
      tags: opts.tags,
      promptHint: opts.promptHint ?? opts.label,
      negativeHint: opts.negativeHint ?? "",
      mediaType: "json",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: opts.sourceTalentId ?? null,
    });
    const items = await readKind("motion", libraryId);
    items.push(item);
    await writeKind("motion", items, libraryId);
    return item;
  }

  // Prompt-only / draft — no file yet (diffusion will fill later)
  if (!opts.buffer || !opts.filename) {
    if (!allowNoMedia) {
      throw new Error(`File required for kind ${opts.kind}`);
    }
    const contract =
      opts.kind === "talent"
        ? opts.contract ?? {
            ...DEFAULT_TALENT_CONTRACT,
            ...(opts.locks || {}),
          }
        : undefined;
    const item = LibraryItemSchema.parse({
      id,
      kind: opts.kind,
      label: opts.label,
      path: "",
      tags: opts.tags,
      promptHint: opts.promptHint ?? opts.label,
      negativeHint: opts.negativeHint ?? "",
      mediaType: "none",
      status: "draft",
      sourceMode: "prompt_only",
      sourceTalentId: opts.sourceTalentId ?? null,
      locks: opts.kind === "talent" ? opts.locks ?? {
        face_locked: true,
        voice_locked: true,
        performance_locked: true,
      } : undefined,
      contract,
    });
    const items = await readKind(opts.kind, libraryId);
    items.push(item);
    await writeKind(opts.kind, items, libraryId);
    return item;
  }

  const mediaType = mediaTypeFromFilename(opts.filename, opts.kind);
  if (!def.mediaModes.includes(mediaType) && mediaType !== "none") {
    throw new Error(
      `Unsupported media for ${opts.kind}: ${mediaType}. Allowed: ${def.mediaModes.join(", ")}`,
    );
  }

  const ext = path.extname(opts.filename) || (mediaType === "image" ? ".png" : ".mp4");
  const rel = mediaRelPath(libraryId, opts.kind, id, ext);
  const abs = path.join(PATHS.data, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, opts.buffer);

  const contract =
    opts.kind === "talent"
      ? opts.contract ?? {
          ...DEFAULT_TALENT_CONTRACT,
          ...(opts.locks || {}),
        }
      : undefined;

  const item = LibraryItemSchema.parse({
    id,
    kind: opts.kind,
    label: opts.label,
    path: rel,
    tags: opts.tags,
    promptHint: opts.promptHint ?? opts.label,
    negativeHint: opts.negativeHint ?? "",
    mediaType,
    status: "ready",
    sourceMode: "upload",
    sourceTalentId: opts.sourceTalentId ?? null,
    locks:
      opts.kind === "talent"
        ? opts.locks ?? {
            face_locked: true,
            voice_locked: true,
            performance_locked: true,
          }
        : undefined,
    contract,
  });

  const items = await readKind(opts.kind, libraryId);
  items.push(item);
  await writeKind(opts.kind, items, libraryId);
  return item;
}

function libraryIdFromPath(p: string | undefined | null): string {
  if (!p) return DEFAULT_LIBRARY_ID;
  const m = /^libraries\/([^/]+)\//.exec(p);
  return m?.[1] || DEFAULT_LIBRARY_ID;
}

/** Replace / attach media on an existing ingredient (upload plate). */
export async function replaceLibraryMedia(
  id: string,
  filename: string,
  buffer: Buffer,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem> {
  const hit = await findLibraryItem(id, libraryId);
  if (!hit) throw new Error(`Ingredient not found: ${id}`);
  const { item } = hit;
  libraryId = hit.libraryId;
  if (item.kind === "motion" || item.kind === "copy") {
    throw new Error(
      "Motion / copy ingredients are metadata — edit fields in library, not media upload",
    );
  }
  const mediaType = mediaTypeFromFilename(filename, item.kind);
  const ext = path.extname(filename) || (mediaType === "image" ? ".png" : ".mp4");
  const rel = mediaRelPath(libraryId, item.kind, item.id, ext);
  const abs = path.join(PATHS.data, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);

  const items = await readKind(item.kind, libraryId);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`Ingredient not found: ${id}`);
  const next = LibraryItemSchema.parse({
    ...items[idx],
    path: rel,
    mediaType,
    status: "ready",
    sourceMode: "upload",
  });
  items[idx] = next;
  await writeKind(item.kind, items, libraryId);
  return next;
}

/**
 * Move a plate into another ingredient category.
 * Keeps the same id (campaign refs stay valid); relocates media under pack/{kind}/.
 */
export async function rekindLibraryItem(
  id: string,
  nextKind: LibraryKind,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem> {
  const hit = await findLibraryItem(id, libraryId);
  if (!hit) throw new Error(`Ingredient not found: ${id}`);
  const { item, folderKind } = hit;
  libraryId = hit.libraryId;
  if (item.kind === nextKind && folderKind === nextKind) return item;

  const fromItems = await readKind(folderKind, libraryId);
  const idx = fromItems.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`Ingredient not found: ${id}`);
  fromItems.splice(idx, 1);
  await writeKind(folderKind, fromItems, libraryId);

  let nextPath = item.path;
  if (item.path?.trim()) {
    const ext = path.extname(item.path) || "";
    const rel = mediaRelPath(libraryId, nextKind, item.id, ext);
    const fromAbs = libraryAbsolutePath(item);
    const toAbs = path.join(PATHS.data, rel);
    await mkdir(path.dirname(toAbs), { recursive: true });
    try {
      await rename(fromAbs, toAbs);
      nextPath = rel;
    } catch {
      try {
        await copyFile(fromAbs, toAbs);
        await rm(fromAbs, { force: true });
        nextPath = rel;
      } catch {
        // Keep prior path if file missing — metadata move still succeeds
        nextPath = item.path;
      }
    }
  }

  const movingToTalent = nextKind === "talent";
  const movingFromTalent = item.kind === "talent" || folderKind === "talent";
  const movingToCopy = nextKind === "copy";
  const copyPayload = movingToCopy
    ? item.copy ?? {
        setup: item.promptHint || item.label,
        punchline: "",
        endcard: "",
        cta: "Learn more",
      }
    : item.copy;
  if (movingToCopy) {
    const rel = mediaRelPath(libraryId, "copy", item.id, ".json");
    const abs = path.join(PATHS.data, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(
      abs,
      JSON.stringify({ id: item.id, label: item.label, copy: copyPayload }, null, 2),
    );
    nextPath = rel;
  }
  const next = LibraryItemSchema.parse({
    ...item,
    kind: nextKind,
    path: nextPath,
    mediaType: movingToCopy ? "json" : item.mediaType,
    status: movingToCopy ? "ready" : item.status,
    copy: movingToCopy ? copyPayload : undefined,
    locks: movingToTalent
      ? item.locks ?? {
          face_locked: true,
          voice_locked: true,
          performance_locked: true,
        }
      : undefined,
    contract: movingToTalent
      ? item.contract ?? {
          ...DEFAULT_TALENT_CONTRACT,
          ...(item.locks || {}),
        }
      : movingFromTalent
        ? undefined
        : item.contract,
  });

  // Avoid duplicates if a prior partial move left an entry in the destination
  const toItems = (await readKind(nextKind, libraryId)).filter((i) => i.id !== id);
  toItems.push(next);
  await writeKind(nextKind, toItems, libraryId);
  return next;
}

export async function patchLibraryItem(
  id: string,
  patch: LibraryItemPatch,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryItem> {
  const { kind: nextKind, ...rest } = patch;
  let currentId = id;
  const hit = await findLibraryItem(id, libraryId);
  if (hit) libraryId = hit.libraryId;

  if (nextKind) {
    await rekindLibraryItem(id, nextKind, libraryId);
  }

  const remaining = Object.keys(rest).length > 0;
  if (!remaining && nextKind) {
    const moved = await getLibraryItem(id, libraryId);
    if (!moved) throw new Error(`Ingredient not found: ${id}`);
    return moved;
  }
  if (!remaining) {
    const item = await getLibraryItem(id, libraryId);
    if (!item) throw new Error(`Ingredient not found: ${id}`);
    return item;
  }

  for (const kind of LIBRARY_KINDS) {
    const items = await readKind(kind, libraryId);
    const idx = items.findIndex((i) => i.id === currentId);
    if (idx < 0) continue;
    const prev = items[idx];
    const next = LibraryItemSchema.parse({
      ...prev,
      ...rest,
      kind: prev.kind,
      locks: rest.locks ? { ...prev.locks, ...rest.locks } : prev.locks,
      contract: rest.contract
        ? { ...prev.contract, ...rest.contract }
        : prev.contract,
    });
    if (next.kind === "copy" && next.copy) {
      const rel =
        next.path?.trim() || mediaRelPath(libraryId, "copy", next.id, ".json");
      const abs = path.join(PATHS.data, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(
        abs,
        JSON.stringify({ id: next.id, label: next.label, copy: next.copy }, null, 2),
      );
      next.path = rel;
      next.mediaType = "json";
      if (isPlateReady(next)) next.status = "ready";
    }
    const wasArchived = Boolean(prev.archived);
    const nowArchived = Boolean(next.archived);
    items[idx] = next;
    await writeKind(kind, items, libraryId);
    if (!wasArchived && nowArchived) {
      await pruneLibraryItemFromCampaigns(id);
    }
    return next;
  }
  throw new Error(`Ingredient not found: ${id}`);
}

/** Drop plate from campaign activations / rail so Ingredients don't keep a ghost id. */
async function pruneLibraryItemFromCampaigns(id: string): Promise<void> {
  try {
    const { listCampaigns, listLibrary, saveCampaign } = await import("./store.js");
    const { pruneRailToActive } = await import("./policy.js");
    for (const campaign of await listCampaigns({ includeArchived: true })) {
      const lib = await listLibrary(
        undefined,
        campaign.libraryId || DEFAULT_LIBRARY_ID,
        { includeArchived: true },
      );
      let dirty = false;
      const active = campaign.ingredientSet?.activeIds ?? [];
      if (active.includes(id)) {
        campaign.ingredientSet = {
          ...campaign.ingredientSet!,
          activeIds: active.filter((x) => x !== id),
          contractTalentId:
            campaign.ingredientSet?.contractTalentId === id
              ? null
              : campaign.ingredientSet?.contractTalentId ?? null,
        };
        dirty = true;
      }
      if (campaign.rail) {
        const pruned = pruneRailToActive(campaign, campaign.rail, lib);
        if (JSON.stringify(pruned) !== JSON.stringify(campaign.rail)) {
          campaign.rail = pruned;
          dirty = true;
        }
      }
      if (dirty) await saveCampaign(campaign);
    }
  } catch {
    /* best-effort campaign cleanup */
  }
}

export async function deleteLibraryItem(
  id: string,
  libraryId = DEFAULT_LIBRARY_ID,
): Promise<void> {
  const hit = await findLibraryItem(id, libraryId);
  if (hit) libraryId = hit.libraryId;
  for (const kind of LIBRARY_KINDS) {
    const items = await readKind(kind, libraryId);
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) continue;
    const [removed] = items.splice(idx, 1);
    await writeKind(kind, items, libraryId);
    if (removed.path) {
      try {
        await rm(libraryAbsolutePath(removed), { force: true });
      } catch {
        /* file may already be gone */
      }
    }
    await pruneLibraryItemFromCampaigns(id);
    return;
  }
  throw new Error(`Ingredient not found: ${id}`);
}

/**
 * Ingredient generation (Comfy / diffusion) — separate from Remotion final assemble.
 * When campaignId is set, folds full campaign context (brief, rail hero, talent,
 * companions, design tokens, primary size) into the plate prompt.
 */
export async function generateIngredientAsset(opts: {
  ingredientId: string;
  modelProfileId?: string | null;
  sourceTalentId?: string | null;
  /** Campaign context — brief, rail, talent contract, tokens, sizes */
  campaignId?: string | null;
  /** image = SD still; video = partner R2V/Bria (default) */
  outputMode?: "image" | "video" | null;
  /** Caller already flipped status to generating (async 202 path). */
  alreadyGenerating?: boolean;
  /** Optional progress for Job UI (0–1). */
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
  onPromptId?: (promptId: string) => void;
}): Promise<LibraryItem> {
  const item = await getLibraryItem(opts.ingredientId);
  if (!item) throw new Error(`Ingredient not found: ${opts.ingredientId}`);
  if (item.kind === "motion" || item.kind === "talent" || item.kind === "copy") {
    throw new Error(
      `Cannot generate ${item.kind} via diffusion — use upload / metadata (talent, motion, copy)`,
    );
  }

  const report = (progress: number, message: string) => {
    try {
      opts.onProgress?.(progress, message);
    } catch {
      /* ignore UI progress errors */
    }
  };

  if (!opts.alreadyGenerating) {
    await patchLibraryItem(item.id, { status: "generating" });
  }
  report(0.05, "Queued plate generation");

  let campaign = null;
  if (opts.campaignId) {
    try {
      const { getCampaign } = await import("./store.js");
      campaign = await getCampaign(opts.campaignId);
    } catch {
      campaign = null;
    }
  } else {
    // Library page often omits campaignId — fold the newest campaign brief/rail
    // so attire/hands MiniMax prompts aren't context-starved.
    try {
      const { listCampaigns } = await import("./store.js");
      const camps = await listCampaigns({ includeArchived: false });
      camps.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      campaign = camps[0] ?? null;
      if (campaign) {
        console.info(
          `[library.generate] ${item.id} using campaign context ${campaign.id}`,
        );
      }
    } catch {
      campaign = null;
    }
  }

  const forceRegen =
    item.status === "ready" ||
    item.sourceMode === "upload" ||
    item.sourceMode === "generated" ||
    Boolean(item.path?.trim());

  try {
    report(0.12, "Building prompt pack");
    const { buildIngredientPromptPack } = await import("./promptPack.js");
    const pack = await buildIngredientPromptPack({
      item,
      campaign,
      modelProfileId: opts.modelProfileId,
      sourceTalentId: opts.sourceTalentId,
      forceRegen,
      outputMode: opts.outputMode,
    });

    const mode = pack.outputMode ?? "video";
    const pipeline = pack.videoPipeline ?? "still";
    // Background scene plates intentionally use still (+ optional wrapMp4).
    // Attire/prop/hands video should hit MiniMax — hard-fail if they fell through.
    if (
      mode === "video" &&
      pipeline === "still" &&
      item.kind !== "background" &&
      !pack.patches.wrapMp4
    ) {
      throw new Error(
        "Video plate gen fell back to still diffusion — check talent has MP4 media and COMFY_VARIANT_VIDEO is not 0",
      );
    }
    console.info(
      `[library.generate] ${item.id} outputMode=${mode} pipeline=${pipeline} workflow=${pack.workflowId}`,
    );

    report(
      0.22,
      mode === "video"
        ? `Comfy ${pipeline} (video — often a few minutes)`
        : "Comfy still generation",
    );
    if (opts.signal?.aborted) {
      const err = new Error("Job cancelled");
      err.name = "JobCancelledError";
      throw err;
    }
    const gen = await runComfyJob({
      workflowId: pack.workflowId,
      modelProfileId: pack.modelProfileId,
      cellId: `ingredient_${item.id}`,
      knob: pack.knob,
      patches: pack.patches,
      signal: opts.signal,
      onPromptId: opts.onPromptId,
      onProgress: (p, message) => {
        // Soft Comfy wait → plate job band 0.22–0.85
        report(0.22 + Math.min(0.63, p * 0.63), message);
      },
    });
    report(0.88, "Saving plate media");

    // Register generated file under this ingredient's path
    const libId = libraryIdFromPath(item.path) || DEFAULT_LIBRARY_ID;
    const ext = path.extname(gen.assetPath) || ".mp4";
    const rel = mediaRelPath(libId, item.kind, item.id, ext);
    const abs = path.join(PATHS.data, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    const { copyFile } = await import("node:fs/promises");
    await copyFile(gen.assetPath, abs);

    const mediaType: MediaType =
      [".png", ".jpg", ".jpeg", ".webp"].includes(ext.toLowerCase())
        ? "image"
        : "video";

    const sourceTalentId = pack.sourceTalentId;

    return patchLibraryItem(
      item.id,
      {
        status: "ready",
        sourceTalentId: sourceTalentId ?? null,
      },
      libId,
    ).then(async () => {
      // patch doesn't set path/sourceMode/mediaType — write directly
      const items = await readKind(item.kind, libId);
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx < 0) throw new Error("Failed to update generated ingredient");
      const next = LibraryItemSchema.parse({
        ...items[idx],
        path: rel,
        mediaType,
        status: "ready",
        sourceMode: "generated",
        sourceTalentId: sourceTalentId ?? null,
      });
      items[idx] = next;
      await writeKind(item.kind, items, libId);
      return next;
    });
  } catch (err) {
    const cancelled =
      opts.signal?.aborted ||
      (err instanceof Error && /cancel/i.test(err.name + err.message));
    const libId = libraryIdFromPath(item.path) || DEFAULT_LIBRARY_ID;
    await patchLibraryItem(
      item.id,
      {
        status: cancelled ? "draft" : "failed",
      },
      libId,
    );
    throw err;
  }
}

/** List ingredients in a pack (for store + APIs). */
export async function listLibraryInPack(
  libraryId = DEFAULT_LIBRARY_ID,
  kind?: LibraryKind,
): Promise<LibraryItem[]> {
  if (kind) return readKind(kind, libraryId);
  const lists = await Promise.all(
    LIBRARY_KINDS.map((k) => readKind(k, libraryId)),
  );
  return lists.flat();
}
