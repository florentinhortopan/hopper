import { z } from "zod";

/** Frame id in Guarantee Tranche 3–style Social Video matrices. */
export const CeltraFrameIdSchema = z.enum(["F1", "F2", "F3"]);
export type CeltraFrameId = z.infer<typeof CeltraFrameIdSchema>;

export const CeltraColumnBindingSourceSchema = z.enum([
  "empty",
  "static",
  "celtraOrder",
  "versionLabel",
  "funnel",
  "bgColor",
  "ctaColor",
  "frameFileName",
  "frameLink",
  "frameHeadline",
  "ecEyebrow",
  "ecHeadline",
  "ecDisclaimer",
  "assetName",
]);
export type CeltraColumnBindingSource = z.infer<
  typeof CeltraColumnBindingSourceSchema
>;

export const CeltraColumnBindingSchema = z.object({
  header: z.string(),
  source: CeltraColumnBindingSourceSchema,
  frameId: CeltraFrameIdSchema.optional(),
  staticValue: z.string().optional(),
});
export type CeltraColumnBinding = z.infer<typeof CeltraColumnBindingSchema>;

export const CeltraFrameDefSchema = z.object({
  id: CeltraFrameIdSchema,
  required: z.boolean().default(true),
  mediaKind: z.enum(["image", "video"]).default("image"),
  headlineMax: z.number().int().positive().default(35),
  /** Maps assembly recipe scene id / role → this Celtra frame */
  recipeSceneIds: z.array(z.string()).default([]),
});
export type CeltraFrameDef = z.infer<typeof CeltraFrameDefSchema>;

export const CeltraTemplateProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  sourceFile: z.string().optional(),
  ingestSheet: z.string(),
  headerRow: z.number().int().positive().default(2),
  groupHeaderRow: z.number().int().positive().nullable().default(1),
  /** Row-1 group labels aligned to header columns (sparse; null = blank). */
  groupHeaders: z.array(z.string().nullable()),
  headers: z.array(z.string()),
  columnBindings: z.array(CeltraColumnBindingSchema),
  frames: z.array(CeltraFrameDefSchema),
  sizesDefault: z.array(z.string()).default(["9:16", "4:5", "1:1"]),
  charLimits: z.record(z.number().int().positive()).default({}),
  assetNameTemplate: z.string().default(
    "{job}_MOB_{campaign}_Social_{funnel}_AllPlaforms_{version}_SIZE_LENGTH",
  ),
  celtraTemplateNote: z.string().default(""),
});
export type CeltraTemplateProfile = z.infer<typeof CeltraTemplateProfileSchema>;

/**
 * Golden profile reverse-engineered from
 * celtra-matrix/Guarantee Tranche 3 - Content Matrix.xlsx → sheet "Social Video".
 * Headers A–AL must stay byte-identical to sample row 2 (incl. trailing spaces / ImageLink spelling).
 */
