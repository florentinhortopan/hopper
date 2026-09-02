import { z } from "zod";
import {
  CampaignIngredientSetSchema,
  TalentContractSchema,
} from "./contracts.js";
import { LibraryKindSchema, MediaTypeSchema, OpenKnobSchema } from "./ingredientKinds.js";
import {
  CellSizeAssetSchema,
  DEFAULT_OUTPUT_SIZE_IDS,
  META_RECOMMENDED_SIZE_IDS,
  OutputSizeSchema,
  resolveOutputSizes,
} from "./sizes.js";

export const TemplateIdSchema = z.literal("paid_social_9x16_v1");
export type TemplateId = z.infer<typeof TemplateIdSchema>;

export const CopySchema = z.object({
  setup: z.string(),
  punchline: z.string(),
  endcard: z.string(),
  cta: z.string(),
});
export type Copy = z.infer<typeof CopySchema>;

export const DesignTokensSchema = z.object({
  id: z.string(),
  label: z.string(),
  colors: z.object({
    background: z.string(),
    foreground: z.string(),
    accent: z.string(),
    muted: z.string(),
  }),
  fonts: z.object({
    display: z.string(),
    body: z.string(),
  }),
  endCardLayout: z.object({
    ctaStyle: z.enum(["solid", "outline"]).default("solid"),
    logoPosition: z.enum(["top", "bottom"]).default("bottom"),
  }),
  socialChrome: z.boolean().default(false),
  /** Operator phrases for Comfy; empty → deriveComfyStyleHints from colors/fonts. */
  comfyStyleHints: z.array(z.string()).default([]),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

export const BriefSchema = z.object({
  prompt: z.string(),
  audience: z.string().default(""),
  offer: z.string().default(""),
  cta: z.string().default(""),
  mustSay: z.array(z.string()).default([]),
  mustNot: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export const IngredientLocksSchema = z.object({
  face_locked: z.boolean().default(true),
  voice_locked: z.boolean().default(true),
  performance_locked: z.boolean().default(true),
});

export const IngredientStatusSchema = z.enum([
  "draft",
  "ready",
  "generating",
  "failed",
]);
export type IngredientStatus = z.infer<typeof IngredientStatusSchema>;

export const IngredientSourceModeSchema = z.enum([
  "upload",
  "prompt_only",
  "generated",
]);
export type IngredientSourceMode = z.infer<typeof IngredientSourceModeSchema>;

export const LibraryItemSchema = z.object({
  id: z.string(),
  kind: LibraryKindSchema,
  label: z.string(),
  /** Empty when prompt-only / awaiting generation */
  path: z.string().default(""),
  tags: z.array(z.string()).default([]),
  /** @deprecated prefer contract on talent items */
  locks: IngredientLocksSchema.optional(),
  /** Full agreement for talent takes */
  contract: TalentContractSchema.optional(),
  /** English natural-language hint for model prompts */
  promptHint: z.string().default(""),
  /** Optional negative / avoid phrasing for models that accept it */
  negativeHint: z.string().default(""),
  /** Defaults favor legacy seeded assets; drafts set mediaType=none explicitly */
  mediaType: MediaTypeSchema.default("video"),
  status: IngredientStatusSchema.default("ready"),
  sourceMode: IngredientSourceModeSchema.default("upload"),
  /** Talent this ingredient is derived from (for wardrobe/BG/prop gen) */
  sourceTalentId: z.string().nullable().default(null),
  /** Structured copy for kind=copy plates */
  copy: CopySchema.nullish(),
  /** Soft-hide from default library / Ingredients lists (recoverable) */
  archived: z.boolean().default(false),
  /** ISO timestamp — set on create; empty on legacy plates */
  createdAt: z.string().default(""),
  /** ISO timestamp — bumped on media replace / metadata patch */
  updatedAt: z.string().default(""),
  /** SHA-256 of media bytes (when known) — used to skip duplicate uploads */
  contentHash: z.string().nullable().default(null),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

/** Default window for “Recently uploaded” ingredient filters (7 days). */
export const RECENT_LIBRARY_ITEM_MS = 7 * 24 * 60 * 60 * 1000;

/** Normalize label for duplicate matching (trim + collapse space + lower). */
export function normalizeLibraryLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when createdAt/updatedAt falls within the recent window. */
export function isRecentLibraryItem(
  item: { createdAt?: string | null; updatedAt?: string | null },
  nowMs = Date.now(),
  windowMs = RECENT_LIBRARY_ITEM_MS,
): boolean {
  const raw = (item.updatedAt || item.createdAt || "").trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= windowMs && nowMs - t >= 0;
}

export const IngredientRailSchema = z.object({
  hero: z.object({
    talentTakeId: z.string(),
    handsId: z.string(),
    motionToken: z.string(),
    attireId: z.string().nullable().default(null),
    backgroundId: z.string().nullable().default(null),
    themeId: z.string().nullable().default(null),
    propIds: z.array(z.string()).default([]),
  }),
  openKnobs: z.array(OpenKnobSchema).default(["hands", "copy"]),
  allowedHandsIds: z.array(z.string()).default([]),
  allowedAttireIds: z.array(z.string()).default([]),
  allowedBackgroundIds: z.array(z.string()).default([]),
  allowedPropIds: z.array(z.string()).default([]),
  allowedCopy: z.array(CopySchema).default([]),
});
export type IngredientRail = z.infer<typeof IngredientRailSchema>;

/** Which plate fills a recipe scene for this matrix row. */
export const SceneSlotSourceSchema = z.enum(["talent", "hands", "gen", "endcard"]);
export type SceneSlotSource = z.infer<typeof SceneSlotSourceSchema>;

export const SceneSlotSchema = z.object({
  sceneId: z.string(),
  source: SceneSlotSourceSchema,
});
export type SceneSlot = z.infer<typeof SceneSlotSchema>;

export const SceneMediaItemSchema = z.object({
  sceneId: z.string(),
  src: z.string(),
  kind: z.enum(["video", "still", "endcard"]),
});
export type SceneMediaItem = z.infer<typeof SceneMediaItemSchema>;

export const MatrixCellSchema = z.object({
  cellId: z.string(),
  talentTakeId: z.string(),
  handsId: z.string(),
  motionToken: z.string(),
  attireId: z.string().nullable().default(null),
  backgroundId: z.string().nullable().default(null),
  themeId: z.string().nullable().default(null),
  propIds: z.array(z.string()).default([]),
  /**
   * Plate ids unchecked on this matrix row — omitted from Comfy prompt only.
   * Does not change the combo / archive identity (handsId etc. stay set).
   */
  genOmitIds: z.array(z.string()).default([]),
  /** Per-cell positive prompt override; non-empty trim wins over auto-built pack text. */
  promptOverride: z.string().nullable().default(null),
  /** Per-cell negative prompt override; non-empty trim wins over auto-built pack text. */
  negativeOverride: z.string().nullable().default(null),
  copy: CopySchema,
  designTokenPackId: z.string(),
  needsGen: z.boolean().default(false),
  previewOk: z.boolean().default(false),
  /** @deprecated prefer sizeAssets — kept for single-size BC */
  outputPath: z.string().nullable().default(null),
  previewPath: z.string().nullable().default(null),
  /** Explicit per-size generated / rendered assets */
  sizeAssets: z.array(CellSizeAssetSchema).default([]),
  /**
   * Which recipe scene this row's Comfy plate fills in Remotion.
   * Other beats use talent / hands / endcard defaults.
   */
  sceneTag: z.string().nullable().default(null),
  /**
   * @deprecated Migrated into sceneTag — kept so old campaign JSON still parses.
   */
  sceneSlots: z.array(SceneSlotSchema).optional().default([]),
  status: z
    .enum(["draft", "previewing", "preview_ok", "rendering", "ready", "failed"])
    .default("draft"),
  error: z.string().nullable().default(null),
});
export type MatrixCell = z.infer<typeof MatrixCellSchema>;

/** Apply per-row genOmitIds for Comfy / prompt (identity fields unchanged on disk). */
export function cellForGeneration<T extends MatrixCell>(cell: T): T {
  const omit = new Set((cell.genOmitIds ?? []).filter(Boolean));
  if (!omit.size) return cell;
  return {
    ...cell,
    handsId: cell.handsId && omit.has(cell.handsId) ? "" : cell.handsId,
    attireId:
      cell.attireId && omit.has(cell.attireId) ? null : cell.attireId,
    backgroundId:
      cell.backgroundId && omit.has(cell.backgroundId)
        ? null
        : cell.backgroundId,
    themeId: cell.themeId && omit.has(cell.themeId) ? null : cell.themeId,
    propIds: (cell.propIds ?? []).filter((p) => !omit.has(p)),
  };
}

/** Visual combo identity — used to reuse genPath across Rebuilds. */
export function variantSignature(cell: {
  talentTakeId?: string | null;
  handsId?: string | null;
  attireId?: string | null;
  backgroundId?: string | null;
  propIds?: string[] | null;
  themeId?: string | null;
}): string {
  const props = [...(cell.propIds ?? [])].filter(Boolean).sort().join(",");
  return [
    cell.talentTakeId || "",
    cell.handsId || "",
    cell.attireId || "",
    cell.backgroundId || "",
    cell.themeId || "",
    props,
  ].join("|");
}

export const RetiredMatrixCellSchema = MatrixCellSchema.extend({
  retiredAt: z.string(),
  reason: z.string().default("rebuild"),
  /** Stable identity for archive refs (cellId can collide after rebuild). */
  archiveId: z.string().default(""),
});
export type RetiredMatrixCell = z.infer<typeof RetiredMatrixCellSchema>;

export const MatrixSchema = z.object({
  cells: z.array(MatrixCellSchema),
  cap: z.number().default(20),
  /**
   * Combos dropped by Build from activations (kept so media isn’t “lost”).
   * Selectable in Variant review / Review / Package; not in the live activation fan.
   */
  retired: z.array(RetiredMatrixCellSchema).default([]),
});
export type Matrix = z.infer<typeof MatrixSchema>;

export const ReviewDecisionSchema = z.enum(["approved", "rejected", "pending"]);
export const ReviewEntrySchema = z.object({
  /**
   * Live cellId or archive:<archiveId> ref (see matrixRefs).
   * Field name kept for API compatibility.
   */
  cellId: z.string(),
  /**
   * When set, decision applies to one Settings size only.
   * Null/omitted = whole-variant decision (legacy Keep/Kill).
   */
  sizeId: z.string().nullable().default(null),
  decision: ReviewDecisionSchema.default("pending"),
  reasonTags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  updatedAt: z.string(),
});
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/** Resolve decision for a cell, optionally scoped to one size (size overrides cell). */
export function reviewDecisionFor(
  reviews: ReviewEntry[],
  cellId: string,
  sizeId?: string | null,
): ReviewDecision {
  if (sizeId) {
    const sized = reviews.find(
      (r) => r.cellId === cellId && (r.sizeId || null) === sizeId,
    );
    if (sized) return sized.decision;
  }
  const cell = reviews.find(
    (r) => r.cellId === cellId && (r.sizeId == null || r.sizeId === ""),
  );
  return cell?.decision ?? "pending";
}

/** Size is zip-packable when it has a plate and is kept (size or parent cell). */
export function isSizePackable(
  reviews: ReviewEntry[],
  cellId: string,
  sizeId: string,
  hasPlate: boolean,
): boolean {
  if (!hasPlate) return false;
  const sized = reviews.find(
    (r) => r.cellId === cellId && (r.sizeId || null) === sizeId,
  );
  if (sized) return sized.decision === "approved";
  const cell = reviews.find(
    (r) => r.cellId === cellId && (r.sizeId == null || r.sizeId === ""),
  );
  return cell?.decision === "approved";
}

/** Remotion assemble structure — one recipe for all output sizes. */
export const AssemblySceneSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.enum(["setup", "punchline", "endcard", "custom"]).default("custom"),
  durationSeconds: z.number().positive().default(3),
});
export type AssemblyScene = z.infer<typeof AssemblySceneSchema>;

export const DEFAULT_ASSEMBLY_SCENES: AssemblyScene[] = [
  { id: "setup", label: "Setup", role: "setup", durationSeconds: 3 },
  { id: "punchline", label: "Punchline", role: "punchline", durationSeconds: 4 },
  { id: "endcard", label: "End card", role: "endcard", durationSeconds: 3 },
];

export const AssemblyRecipeSchema = z.object({
  scenes: z.array(AssemblySceneSchema).default(DEFAULT_ASSEMBLY_SCENES),
  /** When set, scales scene durations to match; otherwise sum(scenes). */
  targetDurationSeconds: z.number().positive().nullable().default(null),
  /** Last copy-based suggestion shown in Settings (informational). */
  copySuggestedSeconds: z.number().positive().nullable().default(null),
});
export type AssemblyRecipe = z.infer<typeof AssemblyRecipeSchema>;

/** Campaign-level Comfy enrichment (not a node editor). */
export const ComfyTemplateStepSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  /**
   * Semantic patch key from workflow maps (e.g. prompt, duration, productRef)
   * or "guidelines" (merged into positive only).
   */
  patchKey: z.string().default("prompt"),
  prompt: z.string().default(""),
  /** Optional library ingredient id whose path is written to patchKey */
  ingredientId: z.string().nullable().default(null),
});
export type ComfyTemplateStep = z.infer<typeof ComfyTemplateStepSchema>;

export const ComfyTemplateSchema = z.object({
  /** Informational preferred workflow; live routing still uses pipeline pickers. */
  baseWorkflowId: z.string().nullable().default(null),
  campaignGuidelines: z.string().default(""),
  steps: z.array(ComfyTemplateStepSchema).default([]),
});
export type ComfyTemplate = z.infer<typeof ComfyTemplateSchema>;

export const DEFAULT_COMFY_TEMPLATE: ComfyTemplate = {
  baseWorkflowId: null,
  campaignGuidelines: "",
  steps: [],
};

export function normalizeComfyTemplate(
  t: ComfyTemplate | null | undefined,
): ComfyTemplate {
  const parsed = ComfyTemplateSchema.safeParse(t ?? {});
  if (!parsed.success) return { ...DEFAULT_COMFY_TEMPLATE, steps: [] };
  return {
    baseWorkflowId: parsed.data.baseWorkflowId ?? null,
    campaignGuidelines: parsed.data.campaignGuidelines ?? "",
    steps: parsed.data.steps ?? [],
  };
}

export const DEFAULT_ASSEMBLY_RECIPE: AssemblyRecipe = {
  scenes: DEFAULT_ASSEMBLY_SCENES,
  targetDurationSeconds: null,
  copySuggestedSeconds: null,
};

/** Soft speaking-rate estimate (~2.5 words/sec) from active copy — informs recipe, does not constrain. */
export function suggestAssemblySecondsFromCopy(copy: {
  setup?: string;
  punchline?: string;
  endcard?: string;
}): number {
  const text = [copy.setup, copy.punchline, copy.endcard].filter(Boolean).join(" ");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 10;
  const secs = Math.round(words / 2.5);
  return Math.min(30, Math.max(6, secs));
}

/** Always return a concrete recipe for Remotion (never undefined). */
export function normalizeAssemblyRecipe(
  recipe: AssemblyRecipe | null | undefined,
): AssemblyRecipe {
  const parsed = AssemblyRecipeSchema.safeParse(recipe ?? {});
  if (!parsed.success) {
    return { ...DEFAULT_ASSEMBLY_RECIPE, scenes: [...DEFAULT_ASSEMBLY_SCENES] };
  }
  const scenes = parsed.data.scenes.length
    ? parsed.data.scenes
    : [...DEFAULT_ASSEMBLY_SCENES];
  return {
    scenes,
    targetDurationSeconds: parsed.data.targetDurationSeconds ?? null,
    copySuggestedSeconds: parsed.data.copySuggestedSeconds ?? null,
  };
}

export function assemblyRecipeTotalSeconds(recipe: AssemblyRecipe): number {
  if (recipe.targetDurationSeconds && recipe.targetDurationSeconds > 0) {
    return recipe.targetDurationSeconds;
  }
  const sum = recipe.scenes.reduce((n, s) => n + s.durationSeconds, 0);
  return sum > 0 ? sum : 10;
}

export function assemblySceneFrames(
  recipe: AssemblyRecipe,
  fps = 30,
): { id: string; label: string; role: AssemblyScene["role"]; frames: number }[] {
  const scenes = recipe.scenes.length ? recipe.scenes : DEFAULT_ASSEMBLY_SCENES;
  const rawSum = scenes.reduce((n, s) => n + s.durationSeconds, 0) || 1;
  const target = assemblyRecipeTotalSeconds({ ...recipe, scenes });
  return scenes.map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role,
    frames: Math.max(1, Math.round((s.durationSeconds / rawSum) * target * fps)),
  }));
}

