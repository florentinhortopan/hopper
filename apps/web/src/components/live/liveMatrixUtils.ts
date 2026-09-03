"use client";

import type { Job, MatrixCell, OutputSize, ReviewEntry } from "@attatta/shared";

export type SizeSlotTone = "ready" | "running" | "failed" | "missing";

export type ComboAxisKey =
  | "handsId"
  | "attireId"
  | "backgroundId"
  | "prop"
  | "sceneTag";

export type ComboAxis = {
  key: ComboAxisKey;
  label: string;
  values: string[];
};

export function shortId(id: string | null | undefined, n = 10): string {
  const s = (id || "").trim();
  if (!s) return "—";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

export function cellComboLabel(cell: MatrixCell): string {
  const bits = [
    cell.handsId ? `hands:${shortId(cell.handsId, 8)}` : null,
    cell.attireId
      ? `attire:${shortId(cell.attireId, 8)}`
      : cell.backgroundId || cell.propIds?.[0]
        ? "attire:original"
        : null,
    cell.backgroundId ? `bg:${shortId(cell.backgroundId, 8)}` : null,
    cell.propIds?.[0] ? `prop:${shortId(cell.propIds[0], 8)}` : null,
    cell.sceneTag ? `scene:${cell.sceneTag}` : null,
  ].filter(Boolean);
  return bits.join(" · ") || cell.cellId;
}

export function axisValue(cell: MatrixCell, key: ComboAxisKey): string {
  if (key === "prop") return cell.propIds?.[0]?.trim() || "—";
  if (key === "sceneTag") return cell.sceneTag?.trim() || "—";
  if (key === "handsId") return cell.handsId?.trim() || "—";
  if (key === "attireId") return cell.attireId?.trim() || "—";
  return cell.backgroundId?.trim() || "—";
}

/** Axes that actually fan across the live matrix (for XY views). */
export function detectComboAxes(cells: MatrixCell[]): ComboAxis[] {
  const defs: Array<{ key: ComboAxisKey; label: string }> = [
    { key: "handsId", label: "Hands" },
    { key: "attireId", label: "Attire" },
    { key: "backgroundId", label: "Background" },
    { key: "prop", label: "Prop" },
    { key: "sceneTag", label: "Scene" },
  ];
  const out: ComboAxis[] = [];
  for (const d of defs) {
    const values = [
      ...new Set(cells.map((c) => axisValue(c, d.key)).filter((v) => v !== "—")),
    ].sort();
    if (values.length >= 2) {
      out.push({ key: d.key, label: d.label, values });
    }
  }
  return out;
}

export function findCellAt(
  cells: MatrixCell[],
  xKey: ComboAxisKey,
  xVal: string,
  yKey: ComboAxisKey,
  yVal: string,
): MatrixCell | undefined {
  return cells.find(
    (c) => axisValue(c, xKey) === xVal && axisValue(c, yKey) === yVal,
  );
}

export function sizeAssetFor(cell: MatrixCell, sizeId: string) {
  return cell.sizeAssets?.find((a) => a.sizeId === sizeId);
}

export function sizeSlotTone(
  cell: MatrixCell,
  size: OutputSize,
  jobs: Job[],
): SizeSlotTone {
  const asset = sizeAssetFor(cell, size.id);
  const live = jobs.find(
    (j) =>
      j.cellId === cell.cellId &&
      j.sizeId === size.id &&
      (j.status === "queued" || j.status === "running"),
  );
  if (live) return "running";
  if (asset?.status === "failed") return "failed";
  const path =
    asset?.genPath?.trim() ||
    asset?.outputPath?.trim() ||
    asset?.previewPath?.trim() ||
    "";
  if (path) {
    // Shared path across different aspects = stale inherit, not a real size plate
    const sharedWrong = (cell.sizeAssets ?? []).some(
      (a) =>
        a.sizeId !== size.id &&
        a.aspect !== size.aspect &&
        (a.genPath?.trim() || a.outputPath?.trim() || "") === path,
    );
    if (sharedWrong) return "missing";
    return "ready";
  }
  const cellJob = jobs.find(
    (j) =>
      j.cellId === cell.cellId &&
      !j.sizeId &&
      (j.status === "queued" || j.status === "running"),
  );
  if (cellJob) return "running";
  return "missing";
}

export function toneClass(tone: SizeSlotTone): string {
  if (tone === "ready") return "bg-emerald-500";
  if (tone === "running") return "bg-amber-400 animate-pulse";
  if (tone === "failed") return "bg-red-500";
  return "bg-ink-200";
}

export function toneLabel(tone: SizeSlotTone): string {
  if (tone === "ready") return "ready";
  if (tone === "running") return "generating";
  if (tone === "failed") return "failed";
  return "missing";
}

export function missingSizeSlotCount(
  cells: MatrixCell[],
  sizes: OutputSize[],
): number {
  let n = 0;
  for (const cell of cells) {
    for (const s of sizes) {
      const asset = sizeAssetFor(cell, s.id);
      if (
        !asset?.genPath?.trim() &&
        !asset?.outputPath?.trim() &&
        !asset?.previewPath?.trim()
      ) {
        n += 1;
      }
    }
  }
  return n;
}

export function coverageSummary(
  cells: MatrixCell[],
  sizes: OutputSize[],
  jobs: Job[],
): { ready: number; total: number; bySize: Record<string, { ready: number; total: number }> } {
  let ready = 0;
  let total = 0;
  const bySize: Record<string, { ready: number; total: number }> = {};
  for (const s of sizes) {
    bySize[s.id] = { ready: 0, total: 0 };
  }
  for (const cell of cells) {
    for (const s of sizes) {
      total += 1;
      bySize[s.id]!.total += 1;
      const t = sizeSlotTone(cell, s, jobs);
      if (t === "ready") {
        ready += 1;
        bySize[s.id]!.ready += 1;
      }
    }
  }
  return { ready, total, bySize };
}

export function reviewOf(
  reviews: ReviewEntry[],
  cellId: string,
  sizeId?: string | null,
): ReviewEntry["decision"] {
  // Prefer shared helper when size-scoped; cell-level ignores size-only entries.
  if (sizeId) {
    const sized = reviews.find(
      (r) => r.cellId === cellId && (r.sizeId || null) === sizeId,
    );
    if (sized) return sized.decision;
  }
  return (
    reviews.find(
      (r) => r.cellId === cellId && (r.sizeId == null || r.sizeId === ""),
    )?.decision || "pending"
  );
}
