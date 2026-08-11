import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Campaign, MatrixCell, RetiredMatrixCell } from "@attatta/shared";
import { PATHS } from "./config.js";
import { canonicalizeStoredMediaPath, resolveDataMediaPath } from "./mediaPaths.js";

type PathFields = "previewPath" | "outputPath" | "genPath";

function expectedAssemblePath(
  campaignId: string,
  cellId: string,
  stage: "preview" | "render",
  sizeId: string,
) {
  const dir = path.join(
    PATHS.campaigns,
    campaignId,
    stage === "preview" ? "previews" : "outputs",
  );
  return path.join(dir, `${cellId}__${sizeId}.mp4`);
}

/** True when assemble file is older than the Comfy gen it should include. */
function assembleStaleVsGen(
  assemblePath: string | null | undefined,
  genPath: string | null | undefined,
): boolean {
  if (!assemblePath?.trim() || !genPath?.trim()) return false;
  try {
    const assembleAbs = resolveDataMediaPath(assemblePath);
    const genAbs = resolveDataMediaPath(genPath);
    if (!existsSync(assembleAbs) || !existsSync(genAbs)) return false;
    return statSync(genAbs).mtimeMs > statSync(assembleAbs).mtimeMs + 500;
  } catch {
    return false;
  }
}

function rewritePath(p: string | null | undefined): {
  next: string | null;
  changed: boolean;
} {
  if (p == null) return { next: p ?? null, changed: false };
  const next = canonicalizeStoredMediaPath(p);
  return { next, changed: next !== p };
}

function repairCellMedia(
  campaignId: string,
  cell: MatrixCell | RetiredMatrixCell,
): boolean {
  let dirty = false;

  for (const key of ["previewPath", "outputPath"] as const) {
    const { next, changed } = rewritePath(cell[key]);
    if (changed) {
      cell[key] = next;
      dirty = true;
    }
  }

  for (const asset of cell.sizeAssets ?? []) {
    for (const key of ["previewPath", "outputPath", "genPath"] as PathFields[]) {
      const { next, changed } = rewritePath(asset[key]);
      if (changed) {
        asset[key] = next;
        dirty = true;
      }
    }

    // Drop assembles that predate their Comfy plate (stale talent-only previews)
    if (assembleStaleVsGen(asset.previewPath, asset.genPath)) {
      asset.previewPath = null;
      if (asset.status === "preview_ok" || asset.status === "ready") {
        asset.status = "pending";
      }
      dirty = true;
    }
    if (assembleStaleVsGen(asset.outputPath, asset.genPath)) {
      asset.outputPath = null;
      if (asset.status === "ready") asset.status = "preview_ok";
      dirty = true;
    }

    // Re-attach assemble outputs that still sit on disk after matrix rebuild
    // (skip if that file is older than gen — same stale trap)
    if (!asset.previewPath?.trim()) {
      const expected = expectedAssemblePath(
        campaignId,
        cell.cellId,
        "preview",
        asset.sizeId,
      );
      if (existsSync(expected) && !assembleStaleVsGen(expected, asset.genPath)) {
        asset.previewPath = expected;
        if (asset.status === "pending" || asset.status === "generating") {
          asset.status = "preview_ok";
        }
        dirty = true;
      }
    }
    if (!asset.outputPath?.trim()) {
      const expected = expectedAssemblePath(
        campaignId,
        cell.cellId,
        "render",
        asset.sizeId,
      );
      if (existsSync(expected) && !assembleStaleVsGen(expected, asset.genPath)) {
        asset.outputPath = expected;
        if (asset.status !== "failed") asset.status = "ready";
        dirty = true;
      }
    }
  }

  // Keep cell.previewPath in sync with size assets (drop cleared stale pointers)
  const livePreviewPaths = (cell.sizeAssets ?? [])
    .map((a) => a.previewPath?.trim())
    .filter((p): p is string => Boolean(p));
  if (
    cell.previewPath?.trim() &&
    !livePreviewPaths.includes(cell.previewPath)
  ) {
    cell.previewPath = livePreviewPaths[0] ?? null;
    cell.previewOk = Boolean(cell.previewPath);
    dirty = true;
  }

  // Cell-level preview pointer + legacy name without size suffix
  if (!cell.previewPath?.trim()) {
    const fromAsset =
      cell.sizeAssets?.find((a) => a.previewPath?.trim())?.previewPath || null;
    if (fromAsset) {
      cell.previewPath = fromAsset;
      cell.previewOk = true;
      if (cell.status === "draft" || cell.status === "previewing") {
        cell.status = "preview_ok";
      }
      dirty = true;
    } else {
      const primary =
        cell.sizeAssets?.[0]?.sizeId || "v_9x16_1080";
      const expected = expectedAssemblePath(
        campaignId,
        cell.cellId,
        "preview",
        primary,
      );
      const legacy = path.join(
        path.dirname(expected),
        `${cell.cellId}.mp4`,
      );
      if (existsSync(expected)) {
        cell.previewPath = expected;
        cell.previewOk = true;
        dirty = true;
      } else if (existsSync(legacy)) {
        cell.previewPath = legacy;
        cell.previewOk = true;
        dirty = true;
      }
    }
  } else {
    const { next, changed } = rewritePath(cell.previewPath);
    if (changed) {
      cell.previewPath = next;
      dirty = true;
    }
  }

  if (!cell.outputPath?.trim()) {
    const fromAsset =
      cell.sizeAssets?.find((a) => a.outputPath?.trim())?.outputPath || null;
    if (fromAsset) {
      cell.outputPath = fromAsset;
      dirty = true;
    }
  }

  if (
    cell.previewPath?.trim() &&
    existsSync(cell.previewPath) &&
    !cell.previewOk
  ) {
    cell.previewOk = true;
    if (cell.status === "draft" || cell.status === "previewing") {
      cell.status = "preview_ok";
    }
    dirty = true;
  }

  return dirty;
}

/** Rewrite legacy library paths + re-link orphan preview/output files. */
export function repairCampaignMediaPaths(campaign: Campaign): boolean {
  let dirty = false;
  for (const cell of campaign.matrix.cells ?? []) {
    if (repairCellMedia(campaign.id, cell)) dirty = true;
  }
  for (const cell of campaign.matrix.retired ?? []) {
    if (repairCellMedia(campaign.id, cell)) dirty = true;
  }
  return dirty;
}
