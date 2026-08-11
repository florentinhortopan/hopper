import type { LibraryKind } from "./ingredientKinds.js";

/** Heuristic wall-clock for plate Comfy jobs (Cloud has no reliable ETA). */
export function estimatePlateGenSeconds(
  kind: LibraryKind | string,
  outputMode: "image" | "video",
): number {
  if (outputMode === "image") {
    if (kind === "background") return 45;
    if (kind === "attire" || kind === "prop") return 75;
    return 60;
  }
  // Video: BG / attire / hands / prop use MiniMax R2V when talent MP4 exists
  if (kind === "background") return 180;
  if (kind === "attire" || kind === "hands" || kind === "prop") return 210;
  return 150;
}

export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** Remaining estimate from startedAt + heuristic total. */
export function remainingEstimateSeconds(
  startedAtMs: number,
  etaTotalSeconds: number,
  nowMs = Date.now(),
): number {
  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  return Math.max(0, etaTotalSeconds - elapsed);
}

/**
 * Heuristic for campaign queue jobs (preview / render / plates).
 * Remotion reports real frame progress; Comfy Cloud status has no %.
 */
export function estimateQueueJobSeconds(opts: {
  stage: string;
  /** When false, job includes a Comfy variant pass before Remotion. */
  includesComfy?: boolean;
}): number {
  const remotion =
    opts.stage === "render" ? 55 : opts.stage === "preview" ? 35 : 40;
  if (opts.stage === "plates" || opts.stage === "ingredient_gen") {
    return 180;
  }
  if (opts.stage === "package") return 20;
  return opts.includesComfy ? remotion + 160 : remotion;
}