/** Operator-facing one-liner: "Setup 3s · Punchline 4s · End card 3s (10s)" */
export function formatAssemblyRecipeSummary(
  recipe: AssemblyRecipe | null | undefined,
): string {
  const r = normalizeAssemblyRecipe(recipe);
  const total = assemblyRecipeTotalSeconds(r);
  const parts = r.scenes.map((s) => `${s.label} ${s.durationSeconds}s`);
  return `${parts.join(" · ")} (${total}s)`;
}

export function defaultSceneSlotSource(
  scene: AssemblyScene,
  hasHands: boolean,
): SceneSlotSource {
  if (scene.role === "endcard" || scene.id === "endcard") return "endcard";
  if (scene.role === "punchline" || scene.id === "punchline") {
    return hasHands ? "hands" : "gen";
  }
  return "talent";
}

/** Default scene id for a new variant tag (punchline preferred). */
export function defaultSceneTag(
  recipe: AssemblyRecipe | null | undefined,
): string {
  const r = normalizeAssemblyRecipe(recipe);
  const punch = r.scenes.find(
    (s) => s.role === "punchline" || s.id === "punchline",
  );
  if (punch) return punch.id;
  const nonEnd = r.scenes.find(
    (s) => s.role !== "endcard" && s.id !== "endcard",
  );
  return nonEnd?.id || r.scenes[0]?.id || "setup";
}

