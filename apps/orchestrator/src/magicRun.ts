import { nanoid } from "nanoid";
import {
  BriefSchema,
  DEFAULT_LIBRARY_ID,
  MAGIC_ASSEMBLY_RECIPE,
  MAGIC_COMFY_TEMPLATE,
  MAGIC_PRESET_ID,
  ensureSceneTag,
  isPlateReady,
  magicCanContinue,
  magicOutputSizes,
  normalizeComfyTemplate,
  richerMatrixCell,
  toLiveMatrixCell,
  variantSignature,
  type Brief,
  type Campaign,
  type Job,
  type LibraryItem,
  type MagicChecklistItem,
  type MagicVariantPlanRow,
  type MatrixCell,
  type RetiredMatrixCell,
} from "@attatta/shared";
import { DEFAULT_BRAND_TOKEN_ID } from "./defaultTokens.js";
import { createLibraryIngredient, patchLibraryItem } from "./library.js";
import {
  draftCopyFromBrief,
  draftPromptHints,
  getLlmStatus as getOrchLlmStatus,
  synthesizeComfyTemplateFromBrief,
} from "./llmClient.js";
import {
  applyMagicWorkflowToCampaign,
  detectMagicWorkflowFromImport,
  fetchMagicWorkflowUrl,
  mergeBriefHint,
  parseMagicWorkflowJson,
} from "./magicWorkflow.js";
import { deriveRailFromActivations, evaluateCampaignPolicy, attireFanAxis } from "./policy.js";
import {
  getCampaign,
  listLibrary,
  listTokenPacks,
  saveCampaign,
} from "./store.js";

export type MagicPrepareResult = {
  campaign: Campaign;
  /** Secondary: gaps AI/preset filled (workflow, copy, etc.) — not the main UI checklist */
  gapsFilled: MagicChecklistItem[];
  /** Primary checklist: each sparse matrix variant that will run on Generate */
  variants: MagicVariantPlanRow[];
  canContinue: boolean;
  reasons: string[];
  plannedCells: number;
  workflowSource: MagicChecklistItem["source"];
  warnings: string[];
};

function cloudOrDefaultModel(): string {
  if (process.env.COMFY_CLOUD_API_KEY?.trim() || process.env.COMFY_API_URL?.includes("comfy")) {
    return process.env.COMFY_MODEL_PROFILE || "cloud";
  }
  return process.env.COMFY_MODEL_PROFILE || "sd15";
}