export const GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1: CeltraTemplateProfile = {
  id: "guarantee_tranche3_social_video_v1",
  label: "Guarantee Tranche 3 — Social Video",
  sourceFile: "celtra-matrix/Guarantee Tranche 3 - Content Matrix.xlsx",
  ingestSheet: "Social Video",
  headerRow: 2,
  groupHeaderRow: 1,
  groupHeaders: [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "CATEGORY",
    null,
    "GENERAL ",
    null,
    null,
    null,
    "FRAME 1",
    null,
    null,
    null,
    "FRAME 2",
    null,
    null,
    null,
    "FRAME 3 (just for the longer versions)",
    null,
    null,
    null,
    "END CARD",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "Naming ",
  ],
  headers: [
    "Funnel",
    "Celtra order ",
    "Version",
    "Status",
    "Moment",
    "Size",
    "Key Message",
    "Language",
    "Version",
    "Approved",
    "Name",
    "Funnel",
    "BG Color",
    "Logo Filename",
    "Logo",
    "CTA Color",
    "F1 Image File Name",
    "F1 Image Thumbnail",
    "F1 ImageLink",
    "F1 Headline (max 35 char)",
    "F2 Image File Name",
    "F2 Image Thumbnail",
    "F2 Image Link",
    "F2 Headline (max 35 char)",
    "F3 Image File Name",
    "F3 Image Thumbnail",
    "F3 Image Link",
    "F3 Headline (max 35 char)",
    "Embrace File name",
    "Embrace",
    "EC Eyebrow (max 30 char)",
    "EC headline (max 77 char)",
    "EC Disclaimer",
    "EC Guarantee logo name",
    "EC Guarantee logo",
    "Globe Filename",
    "Globe",
    "Asset Name ",
  ],
  columnBindings: [
    { header: "Funnel", source: "funnel" },
    { header: "Celtra order ", source: "celtraOrder" },
    { header: "Version", source: "versionLabel" },
    { header: "Status", source: "empty" },
    { header: "Moment", source: "empty" },
    { header: "Size", source: "empty" },
    { header: "Key Message", source: "empty" },
    { header: "Language", source: "empty" },
    { header: "Version", source: "empty" },
    { header: "Approved", source: "static", staticValue: "Yes" },
    { header: "Name", source: "empty" },
    { header: "Funnel", source: "funnel" },
    { header: "BG Color", source: "bgColor" },
    { header: "Logo Filename", source: "empty" },
    { header: "Logo", source: "empty" },
    { header: "CTA Color", source: "ctaColor" },
    { header: "F1 Image File Name", source: "frameFileName", frameId: "F1" },
    { header: "F1 Image Thumbnail", source: "empty" },
    { header: "F1 ImageLink", source: "frameLink", frameId: "F1" },
    { header: "F1 Headline (max 35 char)", source: "frameHeadline", frameId: "F1" },
    { header: "F2 Image File Name", source: "frameFileName", frameId: "F2" },
    { header: "F2 Image Thumbnail", source: "empty" },
    { header: "F2 Image Link", source: "frameLink", frameId: "F2" },
    { header: "F2 Headline (max 35 char)", source: "frameHeadline", frameId: "F2" },
    { header: "F3 Image File Name", source: "frameFileName", frameId: "F3" },
    { header: "F3 Image Thumbnail", source: "empty" },
    { header: "F3 Image Link", source: "frameLink", frameId: "F3" },
    { header: "F3 Headline (max 35 char)", source: "frameHeadline", frameId: "F3" },
    { header: "Embrace File name", source: "empty" },
    { header: "Embrace", source: "empty" },
    { header: "EC Eyebrow (max 30 char)", source: "ecEyebrow" },
    { header: "EC headline (max 77 char)", source: "ecHeadline" },
    { header: "EC Disclaimer", source: "ecDisclaimer" },
    { header: "EC Guarantee logo name", source: "empty" },
    { header: "EC Guarantee logo", source: "empty" },
    { header: "Globe Filename", source: "empty" },
    { header: "Globe", source: "empty" },
    { header: "Asset Name ", source: "assetName" },
  ],
  frames: [
    {
      id: "F1",
      required: true,
      mediaKind: "image",
      headlineMax: 35,
      recipeSceneIds: ["setup"],
    },
    {
      id: "F2",
      required: true,
      mediaKind: "image",
      headlineMax: 35,
      recipeSceneIds: ["punchline"],
    },
    {
      id: "F3",
      required: false,
      mediaKind: "image",
      headlineMax: 35,
      recipeSceneIds: ["endcard"],
    },
  ],
  sizesDefault: ["9:16", "4:5", "1:1"],
  charLimits: {
    "F1 Headline (max 35 char)": 35,
    "F2 Headline (max 35 char)": 35,
    "F3 Headline (max 35 char)": 35,
    "EC Eyebrow (max 30 char)": 30,
    "EC headline (max 77 char)": 77,
  },
  assetNameTemplate:
    "{job}_MOB_{campaign}_Social_{funnel}_AllPlaforms_{version}_SIZE_LENGTH",
  celtraTemplateNote:
    "AT&T Guarantee Tranche 3 Social Video Celtra template — image frames sequenced in Celtra (not MOV columns).",
};

export const CELTRA_TEMPLATE_PROFILES: Record<string, CeltraTemplateProfile> = {
  [GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1.id]: GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1,
};

export const DEFAULT_CELTRA_TEMPLATE_PROFILE_ID =
  GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1.id;

export function getCeltraTemplateProfile(
  id: string | null | undefined,
): CeltraTemplateProfile {
  if (id && CELTRA_TEMPLATE_PROFILES[id]) {
    return CELTRA_TEMPLATE_PROFILES[id]!;
  }
  return GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1;
}

/** Map recipe scene id → Celtra frame (setup→F1, punchline→F2, endcard→F3). */
export function sceneTagToCeltraFrame(
  profile: CeltraTemplateProfile,
  sceneTag: string | null | undefined,
): CeltraFrameId | null {
  const tag = sceneTag?.trim();
  if (!tag) return null;
  for (const frame of profile.frames) {
    if (frame.recipeSceneIds.includes(tag) || frame.id === tag) {
      return frame.id;
    }
  }
  return null;
}

export function fileNameStem(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  return base.replace(/\.[^.]+$/, "");
}