/**
 * Resolve a concrete sceneTag for a cell. Migrates legacy sceneSlots where a
 * slot source was `gen`.
 */
export function ensureSceneTag(
  cell: {
    sceneTag?: string | null;
    sceneSlots?: SceneSlot[] | null;
  },
  recipe: AssemblyRecipe | null | undefined,
): string {
  const r = normalizeAssemblyRecipe(recipe);
  const ids = new Set(r.scenes.map((s) => s.id));
  const tagged = cell.sceneTag?.trim();
  if (tagged && ids.has(tagged)) return tagged;

  const fromSlots = (cell.sceneSlots ?? []).find((s) => s.source === "gen");
  if (fromSlots && ids.has(fromSlots.sceneId)) return fromSlots.sceneId;

  return defaultSceneTag(r);
}

/** @deprecated Prefer ensureSceneTag — kept for brief BC during migrate. */
export function ensureSceneSlots(
  cell: { sceneSlots?: SceneSlot[] | null; handsId?: string | null; sceneTag?: string | null },
  recipe: AssemblyRecipe | null | undefined,
): SceneSlot[] {
  const r = normalizeAssemblyRecipe(recipe);
  const hasHands = Boolean(cell.handsId?.trim());
  const tag = ensureSceneTag(cell, r);
  return r.scenes.map((scene) => {
    if (scene.id === tag) {
      return { sceneId: scene.id, source: "gen" as const };
    }
    return {
      sceneId: scene.id,
      source: defaultSceneSlotSource(scene, hasHands),
    };
  });
}

