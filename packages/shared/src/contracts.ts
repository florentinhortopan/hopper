import { z } from "zod";
import { LibraryKindSchema, OpenKnobSchema } from "./ingredientKinds.js";

/**
 * Talent agreement guardrails. Face/voice/performance stay locked by default;
 * wardrobe / BG / props-on-talent are opt-in per contract.
 */
export const TalentContractSchema = z.object({
  face_locked: z.boolean().default(true),
  voice_locked: z.boolean().default(true),
  performance_locked: z.boolean().default(true),
  /** Wardrobe / attire AI allowed */
  allow_attire: z.boolean().default(true),
  /** Background re-site allowed */
  allow_background: z.boolean().default(true),
  /** Props that touch talent plate (hats, ribbons on person) */
  allow_props_on_talent: z.boolean().default(true),
  /** Hands / product plate variants allowed */
  allow_hands_variants: z.boolean().default(true),
  notes: z.string().default(""),
});
export type TalentContract = z.infer<typeof TalentContractSchema>;

export const DEFAULT_TALENT_CONTRACT: TalentContract = TalentContractSchema.parse({});

/** Campaign-scoped activation — library is global; campaigns opt in. */
export const CampaignIngredientSetSchema = z.object({
  /** Ingredient IDs activated for this campaign (empty = legacy: all library visible) */
  activeIds: z.array(z.string()).default([]),
  /**
   * Soft-removed from this campaign’s Ingredients list only.
   * Plate stays in the library pack and other campaigns.
   */
  hiddenIds: z.array(z.string()).default([]),
  /** If true, rail/matrix/assemble only accept ingredients with ready media plates */
  requireReadyMedia: z.boolean().default(true),
  /** Talent take that owns contract evaluation for this batch */
  contractTalentId: z.string().nullable().default(null),
});
export type CampaignIngredientSet = z.infer<typeof CampaignIngredientSetSchema>;

/** Operator-facing plate readiness for an ingredient (upload or generate once). */
export function isPlateReady(item: {
  status: string;
  mediaType: string;
  path: string;
  kind?: string;
  copy?: {
    setup?: string;
    punchline?: string;
    endcard?: string;
    cta?: string;
  } | null;
}): boolean {
  if (item.kind === "copy") {
    const c = item.copy;
    return (
      item.status === "ready" &&
      Boolean(c && (c.setup?.trim() || c.punchline?.trim() || c.cta?.trim()))
    );
  }
  if (item.kind === "motion") {
    return item.status === "ready";
  }
  return (
    item.status === "ready" &&
    item.mediaType !== "none" &&
    Boolean(item.path?.trim())
  );
}

export type PlateStatusLabel =
  | "Uploaded"
  | "Generated"
  | "Needs plate"
  | "Generating"
  | "Failed";

export function plateStatusLabel(item: {
  status: string;
  mediaType: string;
  path: string;
  sourceMode?: string;
  kind?: string;
  copy?: {
    setup?: string;
    punchline?: string;
    endcard?: string;
    cta?: string;
  } | null;
}): PlateStatusLabel {
  if (item.status === "generating") return "Generating";
  if (item.status === "failed") return "Failed";
  if (item.kind === "copy" && isPlateReady(item)) return "Uploaded";
  if (isPlateReady(item)) {
    return item.sourceMode === "generated" ? "Generated" : "Uploaded";
  }
  return "Needs plate";
}

/**
 * Cell should get a Comfy variant (video).
 * True when build-sparse flagged needsGen, or the cell already carries
 * attire / background / prop / hands (hero pins count — not only openKnobs fans).
 */
export function cellNeedsVariantGen(cell: {
  needsGen?: boolean;
  attireId?: string | null;
  backgroundId?: string | null;
  propIds?: string[];
  handsId?: string | null;
}): boolean {
  if (cell.needsGen) return true;
  if (cell.attireId) return true;
  if (cell.backgroundId) return true;
  if (cell.propIds?.length) return true;
  if (cell.handsId?.trim()) return true;
  return false;
}

/** Any sizeAsset on the cell already has Comfy media. */
export function cellHasVariantMedia(cell: {
  sizeAssets?: { genPath?: string | null; status?: string }[];
}): boolean {
  return Boolean(
    cell.sizeAssets?.some(
      (a) => Boolean(a.genPath?.trim()) && a.status !== "failed",
    ),
  );
}

export const PolicyViolationSchema = z.object({
  code: z.enum([
    "inactive",
    "not_ready",
    "missing_media",
    "contract_attire",
    "contract_background",
    "contract_props",
    "contract_hands",
    "contract_face",
    "unknown_ingredient",
  ]),
  message: z.string(),
  ingredientId: z.string().optional(),
  kind: LibraryKindSchema.optional(),
  knob: OpenKnobSchema.optional(),
});
export type PolicyViolation = z.infer<typeof PolicyViolationSchema>;
