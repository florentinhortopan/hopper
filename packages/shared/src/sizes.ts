import { z } from "zod";

export const OutputSizeSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Display / delivery aspect, e.g. "9:16" */
  aspect: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Optional lower-res gen size for diffusion (defaults derived) */
  genWidth: z.number().int().positive().optional(),
  genHeight: z.number().int().positive().optional(),
  /** Meta placement summary for operators */
  placements: z.string().optional(),
  /** Core Meta production set vs niche / optional */
  tier: z.enum(["core", "optional"]).optional(),
  /** Highlighted in settings as Meta-recommended */
  recommended: z.boolean().optional(),
});
export type OutputSize = z.infer<typeof OutputSizeSchema>;

/**
 * Meta paid-social delivery catalog (1080 short-side masters).
 *
 * Performance stack (2025–2026 operator consensus + Meta placement specs):
 * - 9:16 — Reels / Stories; full-screen; often lowest CPM / reach efficiency
 * - 4:5 — FB/IG Feed; max mobile feed real estate; typically beats 1:1 / 16:9 on CTR
 * - 1:1 — carousel, Marketplace, Search, right column; Advantage+ fallback
 * - 16:9 — in-stream / landscape only; keep optional for UGC-style campaigns
 */
export const OUTPUT_SIZE_CATALOG: OutputSize[] = [
  {
    id: "v_9x16_1080",
    label: "Reels / Stories 9:16",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    genWidth: 576,
    genHeight: 1024,
    placements: "Instagram & Facebook Reels, Stories",
    tier: "core",
    recommended: true,
  },
  {
    id: "v_4x5_1080",
    label: "Feed 4:5",
    aspect: "4:5",
    width: 1080,
    height: 1350,
    genWidth: 768,
    genHeight: 960,
    placements: "Facebook & Instagram Feed, Explore",
    tier: "core",
    recommended: true,
  },
  {
    id: "sq_1x1_1080",
    label: "Square 1:1",
    aspect: "1:1",
    width: 1080,
    height: 1080,
    genWidth: 768,
    genHeight: 768,
    placements: "Carousel, Marketplace, Search, right column",
    tier: "core",
    recommended: true,
  },
  {
    id: "h_16x9_1080",
    label: "In-stream 16:9",
    aspect: "16:9",
    width: 1920,
    height: 1080,
    genWidth: 1024,
    genHeight: 576,
    placements: "Facebook in-stream / landscape only",
    tier: "optional",
    recommended: false,
  },
];

/** Default new-campaign set: covers ~90%+ of Meta inventory (Reels/Stories + Feed). */
export const DEFAULT_OUTPUT_SIZE_IDS = ["v_9x16_1080", "v_4x5_1080"] as const;

/**
 * Advantage+ / multi-placement pack: native assets for Feed + full-screen + square
 * surfaces so Meta does not auto-crop a single master.
 */
export const META_RECOMMENDED_SIZE_IDS = [
  "v_9x16_1080",
  "v_4x5_1080",
  "sq_1x1_1080",
] as const;

export function resolveOutputSizes(ids: string[]): OutputSize[] {
  const byId = new Map(OUTPUT_SIZE_CATALOG.map((s) => [s.id, s]));
  const resolved = ids.map((id) => byId.get(id)).filter(Boolean) as OutputSize[];
  return resolved.length ? resolved : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);
}

export function genDimsForSize(size: OutputSize): { width: number; height: number } {
  return {
    width: size.genWidth ?? size.width,
    height: size.genHeight ?? size.height,
  };
}

export const CellSizeAssetSchema = z.object({
  sizeId: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  aspect: z.string(),
  previewPath: z.string().nullable().default(null),
  outputPath: z.string().nullable().default(null),
  genPath: z.string().nullable().default(null),
  /** Hash of prompt + ingredients + size — used for cross-cell plate reuse */
  promptHash: z.string().nullable().default(null),
  status: z
    .enum(["pending", "generating", "preview_ok", "ready", "failed"])
    .default("pending"),
  error: z.string().nullable().default(null),
});
export type CellSizeAsset = z.infer<typeof CellSizeAssetSchema>;