export function formatSceneTagSummary(
  sceneTag: string | null | undefined,
  recipe: AssemblyRecipe | null | undefined,
): string {
  const r = normalizeAssemblyRecipe(recipe);
  const id = sceneTag || defaultSceneTag(r);
  const scene = r.scenes.find((s) => s.id === id);
  return `tag ${scene?.label || id}`;
}

export function formatSceneSlotsSummary(slots: SceneSlot[]): string {
  if (!slots.length) return "default slots";
  return `slots ${slots.map((s) => s.source).join("/")}`;
}

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  templateId: TemplateIdSchema,
  modelProfileId: z.string().default("sd15"),
  brief: BriefSchema,
  designTokenPackId: z.string(),
  rail: IngredientRailSchema,
  matrix: MatrixSchema,
  /** Per-campaign activation of global library ingredients */
  ingredientSet: CampaignIngredientSetSchema.default({
    activeIds: [],
    hiddenIds: [],
    requireReadyMedia: true,
    contractTalentId: null,
  }),
  /** Confirmed delivery / gen sizes for this campaign */
  outputSizes: z
    .array(OutputSizeSchema)
    .default(resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS])),
  /** Which library pack this campaign reads ingredients from */
  libraryId: z.string().default("default"),
  /** Remotion assemble structure (applies to all sizes) */
  assemblyRecipe: AssemblyRecipeSchema.default(DEFAULT_ASSEMBLY_RECIPE),
  /**
   * Celtra content-matrix profile for Package export
   * (e.g. guarantee_tranche3_social_video_v1).
   */
  celtraTemplateProfileId: z
    .string()
    .default("guarantee_tranche3_social_video_v1"),
  /** Campaign Comfy guidelines + between-node step prompts / binds */
  comfyTemplate: ComfyTemplateSchema.default(DEFAULT_COMFY_TEMPLATE),
  /** standard = full StepNav; magic = two-step popup flow */
  mode: z.enum(["standard", "magic"]).default("standard"),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const LibraryItemPatchSchema = z.object({
  label: z.string().optional(),
  /** Move plate into another ingredient category (hands → background, etc.) */
  kind: LibraryKindSchema.optional(),
  tags: z.array(z.string()).optional(),
  locks: IngredientLocksSchema.optional(),
  contract: TalentContractSchema.optional(),
  promptHint: z.string().optional(),
  negativeHint: z.string().optional(),
  sourceTalentId: z.string().nullable().optional(),
  status: IngredientStatusSchema.optional(),
  copy: CopySchema.nullable().optional(),
  archived: z.boolean().optional(),
});
export type LibraryItemPatch = z.infer<typeof LibraryItemPatchSchema>;

