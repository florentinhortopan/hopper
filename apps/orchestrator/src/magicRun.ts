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

function pickMagicActivations(lib: LibraryItem[]): {
  activeIds: string[];
  contractTalentId: string | null;
} {
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
  for (const h of hands.slice(0, 4)) activeIds.add(h.id);
  for (const a of attire.slice(0, 2)) activeIds.add(a.id);
  for (const b of backgrounds.slice(0, 2)) activeIds.add(b.id);
  for (const p of props.slice(0, 2)) activeIds.add(p.id);
  for (const c of copy.slice(0, 3)) activeIds.add(c.id);
  for (const m of motion.slice(0, 1)) activeIds.add(m.id);

  return {
    activeIds: [...activeIds],
    contractTalentId: talent?.id ?? null,
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

  // Copy plates
  const existingCopy = lib.filter((i) => i.kind === "copy");
  let copySource: MagicChecklistItem["source"] = existingCopy.length
    ? "imported"
    : "missing";
  let copyDetail = existingCopy.length
    ? `${existingCopy.length} copy plate(s)`
    : "";
  if (!existingCopy.length && campaign.brief.prompt?.trim()) {
    const drafted = await draftCopyFromBrief(campaign.brief);
    let n = 0;
    for (const copy of drafted.copies) {
      await createLibraryIngredient({
        kind: "copy",
        label: `Magic copy ${n + 1}`,
        tags: ["magic", MAGIC_PRESET_ID],
        copy,
        promptHint: copy.setup,
        libraryId: campaign.libraryId,
        allowNoMedia: true,
      });
      n += 1;
    }
    copySource = drafted.source === "ai" ? "ai" : "preset";
    copyDetail = drafted.rationale;
    lib = await listLibrary(undefined, campaign.libraryId || DEFAULT_LIBRARY_ID);
  }

  // Prompt hints
  const hintResult = await draftPromptHints(
    campaign.brief,
    lib.map((i) => ({
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

  const act = pickMagicActivations(lib);
  campaign.ingredientSet = {
    activeIds: act.activeIds,
    requireReadyMedia: false,
    contractTalentId: act.contractTalentId,
  };
  campaign.rail = deriveRailFromActivations(campaign, lib, campaign.rail);
  campaign = buildMagicSparse(campaign, lib);
  campaign = await saveCampaign(campaign);

  const talent = lib.find((i) => i.id === act.contractTalentId);
  const handsReady = lib.filter(
    (i) => i.kind === "hands" && act.activeIds.includes(i.id),
  );
  const hasTokens = Boolean(campaign.designTokenPackId);

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
      label: "Workflow template",
      ok: true,
      source: workflowSource,
      detail: workflowDetail || `Source: ${workflowSource}`,
    },
    {
      id: "talent",
      label: "Talent take",
      ok: Boolean(talent && (isPlateReady(talent) || llm.configured)),
      source: talent ? "imported" : llm.configured ? "ai" : "missing",
      detail: talent
        ? `${talent.label}${isPlateReady(talent) ? "" : " (needs media)"}`
        : "Upload a talent talking-head video",
    },
    {
      id: "hands",
      label: "Hands / variant plates",
      ok: handsReady.length > 0 || llm.configured,
      source: handsReady.length ? "imported" : llm.configured ? "ai" : "missing",
      detail: handsReady.length
        ? `${handsReady.length} hands plate(s) active`
        : "AI can generate from synthesized prompts",
    },
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
      source: llm.configured ? "ai" : "preset",
      detail: `LLM ${llm.configured ? "on" : "off"} · model ${campaign.modelProfileId}`,
    },
  ];

  const libById = new Map(lib.map((i) => [i.id, i]));
  const variants: MagicVariantPlanRow[] = campaign.matrix.cells.map((cell) => {
    const fillNotes: string[] = [];
    const talentLabel = libById.get(cell.talentTakeId)?.label || cell.talentTakeId || "—";
    const handsLabel = cell.handsId
      ? libById.get(cell.handsId)?.label || cell.handsId
      : "(no hands)";
    if (!cell.handsId) fillNotes.push("No hands plate — talent-only / AI prompt");
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
      label: `${talentLabel} × ${handsLabel}`,
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