export async function createMagicCampaign(opts: {
  name?: string;
  libraryId?: string;
}): Promise<Campaign> {
  const now = new Date().toISOString();
  const tokens = await listTokenPacks();
  const tokenId = tokens[0]?.id || DEFAULT_BRAND_TOKEN_ID;
  const libraryId = opts.libraryId || DEFAULT_LIBRARY_ID;
  const lib = await listLibrary(undefined, libraryId);
  const talent = lib.find((i) => i.kind === "talent");
  const hands = lib.filter((i) => i.kind === "hands");
  const motion = lib.find((i) => i.kind === "motion");

  const draft: Campaign = {
    id: nanoid(8),
    name: opts.name?.trim() || "Magic campaign",
    templateId: "paid_social_9x16_v1",
    modelProfileId: cloudOrDefaultModel(),
    brief: {
      prompt: "",
      audience: "",
      offer: "",
      cta: "",
      mustSay: [],
      mustNot: [],
    },
    designTokenPackId: tokenId,
    rail: {
      hero: {
        talentTakeId: talent?.id || "",
        handsId: hands[0]?.id || "",
        motionToken: motion?.id || "",
        attireId: null,
        backgroundId: null,
        themeId: null,
        propIds: [],
      },
      openKnobs: [],
      allowedHandsIds: [],
      allowedAttireIds: [],
      allowedBackgroundIds: [],
      allowedPropIds: [],
      allowedCopy: [],
    },
    matrix: { cells: [], cap: 20, retired: [] },
    ingredientSet: {
      activeIds: [],
      hiddenIds: [],
      requireReadyMedia: false,
      contractTalentId: talent?.id ?? null,
    },
    outputSizes: magicOutputSizes(),
    libraryId,
    assemblyRecipe: {
      ...MAGIC_ASSEMBLY_RECIPE,
      scenes: [...MAGIC_ASSEMBLY_RECIPE.scenes],
    },
    celtraTemplateProfileId: "guarantee_tranche3_social_video_v1",
    comfyTemplate: normalizeComfyTemplate(MAGIC_COMFY_TEMPLATE),
    mode: "magic",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  return saveCampaign(draft);
}

/**
 * Open or create a Magic-capable campaign.
 * - `campaignId` → attach Magic to that campaign (promotes mode if needed)
 * - otherwise → always create a brand-new magic campaign
 */
export async function ensureMagicCampaign(opts: {
  name?: string;
  libraryId?: string;
  /** Ignored when campaignId is set. Kept for API compatibility; create is default. */
  forceNew?: boolean;
  /** Resume / enable Magic on this specific campaign (standard or magic). */
  campaignId?: string;
}): Promise<{ campaign: Campaign; created: boolean; promoted: boolean }> {
  if (opts.campaignId?.trim()) {
    let campaign = await getCampaign(opts.campaignId.trim());
    let promoted = false;
    if (campaign.mode !== "magic") {
      campaign = await saveCampaign({
        ...campaign,
        mode: "magic",
        updatedAt: new Date().toISOString(),
      });
      promoted = true;
    }
    return { campaign, created: false, promoted };
  }

  const campaign = await createMagicCampaign({
    name: opts.name,
    libraryId: opts.libraryId,
  });
  return { campaign, created: true, promoted: false };
}

function pickMagicActivations(
  lib: LibraryItem[],
  opts?: {
    /** When set, activate import plates (+ extras / prior operator activations). */
    importIngredientIds?: string[];
    /** Extra ids to always include (e.g. copy drafted during prepare). */
    extraIds?: string[];
    /**
     * Activations already on the campaign (Ingredients uploads, Keep selections).
     * Re-check must never wipe these — and must never re-open the whole library.
     */
    priorActiveIds?: string[];
  },
): {
  activeIds: string[];
  contractTalentId: string | null;
  scopedToImport: boolean;
} {
  const libById = new Map(lib.map((i) => [i.id, i]));
  const prior = (opts?.priorActiveIds ?? []).filter((id) => libById.has(id));
  const extra = [...(opts?.extraIds ?? [])].filter((id) => libById.has(id));
  const importSet = opts?.importIngredientIds?.length
    ? new Set(opts.importIngredientIds)
    : null;

  const pickTalent = (ids: string[]) =>
    ids
      .map((id) => libById.get(id)!)
      .find((i) => i.kind === "talent" && isPlateReady(i)) ||
    ids.map((id) => libById.get(id)!).find((i) => i.kind === "talent") ||
    null;

  if (importSet) {
    const fromImport = lib.filter((i) => importSet.has(i.id)).map((i) => i.id);
    // Keep operator-activated uploads/plates across Confirm import & prepare
    const activeIds = [...new Set([...fromImport, ...prior, ...extra])];
    const talent = pickTalent(activeIds);
    return {
      activeIds,
      contractTalentId: talent?.id ?? null,
      scopedToImport: true,
    };
  }

  // Recheck / prepare with existing activations: trust the operator.
  // Do NOT pull one-of-each from the full library (that ballooned actives every press).
  if (prior.length > 0) {
    const activeIds = [...new Set([...prior, ...extra])];
    const talent = pickTalent(activeIds);
    return {
      activeIds,
      contractTalentId: talent?.id ?? null,
      scopedToImport: false,
    };
  }

  // First prepare (nothing active yet): conservative one plate per kind.
  const activeIds = new Set<string>(extra);
  const talent =
    lib.find((i) => i.kind === "talent" && isPlateReady(i)) ||
    lib.find((i) => i.kind === "talent");
  const hands = lib.filter((i) => i.kind === "hands" && isPlateReady(i));
  const attire = lib.filter((i) => i.kind === "attire" && isPlateReady(i));
  const backgrounds = lib.filter(
    (i) => i.kind === "background" && isPlateReady(i),
  );
  const props = lib.filter((i) => i.kind === "prop" && isPlateReady(i));
  const copy = lib.filter((i) => i.kind === "copy");
  const motion = lib.filter((i) => i.kind === "motion");

  if (talent) activeIds.add(talent.id);
  if (hands[0]) activeIds.add(hands[0].id);
  if (attire[0]) activeIds.add(attire[0].id);
  if (backgrounds[0]) activeIds.add(backgrounds[0].id);
  if (props[0]) activeIds.add(props[0].id);
  if (copy[0]) activeIds.add(copy[0].id);
  if (motion[0]) activeIds.add(motion[0].id);

  const contractTalent = pickTalent([...activeIds]) || talent || null;

  return {
    activeIds: [...activeIds],
    contractTalentId: contractTalent?.id ?? null,
    scopedToImport: false,
  };
}

async function resolveImportIngredientIds(
  importId: string,
  libraryId: string,
): Promise<string[]> {
  const { loadImportSession } = await import("./libraryImport.js");
  const session = await loadImportSession(importId);
  if (!session) return [];
  const fromRows = session.rows
    .map((r) => r.committedItemId)
    .filter((id): id is string => Boolean(id));
  if (fromRows.length) return [...new Set(fromRows)];

  // Legacy fallback: tagged media from this import — never treat Magic-drafted
  // copy (magic_att_v1) as package contents.
  const tag = `import:${importId}`;
  const lib = await listLibrary(undefined, libraryId);
  return lib
    .filter((i) => {
      if (!i.tags?.includes(tag)) return false;
      if (i.kind === "copy" && i.tags.includes(MAGIC_PRESET_ID)) return false;
      return true;
    })
    .map((i) => i.id);
}

function classifyActiveCopySource(
  copies: LibraryItem[],
): { source: MagicChecklistItem["source"]; detail: string } {
  if (!copies.length) {
    return { source: "missing", detail: "No copy yet" };
  }
  const fromPackage = copies.filter(
    (i) =>
      i.tags?.some((t) => t.startsWith("import:")) &&
      !i.tags.includes(MAGIC_PRESET_ID),
  );
  if (fromPackage.length === copies.length) {
    return {
      source: "imported",
      detail: `${fromPackage.length} copy plate(s) from package`,
    };
  }
  if (fromPackage.length) {
    const filled = copies.length - fromPackage.length;
    return {
      source: "imported",
      detail: `${fromPackage.length} from package · ${filled} AI/preset fill`,
    };
  }
  const ai = copies.some((i) => i.tags?.includes("magic"));
  return {
    source: ai ? "ai" : "preset",
    detail: `${copies.length} copy plate(s) filled from brief (not in package)`,
  };
}

/** Rebuild sparse matrix from current rail/activations (Magic + live workspace). */
export function buildMagicSparse(campaign: Campaign, lib: LibraryItem[]): Campaign {
  campaign.rail = deriveRailFromActivations(campaign, lib, campaign.rail);
  const rail = campaign.rail;
  const { hero, openKnobs } = rail;
  const defaultCopy =
    rail.allowedCopy[0] || {
      setup: campaign.brief.prompt?.slice(0, 80) || "Setup",
      punchline: campaign.brief.offer?.slice(0, 80) || "Punch",
      endcard: campaign.brief.offer?.slice(0, 77) || "Offer",
      cta: campaign.brief.cta || "Learn more",
    };

  const handsIds: string[] = openKnobs.includes("hands")
    ? rail.allowedHandsIds.length
      ? [...rail.allowedHandsIds]
      : [hero.handsId].filter(Boolean)
    : [hero.handsId].filter(Boolean);
  if (!handsIds.length) handsIds.push("");

  const attireIds = attireFanAxis(rail);
  const backgroundIds: (string | null)[] = openKnobs.includes("background")
    ? rail.allowedBackgroundIds.length
      ? rail.allowedBackgroundIds
      : [hero.backgroundId]
    : [hero.backgroundId];
  const propAxis: (string | null)[] = openKnobs.includes("prop")
    ? rail.allowedPropIds.length
      ? rail.allowedPropIds
      : hero.propIds[0]
        ? [hero.propIds[0]]
        : [null]
    : [null];

  if (!backgroundIds.length) backgroundIds.push(null);
  if (!propAxis.length) propAxis.push(null);

  const sizes = campaign.outputSizes?.length
    ? campaign.outputSizes
    : magicOutputSizes();

  // Same as Advanced matrix rebuild: revive media by visual signature; retire the rest.
  const prevCells = campaign.matrix.cells ?? [];
  const prevRetired = campaign.matrix.retired ?? [];
  const prevBySig = new Map<string, MatrixCell | RetiredMatrixCell>();
  for (const c of prevRetired) {
    const sig = variantSignature(c);
    const cur = prevBySig.get(sig);
    prevBySig.set(sig, cur ? richerMatrixCell(cur, c) : c);
  }
  for (const c of prevCells) {
    const sig = variantSignature(c);
    const cur = prevBySig.get(sig);
    prevBySig.set(sig, cur ? richerMatrixCell(cur, c) : c);
  }
  const usedPrev = new Set<string>();

  const cells: MatrixCell[] = [];
  let i = 1;
  outer: for (const handsId of handsIds) {
    for (const attireId of attireIds) {
      for (const backgroundId of backgroundIds) {
        for (const propId of propAxis) {
          const propIds =
            openKnobs.includes("prop") && propId
              ? [propId]
              : [...(hero.propIds ?? [])];
          const needsGen = Boolean(
            attireId ||
              backgroundId ||
              propIds.length > 0 ||
              Boolean(handsId && String(handsId).trim()),
          );
          const draft: MatrixCell = {
            cellId: `${campaign.id}_${String(i).padStart(3, "0")}`,
            talentTakeId: hero.talentTakeId,
            handsId: handsId || "",
            motionToken: hero.motionToken || "",
            attireId,
            backgroundId,
            themeId: hero.themeId,
            propIds,
            genOmitIds: [],
            promptOverride: null,
            negativeOverride: null,
            copy: defaultCopy,
            designTokenPackId: campaign.designTokenPackId,
            needsGen,
            selectedForGen: true,
            previewOk: false,
            outputPath: null,
            previewPath: null,
            sizeAssets: sizes.map((s) => ({
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
            })),
            sceneTag: ensureSceneTag(
              { sceneTag: "punchline", sceneSlots: [] },
              campaign.assemblyRecipe,
            ),
            sceneSlots: [],
            status: "draft",
            error: null,
          };
          const sig = variantSignature(draft);
          const prev = prevBySig.get(sig);
          if (prev) {
            usedPrev.add(sig);
            const live = toLiveMatrixCell(prev);
            draft.cellId = live.cellId;
            draft.genOmitIds = [...(live.genOmitIds ?? [])];
            draft.promptOverride = live.promptOverride ?? null;
            draft.negativeOverride = live.negativeOverride ?? null;
            draft.sceneTag = ensureSceneTag(live, campaign.assemblyRecipe);
            draft.selectedForGen = live.selectedForGen !== false;
            draft.sizeAssets = sizes.map((s) => {
              const old = live.sizeAssets?.find((a) => a.sizeId === s.id);
              return {
                sizeId: s.id,
                width: s.width,
                height: s.height,
                aspect: s.aspect,
                previewPath: old?.previewPath ?? null,
                outputPath: old?.outputPath ?? null,
                genPath: old?.genPath ?? null,
                promptHash: old?.promptHash ?? null,
                status: old?.status ?? ("pending" as const),
                error: old?.error ?? null,
              };
            });
            draft.previewPath = live.previewPath;
            draft.outputPath = live.outputPath;
            draft.previewOk = live.previewOk;
            draft.status = live.status;
            draft.error = live.error;
            draft.copy = live.copy ?? draft.copy;
            draft.needsGen = needsGen;
          }
          cells.push(draft);
          i += 1;
          if (cells.length >= campaign.matrix.cap) break outer;
        }
      }
    }
  }

  const violations = evaluateCampaignPolicy(campaign, campaign.rail, lib);
  if (violations.length) {
    throw new Error(
      `Policy blocked magic matrix: ${violations.map((v) => v.message).join("; ")}`,
    );
  }

  const retiredAt = new Date().toISOString();
  const newlyRetired: RetiredMatrixCell[] = prevCells
    .filter((c) => !usedPrev.has(variantSignature(c)))
    .map((c) => ({
      ...c,
      retiredAt,
      reason: "rebuild",
      archiveId: nanoid(10),
    }));
  const keptArchive: RetiredMatrixCell[] = prevRetired
    .filter((c) => !usedPrev.has(variantSignature(c)))
    .map((c) =>
      c.archiveId?.trim() ? c : { ...c, archiveId: nanoid(10) },
    );
  const RETIRED_CAP = 40;
  const retired = [...newlyRetired, ...keptArchive].slice(0, RETIRED_CAP);

  campaign.matrix = {
    ...campaign.matrix,
    cells,
    retired,
  };
  return campaign;
}

export async function prepareMagicCampaign(
  campaignId: string,
  opts: {
    brief?: Brief;
    importId?: string;
    workflowUrl?: string;
    workflowJson?: string;
  },
): Promise<MagicPrepareResult> {
  let campaign = await getCampaign(campaignId);
  if (campaign.mode !== "magic") {
    campaign.mode = "magic";
  }

  const warnings: string[] = [];
  let workflowSource: MagicChecklistItem["source"] = "missing";

  if (opts.brief) {
    campaign.brief = BriefSchema.parse(opts.brief);
  }

  // Resolve workflow: pasted JSON → URL → import package → AI → preset
  if (opts.workflowJson?.trim()) {
    const { pkg, warnings: w } = parseMagicWorkflowJson(
      opts.workflowJson,
      "pasted",
    );
    warnings.push(...w);
    if (pkg) {
      campaign = applyMagicWorkflowToCampaign(campaign, pkg, "imported");
      campaign.brief = mergeBriefHint(campaign.brief, pkg.brief);
      workflowSource = "imported";
    }
  } else if (opts.workflowUrl?.trim()) {
    const { pkg, warnings: w } = await fetchMagicWorkflowUrl(opts.workflowUrl);
    warnings.push(...w);
    if (pkg) {
      campaign = applyMagicWorkflowToCampaign(campaign, pkg, "url");
      campaign.brief = mergeBriefHint(campaign.brief, pkg.brief);
      workflowSource = "url";
    }
  } else if (opts.importId) {
    const detected = await detectMagicWorkflowFromImport(opts.importId);
    warnings.push(...detected.warnings);
    if (detected.package) {
      campaign = applyMagicWorkflowToCampaign(
        campaign,
        detected.package,
        detected.source,
      );
      campaign.brief = mergeBriefHint(campaign.brief, detected.package.brief);
      workflowSource = detected.source;
    }
  }

  const llm = getOrchLlmStatus();
  let workflowDetail = "";

  if (workflowSource === "missing") {
    if (campaign.brief.prompt?.trim() && llm.configured) {
      const syn = await synthesizeComfyTemplateFromBrief(campaign.brief);
      campaign.comfyTemplate = syn.template;
      campaign.assemblyRecipe = {
        ...MAGIC_ASSEMBLY_RECIPE,
        scenes: [...MAGIC_ASSEMBLY_RECIPE.scenes],
      };
      if (!campaign.outputSizes?.length) {
        campaign.outputSizes = magicOutputSizes();
      }
      workflowSource = syn.source === "ai" ? "ai" : "preset";
      workflowDetail = syn.rationale;
    } else {
      campaign = applyMagicWorkflowToCampaign(campaign, null, "preset");
      workflowSource = "preset";
      workflowDetail = llm.configured
        ? "No brief yet — applied magic_att_v1 preset"
        : "LLM unavailable — applied magic_att_v1 preset";
    }
  } else {
    workflowDetail = `Workflow from ${workflowSource}`;
  }

  let lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );

  const importIngredientIds = opts.importId
    ? await resolveImportIngredientIds(
        opts.importId,
        campaign.libraryId || DEFAULT_LIBRARY_ID,
      )
    : [];
  // When an import was used, always scope — even if id list is empty — so we
  // never pull unrelated library copy into "from package".
  const hadImport = Boolean(opts.importId);
  if (hadImport && !importIngredientIds.length) {
    warnings.push(
      "Import committed but no ingredient ids found — package activations empty until re-commit",
    );
  }

  // Copy plates — package, already-active, reuse prior Magic AI drafts, or draft once.
  // Do NOT invent heuristic copy ingredients when LLM is unavailable.
  // Do NOT create a new "Magic copy N" on every Re-check.
  const importSet = hadImport ? new Set(importIngredientIds) : null;
  const priorActiveCopyIds = (campaign.ingredientSet?.activeIds ?? []).filter(
    (id) => lib.find((i) => i.id === id)?.kind === "copy",
  );
  const packageCopy = importSet
    ? lib.filter(
        (i) =>
          i.kind === "copy" &&
          importSet.has(i.id) &&
          !i.tags?.includes(MAGIC_PRESET_ID),
      )
    : [];
  const existingMagicCopy = lib.filter(
    (i) => i.kind === "copy" && i.tags?.includes(MAGIC_PRESET_ID),
  );
  let copySource: MagicChecklistItem["source"] = packageCopy.length
    ? "imported"
    : "missing";
  let copyDetail = packageCopy.length
    ? `${packageCopy.length} copy plate(s) from package`
    : "Skipped — add & activate copy on Ingredients, then Re-check";
  const draftedCopyIds: string[] = [];
  const priorActive = campaign.ingredientSet?.activeIds ?? [];
  if (packageCopy.length) {
    // keep imported
  } else if (priorActiveCopyIds.length) {
    copySource = "preset";
    copyDetail = `${priorActiveCopyIds.length} activated on Ingredients`;
  } else if (existingMagicCopy.length && priorActive.length === 0) {
    // First prepare only — reuse prior AI drafts, don't force them after operator cleanup
    draftedCopyIds.push(...existingMagicCopy.map((i) => i.id));
    copySource = "ai";
    copyDetail = `Reusing ${existingMagicCopy.length} Magic copy plate(s) — not redrafting`;
  } else if (existingMagicCopy.length && priorActive.length > 0) {
    copySource = "missing";
    copyDetail = `${existingMagicCopy.length} Magic copy plate(s) in library — activate on Ingredients if needed`;
  } else if (priorActive.length > 0) {
    // Recheck with operator activations: never invent / force-activate copy.
    copySource = "missing";
    copyDetail =
      "No copy activated — add & activate on Ingredients if needed (matrix uses brief copy)";
  } else if (campaign.brief.prompt?.trim() && llm.configured) {
    const drafted = await draftCopyFromBrief(campaign.brief);
    if (drafted.source === "ai" && drafted.copies.length) {
      let n = 0;
      for (const copy of drafted.copies) {
        const item = await createLibraryIngredient({
          kind: "copy",
          label: `Magic copy ${n + 1}`,
          // Do NOT tag with import: — that would fake "from package" on resume.
          tags: ["magic", MAGIC_PRESET_ID],
          copy,
          promptHint: copy.setup,
          libraryId: campaign.libraryId,
          allowNoMedia: true,
          dedupe: "label",
        });
        draftedCopyIds.push(item.id);
        n += 1;
      }
      copySource = "ai";
      copyDetail = `${drafted.copies.length} AI-filled from brief — ${drafted.rationale}`;
      lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
    } else {
      copySource = "missing";
      copyDetail =
        "LLM did not return copy — Edit → add & activate on Ingredients, then Re-check";
      warnings.push(copyDetail);
    }
  } else if (!llm.configured) {
    copySource = "missing";
    copyDetail =
      "LLM unavailable — skipped. Edit → add & activate copy on Ingredients, then Re-check";
    warnings.push(copyDetail);
  }

  // Prompt hints — prefer active/import scope so we don't rewrite the whole library
  const hintTargets = (
    importSet
      ? lib.filter(
          (i) =>
            importSet.has(i.id) ||
            draftedCopyIds.includes(i.id) ||
            priorActiveCopyIds.includes(i.id),
        )
      : lib.filter(
          (i) =>
            draftedCopyIds.includes(i.id) ||
            priorActiveCopyIds.includes(i.id) ||
            i.kind !== "copy",
        )
  ).slice(0, 40);
  const hintResult = await draftPromptHints(
    campaign.brief,
    hintTargets.map((i) => ({
      id: i.id,
      kind: i.kind,
      label: i.label,
      promptHint: i.promptHint || "",
    })),
  );
  for (const [id, hint] of Object.entries(hintResult.hints)) {
    try {
      await patchLibraryItem(id, { promptHint: hint }, campaign.libraryId);
    } catch {
      /* skip */
    }
  }
  if (Object.keys(hintResult.hints).length) {
    lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
  }

  // Only attach newly drafted copy when there is no operator selection yet,
  // or when drafting ran this turn (ids just created / reused for empty prior).
  const act = pickMagicActivations(lib, {
    importIngredientIds: hadImport ? importIngredientIds : undefined,
    extraIds: draftedCopyIds,
    priorActiveIds: campaign.ingredientSet?.activeIds ?? [],
  });
  if (act.scopedToImport) {
    warnings.push(
      `Package plates active (${act.activeIds.length}) — kept your prior Ingredient activations too`,
    );
  }
  const priorHidden = campaign.ingredientSet?.hiddenIds ?? [];
  const hiddenSet = new Set(priorHidden);
  const knownLib = new Set(lib.map((i) => i.id));
  campaign.ingredientSet = {
    activeIds: act.activeIds.filter(
      (id) => !hiddenSet.has(id) && knownLib.has(id),
    ),
    hiddenIds: priorHidden,
    requireReadyMedia: false,
    contractTalentId:
      act.contractTalentId &&
      !hiddenSet.has(act.contractTalentId) &&
      knownLib.has(act.contractTalentId)
        ? act.contractTalentId
        : null,
  };
  campaign.rail = deriveRailFromActivations(campaign, lib, campaign.rail);
  campaign = buildMagicSparse(campaign, lib);
  campaign = await saveCampaign(campaign);

  return finalizeMagicPrepareResult({
    campaign,
    lib,
    workflowSource,
    workflowDetail,
    copySource,
    copyDetail,
    warnings,
    llmConfigured: llm.configured,
    packageScoped: act.scopedToImport,
  });
}