export const JobSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  cellId: z.string().nullable(),
  /** Copy plate applied at assemble (messaging only — not a Comfy axis). */
  copyId: z.string().nullable().default(null),
  sizeId: z.string().nullable().default(null),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
  stage: z.enum([
    "preview",
    "render",
    "package",
    "comfy_stub",
    "ingredient_gen",
    "plates",
  ]),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  progress: z.number().min(0).max(1).default(0),
  message: z.string().default(""),
  resultPath: z.string().nullable().default(null),
  /** Heuristic wall-clock for queue ETA UI (Comfy Cloud has no %; Remotion does). */
  etaSeconds: z.number().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const RemotionPropsSchema = z.object({
  talentVideoSrc: z.string(),
  handsVideoSrc: z.string(),
  motionToken: z.string(),
  copy: CopySchema,
  designTokens: DesignTokensSchema,
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  sizeId: z.string().default("v_9x16_1080"),
  aspect: z.string().default("9:16"),
  /** Assemble recipe from campaign Settings — Remotion scene beats (not Comfy). */
  assemblyRecipe: AssemblyRecipeSchema.optional(),
  /** Resolved media per recipe scene (from cell.sceneSlots). */
  sceneMedia: z.array(SceneMediaItemSchema).optional(),
});
export type RemotionProps = z.infer<typeof RemotionPropsSchema>;

