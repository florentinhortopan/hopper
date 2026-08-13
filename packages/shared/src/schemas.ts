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
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

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
   * Selectable in Preview / Review / Package; not in the live activation fan.
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
  decision: ReviewDecisionSchema.default("pending"),
  reasonTags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  updatedAt: z.string(),
});
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;

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
    requireReadyMedia: true,
    contractTalentId: null,
  }),
  /** Confirmed delivery / gen sizes for this campaign */
  outputSizes: z
    .array(OutputSizeSchema)
    .default(resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS])),
  /** Which library pack this campaign reads ingredients from */
  libraryId: z.string().default("default"),
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

export const CeltraMatrixRowSchema = z.object({
  variantId: z.string(),
  campaignId: z.string(),
  videoPath: z.string(),
  aspect: z.literal("9:16"),
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