export function hexWithoutHash(color: string | null | undefined): string {
  if (!color?.trim()) return "";
  return color.trim().replace(/^#/, "").toUpperCase();
}

export function sanitizeCeltraToken(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export type CeltraRowInput = {
  celtraOrder: number;
  versionLabel: string;
  funnel: string;
  bgColor: string;
  ctaColor: string;
  /** Basename per frame (with extension), if present */
  frameFiles: Partial<Record<CeltraFrameId, string>>;
  frameHeadlines: Partial<Record<CeltraFrameId, string>>;
  ecEyebrow: string;
  ecHeadline: string;
  ecDisclaimer: string;
  assetName: string;
};

/** Build one Celtra queue-line as ordered cell values matching profile.headers. */
export function buildCeltraWideRow(
  profile: CeltraTemplateProfile,
  input: CeltraRowInput,
): string[] {
  return profile.columnBindings.map((b) => {
    switch (b.source) {
      case "empty":
        return "";
      case "static":
        return b.staticValue ?? "";
      case "celtraOrder":
        return String(input.celtraOrder);
      case "versionLabel":
        return input.versionLabel;
      case "funnel":
        return input.funnel;
      case "bgColor":
        return hexWithoutHash(input.bgColor);
      case "ctaColor":
        return hexWithoutHash(input.ctaColor);
      case "frameFileName": {
        const id = b.frameId;
        return id ? input.frameFiles[id] ?? "" : "";
      }
      case "frameLink": {
        const id = b.frameId;
        const file = id ? input.frameFiles[id] : undefined;
        return file ? fileNameStem(file) : "";
      }
      case "frameHeadline": {
        const id = b.frameId;
        return id ? input.frameHeadlines[id] ?? "" : "";
      }
      case "ecEyebrow":
        return input.ecEyebrow;
      case "ecHeadline":
        return input.ecHeadline;
      case "ecDisclaimer":
        return input.ecDisclaimer;
      case "assetName":
        return input.assetName;
      default:
        return "";
    }
  });
}

export type CeltraRowValidation = {
  errors: string[];
  warnings: string[];
};

export function validateCeltraWideRow(
  profile: CeltraTemplateProfile,
  values: string[],
  opts?: { requireFrames?: boolean },
): CeltraRowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireFrames = opts?.requireFrames !== false;

  if (values.length !== profile.headers.length) {
    errors.push(
      `Row has ${values.length} cells; profile expects ${profile.headers.length}`,
    );
    return { errors, warnings };
  }

  for (const [header, max] of Object.entries(profile.charLimits)) {
    const idx = profile.headers.indexOf(header);
    if (idx < 0) continue;
    const v = values[idx] ?? "";
    if (v.length > max) {
      errors.push(`"${header}" is ${v.length} chars (max ${max})`);
    }
  }

  if (requireFrames) {
    for (const frame of profile.frames) {
      if (!frame.required) continue;
      const fileHeader = profile.headers.find((h) =>
        h.startsWith(`${frame.id} Image File Name`),
      );
      if (!fileHeader) continue;
      const idx = profile.headers.indexOf(fileHeader);
      if (!(values[idx] ?? "").trim()) {
        warnings.push(`Missing required frame media: ${fileHeader}`);
      }
    }
    const ecIdx = profile.headers.indexOf("EC headline (max 77 char)");
    if (ecIdx >= 0 && !(values[ecIdx] ?? "").trim()) {
      warnings.push("Missing EC headline");
    }
  }

  return { errors, warnings };
}

export function formatCeltraAssetName(
  profile: CeltraTemplateProfile,
  parts: {
    job?: string;
    campaign: string;
    funnel: string;
    version: string;
  },
): string {
  return profile.assetNameTemplate
    .replace("{job}", sanitizeCeltraToken(parts.job || "7730100"))
    .replace("{campaign}", sanitizeCeltraToken(parts.campaign))
    .replace("{funnel}", sanitizeCeltraToken(parts.funnel || "LookingBuying"))
    .replace("{version}", sanitizeCeltraToken(parts.version));
}

/** Assert golden profile still matches expected GT3 header count / key columns. */
export function assertGuaranteeTranche3ProfileIntegrity(): void {
  const p = GUARANTEE_TRANCHE3_SOCIAL_VIDEO_V1;
  if (p.headers.length !== 38) {
    throw new Error(`Expected 38 Social Video headers, got ${p.headers.length}`);
  }
  if (p.headers.length !== p.columnBindings.length) {
    throw new Error("headers / columnBindings length mismatch");
  }
  if (p.groupHeaders.length !== p.headers.length) {
    throw new Error("groupHeaders / headers length mismatch");
  }
  if (p.headers[16] !== "F1 Image File Name") {
    throw new Error(`Unexpected F1 file header: ${p.headers[16]}`);
  }
  if (p.headers[18] !== "F1 ImageLink") {
    throw new Error(`Unexpected F1 link header spelling: ${p.headers[18]}`);
  }
  if (p.headers[22] !== "F2 Image Link") {
    throw new Error(`Unexpected F2 link header spelling: ${p.headers[22]}`);
  }
  if (p.headers[37] !== "Asset Name ") {
    throw new Error(`Unexpected Asset Name header: ${JSON.stringify(p.headers[37])}`);
  }
}