/** Which video/still pipeline will run for a matrix cell. */
export const VideoPipelineSchema = z.enum([
  "bria_replace",
  "minimax_h3_r2v",
  "still",
]);
export type VideoPipelineId = z.infer<typeof VideoPipelineSchema>;

/** Model-ready generation payload (English) for Comfy / selected profile */
export const PromptPackSchema = z.object({
  language: z.literal("en"),
  modelProfileId: z.string(),
  format: z.enum(["natural", "sdxl"]),
  workflowId: z.string(),
  knob: z.enum(["hands", "attire", "background", "prop"]),
  positive: z.string(),
  negative: z.string(),
  /** Stable hash for plate cache (ingredient + size + context; excludes forceRegen salt) */
  promptHash: z.string(),
  patches: z.record(z.unknown()),
  refs: z.array(
    z.object({
      kind: LibraryKindSchema,
      id: z.string(),
      label: z.string(),
      path: z.string(),
      mediaType: MediaTypeSchema,
      patchKey: z.string().nullable(),
      role: z
        .enum(["talent", "product", "wardrobe", "background", "motion", "prop", "other"])
        .default("other"),
    }),
  ),
  /** Pipeline picked for this cell (same as Comfy job path). */
  pipeline: VideoPipelineSchema.default("still"),
  /** Whether the current pipeline consumes positive prompt text. */
  promptTextUsed: z.boolean().default(true),
  /** Whether the current pipeline consumes negative prompt text. */
  negativeTextUsed: z.boolean().default(true),
  /** True when cell.promptOverride replaced the auto-built positive. */
  promptOverridden: z.boolean().default(false),
  /** True when cell.negativeOverride replaced the auto-built negative. */
  negativeOverridden: z.boolean().default(false),
  context: z
    .object({
      cellId: z.string(),
      sizeId: z.string(),
      briefPrompt: z.string().default(""),
      offer: z.string().default(""),
      audience: z.string().default(""),
      cta: z.string().default(""),
      mustSay: z.array(z.string()).default([]),
      copySetup: z.string().default(""),
      copyPunchline: z.string().default(""),
      copyEndcard: z.string().default(""),
      copyCta: z.string().default(""),
    })
    .optional(),
});
export type PromptPack = z.infer<typeof PromptPackSchema>;

