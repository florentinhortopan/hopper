import type { Campaign, MatrixCell, RetiredMatrixCell } from "./schemas.js";

export const ARCHIVE_REF_PREFIX = "archive:";

export type MatrixCellPool = "live" | "retired";

export type ResolvedMatrixCell = {
  cell: MatrixCell | RetiredMatrixCell;
  pool: MatrixCellPool;
  index: number;
  /** Opaque ref for APIs / deep links — live cellId or archive:<archiveId> */
  ref: string;
};

export function makeArchiveRef(archiveId: string): string {
  return `${ARCHIVE_REF_PREFIX}${archiveId}`;
}

export function isArchiveRef(ref: string): boolean {
  return ref.startsWith(ARCHIVE_REF_PREFIX);
}

export function parseArchiveId(ref: string): string | null {
  if (!isArchiveRef(ref)) return null;
  const id = ref.slice(ARCHIVE_REF_PREFIX.length).trim();
  return id || null;
}

/** Deterministic archive id for legacy retired rows missing archiveId. */
export function stableLegacyArchiveId(cell: {
  cellId: string;
  retiredAt: string;
}): string {
  const s = `${cell.cellId}|${cell.retiredAt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `leg_${(h >>> 0).toString(16)}`;
}

export function archiveIdOf(cell: RetiredMatrixCell): string {
  return cell.archiveId?.trim() || stableLegacyArchiveId(cell);
}

/** Strip archive-only fields when reviving into the live matrix. */
export function toLiveMatrixCell(
  prev: MatrixCell | RetiredMatrixCell,
): MatrixCell {
  const raw = { ...prev } as Record<string, unknown>;
  delete raw.retiredAt;
  delete raw.reason;
  delete raw.archiveId;
  return raw as MatrixCell;
}

/**
 * Prefer the prior cell with the richest shippable media when merging by signature.
 */
export function richerMatrixCell(
  a: MatrixCell | RetiredMatrixCell,
  b: MatrixCell | RetiredMatrixCell,
): MatrixCell | RetiredMatrixCell {
  const score = (c: MatrixCell | RetiredMatrixCell) => {
    let n = 0;
    for (const a of c.sizeAssets ?? []) {
      if (a.genPath) n += 4;
      if (a.previewPath) n += 2;
      if (a.outputPath) n += 2;
      if (a.promptHash) n += 1;
    }
    if (c.previewPath) n += 1;
    if (c.outputPath) n += 1;
    if (c.previewOk) n += 1;
    return n;
  };
  return score(b) > score(a) ? b : a;
}

export function resolveMatrixCell(
  campaign: Pick<Campaign, "matrix">,
  ref: string,
): ResolvedMatrixCell | null {
  const trimmed = ref?.trim();
  if (!trimmed) return null;

  const archiveId = parseArchiveId(trimmed);
  if (archiveId) {
    const retired = campaign.matrix.retired ?? [];
    const index = retired.findIndex((c) => archiveIdOf(c) === archiveId);
    if (index < 0) return null;
    return {
      cell: retired[index]!,
      pool: "retired",
      index,
      ref: makeArchiveRef(archiveId),
    };
  }

  const live = campaign.matrix.cells ?? [];
  const liveIdx = live.findIndex((c) => c.cellId === trimmed);
  if (liveIdx >= 0) {
    return {
      cell: live[liveIdx]!,
      pool: "live",
      index: liveIdx,
      ref: trimmed,
    };
  }

  // Fallback: unique retired cellId (legacy rows)
  const retired = campaign.matrix.retired ?? [];
  const matches = retired
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.cellId === trimmed);
  if (matches.length === 1) {
    const { c, index } = matches[0]!;
    return {
      cell: c,
      pool: "retired",
      index,
      ref: makeArchiveRef(archiveIdOf(c)),
    };
  }
  return null;
}

export type PreviewListEntry = ResolvedMatrixCell & {
  label: string;
  isArchive: boolean;
};

export function cellHasShippableMedia(cell: MatrixCell | RetiredMatrixCell): boolean {
  if (cell.previewPath || cell.outputPath) return true;
  return (cell.sizeAssets ?? []).some(
    (a) => a.genPath || a.previewPath || a.outputPath,
  );
}

export function cellHasGen(cell: MatrixCell | RetiredMatrixCell): boolean {
  return (cell.sizeAssets ?? []).some((a) => Boolean(a.genPath));
}

/** Live cells first, then archived (for Preview bay). */
export function listPreviewCells(
  campaign: Pick<Campaign, "matrix">,
  opts?: {
    liveFilter?: Set<string> | null;
    archiveFilter?: Set<string> | null;
  },
): PreviewListEntry[] {
  const out: PreviewListEntry[] = [];
  const live = campaign.matrix.cells ?? [];
  for (let index = 0; index < live.length; index++) {
    const cell = live[index]!;
    if (opts?.liveFilter?.size && !opts.liveFilter.has(cell.cellId)) continue;
    out.push({
      cell,
      pool: "live",
      index,
      ref: cell.cellId,
      label: cell.cellId,
      isArchive: false,
    });
  }
  const retired = campaign.matrix.retired ?? [];
  for (let index = 0; index < retired.length; index++) {
    const cell = retired[index]!;
    const archiveId = archiveIdOf(cell);
    if (opts?.archiveFilter?.size && !opts.archiveFilter.has(archiveId)) {
      continue;
    }
    out.push({
      cell,
      pool: "retired",
      index,
      ref: makeArchiveRef(archiveId),
      label: cell.cellId,
      isArchive: true,
    });
  }
  return out;
}

/** Safe filename fragment for Remotion outputs (live cellId or arch_<id>). */
export function outputPathCellKey(ref: string): string {
  const archiveId = parseArchiveId(ref);
  if (archiveId) return `arch_${archiveId}`;
  return ref.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