/** Read-only plan from current campaign state (no LLM / sparse rebuild). */
export async function magicPlanSnapshot(
  campaignId: string,
): Promise<MagicPrepareResult> {
  const campaign = await getCampaign(campaignId);
  const lib = await listLibrary(
    undefined,
    campaign.libraryId || DEFAULT_LIBRARY_ID,
  );
  const llm = getOrchLlmStatus();
  const hasWorkflow = Boolean(
    campaign.comfyTemplate?.campaignGuidelines ||
      campaign.comfyTemplate?.steps?.length,
  );
  const actIds = new Set(campaign.ingredientSet?.activeIds ?? []);
  const activeCopy = lib.filter(
    (i) => i.kind === "copy" && actIds.has(i.id),
  );
  const classified = classifyActiveCopySource(activeCopy);
  const copySource: MagicChecklistItem["source"] =
    activeCopy.length > 0
      ? classified.source
      : campaign.matrix.cells.some((c) => c.copy.setup?.trim())
        ? "preset"
        : "missing";
  const copyDetail =
    activeCopy.length > 0
      ? classified.detail
      : copySource === "preset"
        ? "Copy on matrix cells (brief/preset — not from package)"
        : "No copy yet";

  return finalizeMagicPrepareResult({
    campaign,
    lib,
    workflowSource: hasWorkflow ? "preset" : "missing",
    workflowDetail: hasWorkflow
      ? `base ${campaign.comfyTemplate?.baseWorkflowId || "—"}`
      : "No workflow on campaign",
    copySource,
    copyDetail,
    warnings: [],
    llmConfigured: llm.configured,
    packageScoped: (campaign.ingredientSet?.activeIds ?? []).some((id) => {
      const item = lib.find((i) => i.id === id);
      return Boolean(
        item &&
          item.kind !== "copy" &&
          item.tags?.some((t) => t.startsWith("import:")),
      );
    }),
  });
}