/**
 * @deprecated Internal debug lineage only. Celtra ingest uses profile-driven
 * wide rows from `@attatta/shared` celtraProfiles (Social Video XLSX).
 */
export const CeltraMatrixRowSchema = z.object({
  variantId: z.string(),
  campaignId: z.string(),
  videoPath: z.string(),
  aspect: z.string().default("9:16"),
  primaryText: z.string(),
  headline: z.string(),
  cta: z.string(),
  landingUrl: z.string().default(""),
  angle: z.string().default(""),
  handsId: z.string(),
  talentTakeId: z.string(),
  attireId: z.string().nullable().default(null),
  backgroundId: z.string().nullable().default(null),
  propIds: z.array(z.string()).default([]),
  designTokenPackId: z.string(),
  approvalStatus: z.literal("approved"),
  reviewNotes: z.string().default(""),
  /** Celtra frame this plate fills when known */
  celtraFrameId: z.enum(["F1", "F2", "F3"]).nullable().default(null),
  platePath: z.string().default(""),
});
export type CeltraMatrixRow = z.infer<typeof CeltraMatrixRowSchema>;

export {
  LibraryKindSchema,
  MediaTypeSchema,
  OpenKnobSchema,
  INGREDIENT_KINDS,
  getIngredientKind,
  LIBRARY_KINDS,
} from "./ingredientKinds.js";
export type { LibraryKind, MediaType, OpenKnob, IngredientKindDef } from "./ingredientKinds.js";

export {
  TalentContractSchema,
  CampaignIngredientSetSchema,
  PolicyViolationSchema,
  DEFAULT_TALENT_CONTRACT,
} from "./contracts.js";
export type {
  TalentContract,
  CampaignIngredientSet,
  PolicyViolation,
} from "./contracts.js";

export {
  OutputSizeSchema,
  CellSizeAssetSchema,
  OUTPUT_SIZE_CATALOG,
  DEFAULT_OUTPUT_SIZE_IDS,
  META_RECOMMENDED_SIZE_IDS,
  resolveOutputSizes,
  genDimsForSize,
} from "./sizes.js";
export type { OutputSize, CellSizeAsset } from "./sizes.js";
