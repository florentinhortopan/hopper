import { z } from "zod";

/** Reusable DAM kinds — attire/BG first-class; prop covers hats, ribbons, products, etc. */
export const LibraryKindSchema = z.enum([
  "talent",
  "hands",
  "motion",
  "attire",
  "background",
  "prop",
  "theme",
  /** Copy-line alternatives (setup / punchline / endcard / CTA) — no media */
  "copy",
]);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const MediaTypeSchema = z.enum(["video", "image", "json", "none"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const OpenKnobSchema = z.enum([
  "hands",
  "copy",
  "attire",
  "background",
  "motion",
  "prop",
]);
export type OpenKnob = z.infer<typeof OpenKnobSchema>;

export type IngredientKindDef = {
  id: LibraryKind;
  label: string;
  description: string;
  /** Accepted upload modes; empty = metadata-only create */
  mediaModes: MediaType[];
  acceptUpload: boolean;
  /** How the kind shows on the ingredient rail */
  rail: {
    pinHero: boolean;
    allowlist: boolean;
    openKnob: OpenKnob | null;
  };
  /** Comfy / gen mapping — Remotion assemble stays talent+hands */
  comfy: {
    knob: "hands" | "attire" | "background" | "prop" | null;
    workflowId: string | null;
    /** Semantic patch key in workflow maps */
    patchKey: string | null;
  };
  /** Role when building model prompts */
  promptRole: "subject" | "product" | "wardrobe" | "setting" | "prop" | "motion" | "theme";
  assembleSlot: "talent" | "hands" | "none";
  examples: string[];
};

export const INGREDIENT_KINDS: IngredientKindDef[] = [
  {
    id: "talent",
    label: "Talent",
    description: "Locked spokesperson takes (face / voice / performance).",
    mediaModes: ["video"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: false, openKnob: null },
    comfy: { knob: null, workflowId: null, patchKey: null },
    promptRole: "subject",
    assembleSlot: "talent",
    examples: ["Ted front offer"],
  },
  {
    id: "hands",
    label: "Hands",
    description: "Primary generative product / gesture plates.",
    mediaModes: ["video", "image"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: true, openKnob: "hands" },
    comfy: { knob: "hands", workflowId: "hands_product_v1", patchKey: "productRef" },
    promptRole: "product",
    assembleSlot: "hands",
    examples: ["phone swipe", "product hold"],
  },
  {
    id: "motion",
    label: "Motion",
    description: "Gesture intensity / motion tokens (metadata).",
    mediaModes: ["json", "none"],
    acceptUpload: false,
    rail: { pinHero: true, allowlist: false, openKnob: "motion" },
    comfy: { knob: "hands", workflowId: "hands_product_v1", patchKey: "motionToken" },
    promptRole: "motion",
    assembleSlot: "none",
    examples: ["gesture_medium", "gesture_punchy"],
  },
  {
    id: "attire",
    label: "Attire",
    description: "Wardrobe plates or refs; face-protect on gen.",
    mediaModes: ["image", "video"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: true, openKnob: "attire" },
    comfy: { knob: "attire", workflowId: "talent_attire_v1", patchKey: "wardrobeRef" },
    promptRole: "wardrobe",
    assembleSlot: "none",
    examples: ["hoodie", "blazer"],
  },
  {
    id: "background",
    label: "Background",
    description: "Scene / location refs; face region preserved on gen.",
    mediaModes: ["image", "video"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: true, openKnob: "background" },
    comfy: { knob: "background", workflowId: "talent_bg_v1", patchKey: "backgroundHint" },
    promptRole: "setting",
    assembleSlot: "none",
    examples: ["soft daylight desk", "kitchen counter"],
  },
  {
    id: "prop",
    label: "Prop",
    description: "Reusable props & accessories — hats, ribbons, boxes, SKUs.",
    mediaModes: ["image", "video"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: true, openKnob: "prop" },
    comfy: { knob: "prop", workflowId: "hands_product_v1", patchKey: "productRef" },
    promptRole: "prop",
    assembleSlot: "none",
    examples: ["hat", "ribbon", "pizza box", "phone SKU"],
  },
  {
    id: "theme",
    label: "Theme",
    description: "Opening theme / plate mood refs (optional).",
    mediaModes: ["image", "video"],
    acceptUpload: true,
    rail: { pinHero: true, allowlist: false, openKnob: null },
    comfy: { knob: null, workflowId: "theme_plate_v1", patchKey: "prompt" },
    promptRole: "theme",
    assembleSlot: "none",
    examples: ["spring promo plate"],
  },
  {
    id: "copy",
    label: "Copy",
    description:
      "Messaging alternatives (setup → punchline → end card + CTA). Applied at assemble — not Comfy.",
    mediaModes: ["json", "none"],
    acceptUpload: false,
    // Not a matrix / Comfy fan — Remotion appends active copy plates per variant.
    rail: { pinHero: false, allowlist: true, openKnob: null },
    comfy: { knob: null, workflowId: null, patchKey: null },
    promptRole: "theme",
    assembleSlot: "none",
    examples: ["benefit-led CTA", "urgency CTA"],
  },
];

export function getIngredientKind(id: LibraryKind): IngredientKindDef {
  const found = INGREDIENT_KINDS.find((k) => k.id === id);
  if (!found) throw new Error(`Unknown ingredient kind: ${id}`);
  return found;
}

export const LIBRARY_KINDS = INGREDIENT_KINDS.map((k) => k.id);