function finalizeMagicPrepareResult(args: {
  campaign: Campaign;
  lib: LibraryItem[];
  workflowSource: MagicChecklistItem["source"];
  workflowDetail: string;
  copySource: MagicChecklistItem["source"];
  copyDetail: string;
  warnings: string[];
  llmConfigured: boolean;
  packageScoped?: boolean;
}): MagicPrepareResult {
  const {
    campaign,
    lib,
    workflowSource,
    workflowDetail,
    copySource,
    copyDetail,
    warnings,
    llmConfigured,
    packageScoped = false,
  } = args;

  const actIds = new Set(campaign.ingredientSet?.activeIds ?? []);
  const activeOf = (kind: LibraryItem["kind"]) =>
    lib.filter((i) => i.kind === kind && actIds.has(i.id));

  const talentId = campaign.ingredientSet?.contractTalentId;
  const talent = talentId
    ? lib.find((i) => i.id === talentId)
    : activeOf("talent")[0];
  const handsReady = activeOf("hands").filter((i) => isPlateReady(i));
  const backgrounds = activeOf("background");
  const attires = activeOf("attire");
  const props = activeOf("prop");
  const motions = activeOf("motion");
  const hasTokens = Boolean(campaign.designTokenPackId);
  const workflowOk = workflowSource !== "missing";

  const gapKind = (
    id: string,
    label: string,
    items: LibraryItem[],
    emptyDetail: string,
  ): MagicChecklistItem => {
    if (items.length) {
      return {
        id,
        label,
        ok: true,
        source: "imported",
        detail: `${items.length} active · ${items.map((i) => i.label).join(", ")}`,
      };
    }
    return {
      id,
      label,
      ok: workflowOk || llmConfigured,
      source: workflowOk || llmConfigured ? (llmConfigured ? "ai" : "preset") : "missing",
      detail: emptyDetail,
    };
  };

  const gapsFilled: MagicChecklistItem[] = [
    {
      id: "brief",
      label: "Brief",
      ok: Boolean(campaign.brief.prompt?.trim()),
      source: campaign.brief.prompt?.trim() ? "imported" : "missing",
      detail: campaign.brief.prompt?.trim()
        ? campaign.brief.prompt.slice(0, 80)
        : "Add a short campaign brief",
    },
    {
      id: "workflow",
      label: "Workflow / recipe",
      ok: workflowOk,
      source: workflowSource,
      detail: workflowDetail || `Source: ${workflowSource}`,
    },
    {
      id: "talent",
      label: "Talent take",
      ok: Boolean(talent && (isPlateReady(talent) || llmConfigured)),
      source: talent ? "imported" : llmConfigured ? "ai" : "missing",
      detail: talent
        ? `${talent.label}${isPlateReady(talent) ? "" : " (needs media)"}`
        : "Upload a talent talking-head video",
    },
    gapKind(
      "hands",
      "Hands plates",
      handsReady,
      packageScoped
        ? "Not in package — Comfy uses workflow hands prompt"
        : "No hands active — AI/workflow prompt fill",
    ),
    gapKind(
      "background",
      "Background",
      backgrounds,
      packageScoped
        ? "Not in package — hero stays without BG (or AI fill)"
        : "No background activated",
    ),
    gapKind(
      "attire",
      "Attire",
      attires,
      "Not in package — skipped",
    ),
    gapKind(
      "prop",
      "Props",
      props,
      "Not in package — skipped",
    ),
    gapKind(
      "motion",
      "Motion",
      motions,
      "Not in package — optional",
    ),
    {
      id: "copy",
      label: "Copy",
      ok: copySource !== "missing",
      source: copySource,
      detail: copyDetail,
    },
    {
      id: "tokens",
      label: "Design tokens",
      ok: hasTokens,
      source: hasTokens ? "preset" : "missing",
      detail: campaign.designTokenPackId || "No token pack",
    },
    {
      id: "connectors",
      label: "Comfy + LLM",
      ok: true,
      source: llmConfigured ? "ai" : "preset",
      detail: `LLM ${llmConfigured ? "on" : "off"} · model ${campaign.modelProfileId}`,
    },
    {
      id: "variants",
      label: "Variant matrix",
      ok: campaign.matrix.cells.length > 0,
      source: packageScoped ? "imported" : campaign.matrix.cells.length ? "preset" : "missing",
      detail: campaign.matrix.cells.length
        ? `${campaign.matrix.cells.length} sparse cell(s) from ${
            packageScoped ? "package activations" : "library activations"
          } · knobs: ${
            campaign.rail.openKnobs.length
              ? campaign.rail.openKnobs.join(", ")
              : "none (hero only)"
          }`
        : "Confirm import to build variants",
    },
  ];

  const libById = new Map(lib.map((i) => [i.id, i]));
  const variants: MagicVariantPlanRow[] = campaign.matrix.cells
    .filter((cell) => cell.selectedForGen !== false)
    .map((cell) => {
    const fillNotes: string[] = [];
    const talentLabel =
      libById.get(cell.talentTakeId)?.label || cell.talentTakeId || "—";
    const attireLabel = cell.attireId
      ? libById.get(cell.attireId)?.label || cell.attireId
      : "original look";
    const bgLabel = cell.backgroundId
      ? libById.get(cell.backgroundId)?.label || cell.backgroundId
      : null;
    const handsLabel = cell.handsId
      ? libById.get(cell.handsId)?.label || cell.handsId
      : null;
    if (!cell.handsId) fillNotes.push("No hands plate — workflow/AI prompt");
    if (cell.attireId) {
      fillNotes.push(`Attire ${attireLabel}`);
    } else if (cell.backgroundId) {
      fillNotes.push("BG swap — keep talent as filmed (Bria)");
    }
    if (cell.backgroundId) {
      fillNotes.push(`BG ${bgLabel}`);
    }
    if (copySource === "ai" || copySource === "preset") {
      fillNotes.push(`Copy ${copySource}-filled from brief`);
    }
    if (workflowSource === "ai" || workflowSource === "preset") {
      fillNotes.push(`Workflow ${workflowSource}`);
    }
    if (cell.needsGen) fillNotes.push("Will run Comfy generate");
    else fillNotes.push("Assemble-only (no Comfy)");

    const bits = [talentLabel, attireLabel];
    if (bgLabel) bits.push(bgLabel);
    if (handsLabel) bits.push(handsLabel);

    return {
      cellId: cell.cellId,
      label: bits.join(" × "),
      talentTakeId: cell.talentTakeId,
      handsId: cell.handsId,
      attireId: cell.attireId,
      backgroundId: cell.backgroundId,
      propIds: cell.propIds ?? [],
      sceneTag: cell.sceneTag,
      needsGen: cell.needsGen,
      copySetup: cell.copy.setup,
      copyPunchline: cell.copy.punchline,
      copyEndcard: cell.copy.endcard,
      fillNotes,
    };
  });

  const selectedCount = variants.length;
  const availableCount = campaign.matrix.cells.length;
  // Patch variants checklist detail with selection math
  const variantsGap = gapsFilled.find((g) => g.id === "variants");
  if (variantsGap && availableCount > 0) {
    variantsGap.detail = `${selectedCount} selected · ${availableCount} available · knobs: ${
      campaign.rail.openKnobs.length
        ? campaign.rail.openKnobs.join(", ")
        : "none (hero only)"
    }`;
    variantsGap.ok = selectedCount > 0;
  }

  const gate = magicCanContinue(gapsFilled);
  const result = {
    campaign,
    gapsFilled,
    variants,
    canContinue: gate.ok,
    reasons: gate.reasons,
    plannedCells: campaign.matrix.cells.length,
    workflowSource,
    warnings,
  };
  void import("./campaignEvents.js").then(({ emitCampaignEvent }) => {
    emitCampaignEvent({
      campaignId: campaign.id,
      column: "magic",
      type: "magic_prepare",
      summary: gate.ok
        ? `Prepared · ${variants.length} variant(s) · workflow ${workflowSource}`
        : `Prepared with gaps · ${gate.reasons.join("; ") || "blocked"}`,
      payload: {
        canContinue: gate.ok,
        variantCount: variants.length,
        workflowSource,
        warnings,
      },
    });
    emitCampaignEvent({
      campaignId: campaign.id,
      column: "celtra",
      type: "celtra_preview",
      summary: `Celtra draft matrix · ${variants.length || campaign.matrix.cells.length} row(s)`,
      payload: {
        rowCount: variants.length || campaign.matrix.cells.length,
      },
    });
    emitCampaignEvent({
      campaignId: campaign.id,
      column: "hopper",
      type: "system",
      summary: `Matrix ready for review · ${campaign.matrix.cells.length} cell(s)`,
      payload: { cellCount: campaign.matrix.cells.length },
    });
  });
  return result;
}

