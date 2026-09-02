import type { OutputSize } from "@attatta/shared";
import { genDimsForSize } from "@attatta/shared";

/**
 * Aspect-aware composition guidance for Comfy prompts when generating a native
 * plate for a delivery size. Used by missing-size regen and primary matrix gen —
 * not a crop of another aspect.
 */
export function aspectFramingLines(opts: {
  size: OutputSize;
  hasTalent?: boolean;
  hasBackground?: boolean;
  hasHands?: boolean;
}): string[] {
  const { size } = opts;
  const gen = genDimsForSize(size);
  const hasTalent = Boolean(opts.hasTalent);
  const hasBackground = Boolean(opts.hasBackground);
  const hasHands = Boolean(opts.hasHands);
  const lines: string[] = [
    `Compose natively for ${size.aspect} at ${gen.width}×${gen.height} (delivery ${size.width}×${size.height}) — full-bleed frame, no letterbox, no pillarbox, no black bars`,
    "Recompose for this aspect: reposition talent and background so everything important fits — do not center-crop or stretch a different aspect ratio",
  ];

  switch (size.aspect) {
    case "9:16":
      lines.push(
        "Vertical 9:16: tall full-bleed; keep crown-to-chin headroom; subject on vertical center axis; lower third clear for end-card/UI overlays",
      );
      if (hasTalent) {
        lines.push(
          "Talent: full face and shoulders in frame; eyes near the upper third; do not crop forehead, chin, or elbows; standing/waist-up preferred over tight head-crop",
        );
      }
      if (hasBackground) {
        lines.push(
          "Background: extend the environment full height behind talent — readable sky/architecture top and ground/context bottom; not a horizontal plate chopped into a strip",
        );
      }
      break;
    case "4:5":
      lines.push(
        "Near-square 4:5 Feed: slightly taller than wide; balanced vertical room; keep primary subject in the central safe zone (avoid extreme top/bottom edge)",
      );
      if (hasTalent) {
        lines.push(
          "Talent: head and torso fully visible with modest headroom; avoid cutting at hairline or mid-forehead",
        );
      }
      if (hasBackground) {
        lines.push(
          "Background: fill the 4:5 canvas evenly; keep horizon or key scenery mid-frame so Feed crop does not lose context",
        );
      }
      break;
    case "1:1":
      lines.push(
        "Square 1:1: optical center of interest; equal safe margins on all sides; no vertical letterbox feel",
      );
      if (hasTalent) {
        lines.push(
          "Talent: face and upper body centered; keep hair and chin inside the square with breathing room",
        );
      }
      if (hasBackground) {
        lines.push(
          "Background: choose a square-friendly crop of the scene — strongest focal area in the middle, not a thin horizontal band",
        );
      }
      break;
    case "16:9":
      lines.push(
        "Landscape 16:9: wide cinematic frame; subject left- or center-weighted; protect left/right edges from important detail loss",
      );
      if (hasTalent) {
        lines.push(
          "Talent: full torso + head in frame; leave side space for environment; avoid extreme close-up that clips crown or chin",
        );
      }
      if (hasBackground) {
        lines.push(
          "Background: panoramic fill left-to-right; keep depth and context on both sides of talent",
        );
      }
      break;
    default:
      lines.push(
        `${size.aspect} paid-social frame: keep all hero elements inside the safe inner 80% of the canvas`,
      );
  }

  if (hasHands) {
    lines.push(
      "Hands/product: keep product fully inside frame with margin; place near optical center for this aspect so UI overlays do not cover it",
    );
  }

  return lines;
}

export function aspectFramingNegatives(aspect: string): string[] {
  const base = [
    "letterboxing",
    "pillarboxing",
    "black bars",
    "cropped head",
    "cut off forehead",
    "cut off chin",
    "cut off top of head",
    "tight zoom crop",
    "extreme close-up crop",
    "stretched aspect ratio",
    "warped proportions",
    "wrong aspect ratio",
    "horizontal image in vertical frame",
    "mismatched framing",
  ];
  if (aspect === "9:16" || aspect === "4:5") {
    return [...base, "wide landscape crop", "side-to-side pan crop only"];
  }
  if (aspect === "16:9") {
    return [...base, "tall portrait crop only", "vertical tunnel framing"];
  }
  return base;
}
