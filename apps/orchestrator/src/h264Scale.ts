/**
 * H264 (and H265) require even pixel width and height.
 * Remotion multiplies composition size by `scale` and throws when the
 * result is an odd integer — e.g. 1080×1350 @ 0.5 → 540×675.
 */

/** Nearest even integer ≥ 2. */
export function roundToEven(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Map a Remotion render (composition size × scale) to H264-safe values.
 *
 * For scale ≠ 1 we bake the scale into even composition width/height and
 * render at scale 1, so every SIZE_PRESET preview works (4:5, 9:16, …).
 */
export function h264SafeScaledRender(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number; scale: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (s === 1) {
    return {
      width: roundToEven(width),
      height: roundToEven(height),
      scale: 1,
    };
  }
  return {
    width: roundToEven(width * s),
    height: roundToEven(height * s),
    scale: 1,
  };
}
