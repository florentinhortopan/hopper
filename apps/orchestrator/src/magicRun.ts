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
import { enqueueVariantBatch } from "./jobs.js";
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
import { deriveRailFromActivations, evaluateCampaignPolicy } from "./policy.js";
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
    /** When set, only activate plates from this import (+ extras like drafted copy). */
    importIngredientIds?: string[];
    /** Extra ids to always include (e.g. copy drafted during prepare). */
    extraIds?: string[];
  },
): {
  activeIds: string[];
  contractTalentId: string | null;
  scopedToImport: boolean;
} {
  const importSet = opts?.importIngredientIds?.length
    ? new Set(opts.importIngredientIds)
    : null;
  const extra = new Set(opts?.extraIds ?? []);

  if (importSet) {
    const fromImport = lib.filter((i) => importSet.has(i.id));
    const extras = lib.filter((i) => extra.has(i.id));
    const scoped = [...fromImport, ...extras];
    const talent =
      scoped.find((i) => i.kind === "talent" && isPlateReady(i)) ||
      scoped.find((i) => i.kind === "talent") ||
      null;
    // Activate every imported plate — do NOT pull unrelated library hands/attire.
    const activeIds = [...new Set(scoped.map((i) => i.id))];
    return {
      activeIds,
      contractTalentId: talent?.id ?? null,
      scopedToImport: true,
    };
  }

  // No import package: keep activations conservative (1 talent + 1 of each kind).
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

  const activeIds = new Set<string>();
  if (talent) activeIds.add(talent.id);
  if (hands[0]) activeIds.add(hands[0].id);
  if (attire[0]) activeIds.add(attire[0].id);
  if (backgrounds[0]) activeIds.add(backgrounds[0].id);
  if (props[0]) activeIds.add(props[0].id);
  if (copy[0]) activeIds.add(copy[0].id);
  if (motion[0]) activeIds.add(motion[0].id);
  for (const id of extra) activeIds.add(id);

  return {
    activeIds: [...activeIds],
    contractTalentId: talent?.id ?? null,
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

function buildMagicSparse(campaign: Campaign, lib: LibraryItem[]): Campaign {
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

  const attireIds: (string | null)[] = openKnobs.includes("attire")
    ? rail.allowedAttireIds.length
      ? rail.allowedAttireIds
      : [hero.attireId]
    : [hero.attireId];
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

  if (!attireIds.length) attireIds.push(null);
  if (!backgroundIds.length) backgroundIds.push(null);
  if (!propAxis.length) propAxis.push(null);

  const sizes = campaign.outputSizes?.length
    ? campaign.outputSizes
    : magicOutputSizes();

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
          cells.push({
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
          });
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

  campaign.matrix = {
    ...campaign.matrix,
    cells,
    retired: (campaign.matrix.retired ?? []) as RetiredMatrixCell[],
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
      campaign.outputSizes = magicOutputSizes();
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

  // Copy plates — package, AI (LLM on), or operator-activated on Ingredients.
  // Do NOT invent heuristic copy ingredients when LLM is unavailable.
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
  let copySource: MagicChecklistItem["source"] = packageCopy.length
    ? "imported"
    : "missing";
  let copyDetail = packageCopy.length
    ? `${packageCopy.length} copy plate(s) from package`
    : "Skipped — add & activate copy on Ingredients, then Re-check";
  const draftedCopyIds: string[] = [];
  if (!packageCopy.length && campaign.brief.prompt?.trim() && llm.configured) {
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
        });
        draftedCopyIds.push(item.id);
        n += 1;
      }
      copySource = "ai";
      copyDetail = `${drafted.copies.length} AI-filled from brief — ${drafted.rationale}`;
      lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
    } else if (priorActiveCopyIds.length) {
      copySource = "preset";
      copyDetail = `${priorActiveCopyIds.length} activated on Ingredients`;
    } else {
      copySource = "missing";
      copyDetail =
        "LLM did not return copy — Edit → add & activate on Ingredients, then Re-check";
      warnings.push(copyDetail);
    }
  } else if (!packageCopy.length && priorActiveCopyIds.length) {
    copySource = "preset";
    copyDetail = `${priorActiveCopyIds.length} activated on Ingredients`;
  } else if (!packageCopy.length && !llm.configured) {
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

  const act = pickMagicActivations(lib, {
    importIngredientIds: hadImport ? importIngredientIds : undefined,
    extraIds: [...draftedCopyIds, ...priorActiveCopyIds],
  });
  if (act.scopedToImport) {
    warnings.push(
      `Activations scoped to package (${act.activeIds.length} plate(s)) — not the full library`,
    );
  }
  const priorHidden = campaign.ingredientSet?.hiddenIds ?? [];
  const hiddenSet = new Set(priorHidden);
  campaign.ingredientSet = {
    activeIds: act.activeIds.filter((id) => !hiddenSet.has(id)),
    hiddenIds: priorHidden,
    requireReadyMedia: false,
    contractTalentId:
      act.contractTalentId && !hiddenSet.has(act.contractTalentId)
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
  const variants: MagicVariantPlanRow[] = campaign.matrix.cells.map((cell) => {
    const fillNotes: string[] = [];
    const talentLabel =
      libById.get(cell.talentTakeId)?.label || cell.talentTakeId || "—";
    const handsLabel = cell.handsId
      ? libById.get(cell.handsId)?.label || cell.handsId
      : "(no hands)";
    if (!cell.handsId) fillNotes.push("No hands plate — workflow/AI prompt");
    if (cell.backgroundId) {
      fillNotes.push(
        `BG ${libById.get(cell.backgroundId)?.label || cell.backgroundId}`,
      );
    }
    if (copySource === "ai" || copySource === "preset") {
      fillNotes.push(`Copy ${copySource}-filled from brief`);
    }
    if (workflowSource === "ai" || workflowSource === "preset") {
      fillNotes.push(`Workflow ${workflowSource}`);
    }
    if (cell.needsGen) fillNotes.push("Will run Comfy generate");
    else fillNotes.push("Assemble-only (no Comfy)");

    return {
      cellId: cell.cellId,
      label: `${talentLabel} × ${handsLabel}${
        cell.backgroundId
          ? ` × ${libById.get(cell.backgroundId)?.label || "bg"}`
          : ""
      }`,
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

  const gate = magicCanContinue(gapsFilled);
  return {
    campaign,
    gapsFilled,
    variants,
    canContinue: gate.ok,
    reasons: gate.reasons,
    plannedCells: campaign.matrix.cells.length,
    workflowSource,
    warnings,
  };
}

export async function generateMagicCampaign(
  campaignId: string,
): Promise<{ campaign: Campaign; jobs: Job[] }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign.matrix.cells.length) {
    throw new Error("No matrix cells — run magic prepare first");
  }
  const cellIds = campaign.matrix.cells
    .filter((c) => c.needsGen)
    .map((c) => c.cellId);
  const jobs = await enqueueVariantBatch(
    campaignId,
    cellIds.length ? cellIds : undefined,
    { forceRegen: false },
  );
  return { campaign: await getCampaign(campaignId), jobs };
}
