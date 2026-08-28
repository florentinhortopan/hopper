import { z } from "zod";
import {
  AssemblyRecipeSchema,
  ComfyTemplateStepSchema,
  DEFAULT_ASSEMBLY_SCENES,
  normalizeAssemblyRecipe,
  normalizeComfyTemplate,
  type AssemblyRecipe,
  type Brief,
  type ComfyTemplate,
} from "./schemas.js";
import {
  META_RECOMMENDED_SIZE_IDS,
  resolveOutputSizes,
  type OutputSize,
} from "./sizes.js";

export const MAGIC_PRESET_ID = "magic_att_v1";

export const CampaignModeSchema = z.enum(["standard", "magic"]);
export type CampaignMode = z.infer<typeof CampaignModeSchema>;

/** ATTATTA-native workflow package (not raw Comfy api.json). */
export const MagicWorkflowPackageSchema = z.object({
  version: z.number().int().positive().default(1),
  baseWorkflowId: z.string().nullable().optional(),
  campaignGuidelines: z.string().optional(),
  steps: z.array(ComfyTemplateStepSchema).optional(),
  assemblyRecipe: AssemblyRecipeSchema.optional(),
  celtraTemplateProfileId: z.string().optional(),
  outputSizeIds: z.array(z.string()).optional(),
  brief: z
    .object({
      prompt: z.string().optional(),
      audience: z.string().optional(),
      offer: z.string().optional(),
      cta: z.string().optional(),
      mustSay: z.array(z.string()).optional(),
      mustNot: z.array(z.string()).optional(),
    })
    .optional(),
});
export type MagicWorkflowPackage = z.infer<typeof MagicWorkflowPackageSchema>;

export const MagicChecklistSourceSchema = z.enum([
  "imported",
  "url",
  "ai",
  "preset",
  "missing",
]);
export type MagicChecklistSource = z.infer<typeof MagicChecklistSourceSchema>;

export const MagicChecklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  source: MagicChecklistSourceSchema,
  detail: z.string().default(""),
});
export type MagicChecklistItem = z.infer<typeof MagicChecklistItemSchema>;

export const MAGIC_COMFY_TEMPLATE: ComfyTemplate = {
  baseWorkflowId: "talent_variant_video_v1",
  campaignGuidelines:
    "Paid social vertical ad for AT&T-style guarantee campaigns. Photoreal talent lock. Hands/product beat is the hero generative plate. No on-screen text in the plate. Clean composition, brand-safe.",
  steps: [
    {
      id: "hands_prompt",
      label: "Hands / punchline plate",
      patchKey: "prompt",
      prompt:
        "Close-up product-in-hands gesture for the punchline beat, match talent lighting, natural skin, no face morph",
      ingredientId: null,
    },
    {
      id: "duration",
      label: "Clip duration",
      patchKey: "duration",
      prompt: "4",
      ingredientId: null,
    },
  ],
};

export const MAGIC_ASSEMBLY_RECIPE: AssemblyRecipe = {
  scenes: [...DEFAULT_ASSEMBLY_SCENES],
  targetDurationSeconds: 10,
  copySuggestedSeconds: null,
};

export function magicOutputSizes(): OutputSize[] {
  return resolveOutputSizes([...META_RECOMMENDED_SIZE_IDS]);
}

/** Filenames that count as workflow template JSON inside an import package. */
export function isMagicWorkflowFilename(name: string): boolean {
  const base = name.split(/[/\\]/).pop()?.toLowerCase() || "";
  if (
    base === "workflow.json" ||
    base === "comfy-template.json" ||
    base === "attatta.workflow.json" ||
    base === "magic.workflow.json"
  ) {
    return true;
  }
  return base.endsWith(".workflow.json");
}

export function isMagicManifestFilename(name: string): boolean {
  const base = name.split(/[/\\]/).pop()?.toLowerCase() || "";
  return (
    base === "manifest.json" ||
    base === "attatta.manifest.json" ||
    base === "brief.json"
  );
}

export function isMagicWorkflowUrlFilename(name: string): boolean {
  const base = name.split(/[/\\]/).pop()?.toLowerCase() || "";
  return base === "workflow.url";
}

export function comfyTemplateFromMagicPackage(
  pkg: MagicWorkflowPackage,
): ComfyTemplate {
  return normalizeComfyTemplate({
    baseWorkflowId: pkg.baseWorkflowId ?? MAGIC_COMFY_TEMPLATE.baseWorkflowId,
    campaignGuidelines:
      pkg.campaignGuidelines ?? MAGIC_COMFY_TEMPLATE.campaignGuidelines,
    steps: pkg.steps?.length ? pkg.steps : MAGIC_COMFY_TEMPLATE.steps,
  });
}

export function assemblyRecipeFromMagicPackage(
  pkg: MagicWorkflowPackage,
): AssemblyRecipe {
  if (pkg.assemblyRecipe) return normalizeAssemblyRecipe(pkg.assemblyRecipe);
  return { ...MAGIC_ASSEMBLY_RECIPE, scenes: [...MAGIC_ASSEMBLY_RECIPE.scenes] };
}

export function heuristicCopyFromBrief(brief: Brief): Array<{
  setup: string;
  punchline: string;
  endcard: string;
  cta: string;
}> {
  const prompt = brief.prompt?.trim() || "New offer";
  const offer = brief.offer?.trim() || prompt.slice(0, 80);
  const cta = brief.cta?.trim() || "Learn more";
  const audience = brief.audience?.trim();
  return [
    {
      setup: audience
        ? `${audience.split(/[,.]/)[0]?.trim() || "You"} — ${prompt.slice(0, 60)}`
        : prompt.slice(0, 80),
      punchline: offer.slice(0, 80),
      endcard: offer.slice(0, 77),
      cta,
    },
    {
      setup: prompt.slice(0, 80),
      punchline: `${offer}`.slice(0, 80),
      endcard: brief.mustSay?.[0]?.slice(0, 77) || offer.slice(0, 77),
      cta,
    },
  ];
}

export function magicCanContinue(checklist: MagicChecklistItem[]): {
  ok: boolean;
  reasons: string[];
} {
  const byId = new Map(checklist.map((c) => [c.id, c]));
  const reasons: string[] = [];
  const brief = byId.get("brief");
  const workflow = byId.get("workflow");
  const talent = byId.get("talent");
  if (!brief?.ok) reasons.push("Brief required");
  if (!workflow?.ok) reasons.push("Workflow template unresolved");
  if (!talent?.ok) reasons.push("Talent take required (or AI-only with LLM)");
  return { ok: reasons.length === 0, reasons };
}