export async function generateMagicCampaign(
  campaignId: string,
): Promise<{ campaign: Campaign; jobs: Job[] }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign.matrix.cells.length) {
    throw new Error("No matrix cells — run magic prepare first");
  }
  const cellIds = campaign.matrix.cells
    .filter((c) => c.needsGen && c.selectedForGen !== false)
    .map((c) => c.cellId);
  if (!cellIds.length) {
    throw new Error(
      "No combos selected for generate — pick combinations in Hopper first",
    );
  }
  // Fill every campaign Settings size that is still missing (not only primary).
  const { enqueueMissingSizeVariantBatch } = await import("./jobs.js");
  const jobs = await enqueueMissingSizeVariantBatch(
    campaignId,
    cellIds.length ? cellIds : undefined,
    { forceRegen: false },
  );
  void import("./campaignEvents.js").then(({ emitCampaignEvent }) => {
    emitCampaignEvent({
      campaignId,
      column: "magic",
      type: "magic_generate",
      summary: `Generate queued · ${jobs.length} job(s) across Settings sizes`,
      payload: {
        jobIds: jobs.map((j) => j.id),
        cellCount: cellIds.length,
        sizeIds: [...new Set(jobs.map((j) => j.sizeId).filter(Boolean))],
      },
    });
    emitCampaignEvent({
      campaignId,
      column: "hopper",
      type: "system",
      summary: `Comfy queue · ${jobs.length} job(s) for review plates`,
      payload: { jobIds: jobs.map((j) => j.id) },
    });
  });
  return { campaign: await getCampaign(campaignId), jobs };
}
