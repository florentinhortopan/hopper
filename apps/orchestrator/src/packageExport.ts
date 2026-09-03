import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import ExcelJS from "exceljs";
import {
  archiveIdOf,
  assertGuaranteeTranche3ProfileIntegrity,
  buildCeltraWideRow,
  formatCeltraAssetName,
  getCeltraTemplateProfile,
  isSizePackable,
  makeArchiveRef,
  reviewDecisionFor,
  sceneTagToCeltraFrame,
  validateCeltraWideRow,
  type Campaign,
  type CeltraFrameId,
  type CeltraMatrixRow,
  type CeltraPreview,
  type CeltraTemplateProfile,
  type MatrixCell,
  type OutputSize,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import { emitCampaignEvent } from "./campaignEvents.js";
import { resolveDataMediaPath } from "./mediaPaths.js";
import { getCampaign, getReviews, getTokens } from "./store.js";

type PackRow = {
  ref: string;
  variantId: string;
  cell: MatrixCell;
  size: OutputSize;
  plateAbs: string;
};

function pickPlateAbsPath(cell: MatrixCell): string | null {
  const assets = cell.sizeAssets ?? [];
  for (const a of assets) {
    const hit = resolveSizePlateAbs(a);
    if (hit) return hit;
  }
  for (const p of [cell.outputPath, cell.previewPath]) {
    if (p?.trim()) {
      const abs = resolveDataMediaPath(p);
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

/** Prefer still sibling when genPath is an MP4 wrap (Celtra image columns). */
function resolveSizePlateAbs(asset: {
  genPath?: string | null;
  outputPath?: string | null;
  previewPath?: string | null;
}): string | null {
  for (const p of [asset.genPath, asset.outputPath, asset.previewPath]) {
    if (!p?.trim()) continue;
    const abs = resolveDataMediaPath(p);
    if (!existsSync(abs)) continue;
    const ext = path.extname(abs).toLowerCase();
    if (ext === ".mp4" || ext === ".webm" || ext === ".mov") {
      for (const stillExt of [".png", ".jpg", ".jpeg", ".webp"]) {
        const sibling = abs.slice(0, -ext.length) + stillExt;
        if (existsSync(sibling)) return sibling;
      }
    }
    return abs;
  }
  return null;
}

function collectPackable(
  campaign: Campaign,
  reviews: Awaited<ReturnType<typeof getReviews>>,
): PackRow[] {
  const sizes = campaign.outputSizes || [];
  const packable: PackRow[] = [];

  function plateForSize(cell: MatrixCell, size: OutputSize): string | null {
    const asset = cell.sizeAssets?.find((a) => a.sizeId === size.id);
    if (!asset) return sizes.length <= 1 ? pickPlateAbsPath(cell) : null;
    const path = resolveSizePlateAbs(asset);
    if (!path) return null;
    const key = asset.genPath?.trim() || asset.outputPath?.trim() || "";
    if (key) {
      const sharedWrong = (cell.sizeAssets ?? []).some(
        (a) =>
          a.sizeId !== size.id &&
          a.aspect !== size.aspect &&
          (a.genPath?.trim() || a.outputPath?.trim() || "") === key,
      );
      if (sharedWrong) return null;
    }
    return path;
  }

  function pushCell(ref: string, variantId: string, cell: MatrixCell) {
    if (!sizes.length) {
      const plateAbs = pickPlateAbsPath(cell);
      if (!plateAbs) return;
      if (reviewDecisionFor(reviews, cell.cellId) !== "approved") return;
      packable.push({
        ref,
        variantId,
        cell,
        size: {
          id: "legacy",
          label: "default",
          aspect: "9:16",
          width: 1080,
          height: 1920,
        },
        plateAbs,
      });
      return;
    }
    for (const size of sizes) {
      const plateAbs = plateForSize(cell, size);
      if (!plateAbs) continue;
      const kept =
        isSizePackable(reviews, cell.cellId, size.id, true) ||
        (ref !== cell.cellId && isSizePackable(reviews, ref, size.id, true));
      if (!kept) continue;
      packable.push({ ref, variantId, cell, size, plateAbs });
    }
  }

  for (const cell of campaign.matrix.cells) {
    pushCell(cell.cellId, cell.cellId, cell);
  }
  for (const cell of campaign.matrix.retired ?? []) {
    const ref = makeArchiveRef(archiveIdOf(cell));
    pushCell(ref, ref, cell);
  }
  return packable;
}

function uniqueAssetBasename(
  preferred: string,
  used: Set<string>,
): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  const ext = path.extname(preferred);
  const stem = path.basename(preferred, ext);
  let i = 2;
  while (used.has(`${stem}_${i}${ext}`)) i += 1;
  const next = `${stem}_${i}${ext}`;
  used.add(next);
  return next;
}

async function buildSocialVideoWorkbook(
  profile: CeltraTemplateProfile,
  dataRows: string[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(profile.ingestSheet);

  if (profile.groupHeaderRow != null) {
    const groupRow = ws.getRow(profile.groupHeaderRow);
    profile.groupHeaders.forEach((label, i) => {
      groupRow.getCell(i + 1).value = label ?? "";
    });
    groupRow.commit();
  }

  const headerRow = ws.getRow(profile.headerRow);
  profile.headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  headerRow.font = { bold: true };
  headerRow.commit();

  let excelRow = profile.headerRow + 1;
  for (const values of dataRows) {
    const row = ws.getRow(excelRow);
    values.forEach((v, i) => {
      row.getCell(i + 1).value = v;
    });
    row.commit();
    excelRow += 1;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildCsv(profile: CeltraTemplateProfile, dataRows: string[][]): string {
  const lines = [
    profile.headers.map(csvEscape).join(","),
    ...dataRows.map((r) => r.map(csvEscape).join(",")),
  ];
  return lines.join("\n");
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function campaignSlug(campaign: Campaign): string {
  return (
    (campaign.name || campaign.id)
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || campaign.id
  );
}

function stampLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Package zip naming:
 *   SCOTTY_<Campaign>_Celtra_vNN_<YYYYMMDD-HHmm>_<N>rows.zip
 * Version increments per campaign slug from existing files in data/packages.
 */
export async function nextCeltraPackageFileName(
  campaign: Campaign,
  rowCount: number,
): Promise<string> {
  const slug = campaignSlug(campaign);
  const prefix = `SCOTTY_${slug}_Celtra_v`;
  const legacyPrefix = `ATTATTA_${slug}_Celtra_v`;
  let nextVer = 1;
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(PATHS.packages);
    for (const name of names) {
      const hit = name.startsWith(prefix)
        ? prefix
        : name.startsWith(legacyPrefix)
          ? legacyPrefix
          : null;
      if (!hit || !name.endsWith(".zip")) continue;
      const m = name.slice(hit.length).match(/^(\d+)_/);
      if (m) nextVer = Math.max(nextVer, Number(m[1]) + 1);
    }
  } catch {
    /* first package for this campaign */
  }
  const v = String(nextVer).padStart(2, "0");
  return `${prefix}${v}_${stampLocal()}_${rowCount}rows.zip`;
}

export type CeltraPackageResult = {
  zipPath: string;
  fileName: string;
  rowCount: number;
  /** Path-style download URL ending in .zip (reliable for browsers). */
  downloadPath: string;
};

/** Live Celtra matrix preview — all matrix cells (draft → kept). No zip write.
 * One row = one Celtra order (variant). Settings sizes are slots on that row
 * (Asset Name `_SIZE_LENGTH` explode — not one spreadsheet row per aspect).
 */
export async function buildCeltraPreview(
  campaignId: string,
): Promise<CeltraPreview> {
  assertGuaranteeTranche3ProfileIntegrity();
  const campaign = await getCampaign(campaignId);
  const reviews = await getReviews(campaignId);
  const profile = getCeltraTemplateProfile(campaign.celtraTemplateProfileId);
  const warnings: string[] = [];
  const rows: CeltraPreview["rows"] = [];
  const catalog = campaign.outputSizes || [];
  const sizes = catalog.map((s) => ({
    id: s.id,
    aspect: s.aspect,
    label: s.label,
  }));

  let order = 1;
  let sizeSlotReady = 0;
  let sizeSlotTotal = 0;
  for (const cell of campaign.matrix.cells) {
    const plateAbs = pickPlateAbsPath(cell);
    const decision = reviewDecisionFor(reviews, cell.cellId);
    const frame =
      sceneTagToCeltraFrame(profile, cell.sceneTag) ??
      ("F2" as CeltraFrameId);
    const setup = clip(
      cell.copy.setup || "",
      profile.charLimits["F1 Headline (max 35 char)"] ?? 35,
    );
    const punchline = clip(
      cell.copy.punchline || "",
      profile.charLimits["F2 Headline (max 35 char)"] ?? 35,
    );
    const endcard = clip(
      cell.copy.endcard || "",
      profile.charLimits["EC headline (max 77 char)"] ?? 77,
    );
    const sizeSlots = catalog.map((s) => {
      const asset = cell.sizeAssets?.find((a) => a.sizeId === s.id);
      let path = asset ? resolveSizePlateAbs(asset) : null;
      if (path && asset) {
        const candidates = [
          asset.genPath?.trim(),
          asset.outputPath?.trim(),
          asset.previewPath?.trim(),
        ].filter(Boolean) as string[];
        let accepted: string | null = null;
        for (const key of candidates) {
          const sharedWrong = (cell.sizeAssets ?? []).some(
            (a) =>
              a.sizeId !== s.id &&
              a.aspect !== s.aspect &&
              (a.genPath?.trim() ||
                a.outputPath?.trim() ||
                a.previewPath?.trim() ||
                "") === key,
          );
          if (!sharedWrong) {
            accepted = key;
            break;
          }
        }
        if (!accepted) {
          path = null;
        } else if (accepted !== (asset.genPath?.trim() || "")) {
          // Prefer a non-shared field (e.g. assembled output over inherited gen)
          const abs = resolveDataMediaPath(accepted);
          path = existsSync(abs) ? abs : resolveSizePlateAbs({
            genPath: null,
            outputPath: asset.outputPath,
            previewPath: asset.previewPath,
          });
        }
      }
      const sizeDecision = reviewDecisionFor(reviews, cell.cellId, s.id);
      const packable = isSizePackable(
        reviews,
        cell.cellId,
        s.id,
        Boolean(path),
      );
      return {
        sizeId: s.id,
        aspect: s.aspect,
        label: s.label,
        platePath: path,
        ready: Boolean(path),
        decision: sizeDecision,
        packable,
        width: s.width,
        height: s.height,
      };
    });
    const sizesReady = sizeSlots.filter((s) => s.ready).length;
    const sizesTotal = sizeSlots.length || (plateAbs ? 1 : 0);
    const sizesPackable = sizeSlots.filter((s) => s.packable).length;
    sizeSlotReady += sizesReady;
    sizeSlotTotal += sizesTotal;
    const rowWarnings: string[] = [];
    if (!plateAbs && sizesReady === 0) rowWarnings.push("No plate yet");
    if (sizesTotal > 0 && sizesReady < sizesTotal) {
      rowWarnings.push(`${sizesReady}/${sizesTotal} sizes ready`);
    }
    if (sizesPackable === 0) {
      rowWarnings.push("Keep a size (or whole variant) to include in zip");
    }
    rows.push({
      order,
      cellId: cell.cellId,
      frame,
      platePath: plateAbs || sizeSlots.find((s) => s.platePath)?.platePath || null,
      setup,
      punchline,
      endcard,
      decision,
      hasPlate: Boolean(plateAbs) || sizesReady > 0,
      packable: sizesPackable > 0,
      sizes: sizeSlots,
      sizesReady,
      sizesTotal,
      warnings: rowWarnings,
    });
    order += 1;
  }

  const approvedCount = rows.filter(
    (r) => r.decision === "approved" || r.sizes.some((s) => s.packable),
  ).length;
  const packableCount = rows.reduce(
    (n, r) => n + r.sizes.filter((s) => s.packable).length,
    0,
  );

  if (!rows.length) {
    warnings.push("No matrix cells yet — run Magic prepare to draft Celtra rows");
  } else if (!packableCount) {
    warnings.push(
      "Draft matrix live — Keep a size (or Keep all) with plates to include in the zip",
    );
  }
  if (sizeSlotTotal > 0 && sizeSlotReady < sizeSlotTotal) {
    warnings.push(
      `Size coverage ${sizeSlotReady}/${sizeSlotTotal} — native plates per aspect; zip emits one order row per kept size`,
    );
  }

  return {
    campaignId,
    profileId: profile.id,
    rowCount: rows.length,
    approvedCount,
    packableCount,
    sizes,
    sizeSlotReady,
    sizeSlotTotal,
    rows,
    warnings,
    updatedAt: new Date().toISOString(),
  };
}

export async function buildCeltraPackage(
  campaignId: string,
): Promise<CeltraPackageResult> {
  assertGuaranteeTranche3ProfileIntegrity();

  const campaign = await getCampaign(campaignId);
  const reviews = await getReviews(campaignId);

  const profile = getCeltraTemplateProfile(campaign.celtraTemplateProfileId);
  const packable = collectPackable(campaign, reviews);

  if (packable.length === 0) {
    throw new Error(
      "No kept sizes with plate media to package. Keep at least one size (or Keep all on a variant) that still has a plate.",
    );
  }

  let tokens;
  try {
    tokens = await getTokens(campaign.designTokenPackId);
  } catch {
    tokens = null;
  }

  const funnel =
    campaign.brief.audience?.trim() ||
    campaign.brief.offer?.trim() ||
    "LookingBuying";
  const bgColor = tokens?.colors.background ?? "009FDB";
  const ctaColor = tokens?.colors.accent ?? "00388F";

  const usedBasenames = new Set<string>();
  const assetFiles: Array<{ abs: string; zipName: string }> = [];
  const wideRows: string[][] = [];
  const debugRows: CeltraMatrixRow[] = [];
  const allWarnings: string[] = [];
  const hardErrors: string[] = [];

  let order = 1;
  for (const { ref, variantId, cell, size, plateAbs } of packable) {
    const frame =
      sceneTagToCeltraFrame(profile, cell.sceneTag) ??
      ("F2" as CeltraFrameId);

    const rawBase = path.basename(plateAbs);
    const zipBase = uniqueAssetBasename(
      `${variantId.replace(/[^a-zA-Z0-9._-]+/g, "_")}_${size.aspect.replace(":", "x")}_${frame}_${rawBase}`,
      usedBasenames,
    );
    assetFiles.push({ abs: plateAbs, zipName: `assets/${zipBase}` });

    const frameFiles: Partial<Record<CeltraFrameId, string>> = {
      [frame]: zipBase,
    };

    const versionLabel =
      [
        cell.copy.setup,
        cell.copy.punchline,
        size.aspect !== "legacy" ? size.aspect : "",
      ]
        .filter(Boolean)
        .join(" / ")
        .trim() || variantId;

    const frameHeadlines: Partial<Record<CeltraFrameId, string>> = {
      F1: clip(cell.copy.setup || "", profile.charLimits["F1 Headline (max 35 char)"] ?? 35),
      F2: clip(
        cell.copy.punchline || "",
        profile.charLimits["F2 Headline (max 35 char)"] ?? 35,
      ),
      F3:
        cell.sceneTag === "endcard"
          ? clip(
              cell.copy.endcard || "",
              profile.charLimits["F3 Headline (max 35 char)"] ?? 35,
            )
          : "",
    };

    const ecEyebrow = clip(
      campaign.brief.offer?.trim() || cell.copy.cta || "",
      profile.charLimits["EC Eyebrow (max 30 char)"] ?? 30,
    );
    const ecHeadline = clip(
      cell.copy.endcard || "",
      profile.charLimits["EC headline (max 77 char)"] ?? 77,
    );
    const ecDisclaimer = (campaign.brief.mustSay ?? []).join(" ").trim();

    const assetName = formatCeltraAssetName(profile, {
      campaign: campaign.name || campaign.id,
      funnel,
      version: versionLabel.slice(0, 48),
    });

    const values = buildCeltraWideRow(profile, {
      celtraOrder: order,
      versionLabel: `${String(order).padStart(2, "0")} - ${versionLabel}`,
      funnel,
      bgColor,
      ctaColor,
      frameFiles,
      frameHeadlines,
      ecEyebrow,
      ecHeadline,
      ecDisclaimer,
      assetName,
    });

    const { errors, warnings } = validateCeltraWideRow(profile, values, {
      requireFrames: false,
    });
    for (const e of errors) hardErrors.push(`Row ${order} (${variantId}/${size.aspect}): ${e}`);
    for (const w of warnings) allWarnings.push(`Row ${order} (${variantId}/${size.aspect}): ${w}`);

    if (!frameFiles[frame]) {
      hardErrors.push(`Row ${order}: missing plate for frame ${frame}`);
    }

    wideRows.push(values);

    const review =
      reviews.find((r) => r.cellId === ref && r.sizeId === size.id) ||
      reviews.find((r) => r.cellId === cell.cellId && r.sizeId === size.id) ||
      reviews.find((r) => r.cellId === ref && !r.sizeId) ||
      reviews.find((r) => r.cellId === cell.cellId && !r.sizeId);

    debugRows.push({
      variantId: `${variantId}:${size.id}`,
      campaignId: campaign.id,
      videoPath: zipBase,
      aspect: size.aspect,
      primaryText: cell.copy.setup,
      headline: cell.copy.endcard,
      cta: cell.copy.cta,
      landingUrl: "",
      angle: cell.copy.punchline,
      handsId: cell.handsId,
      talentTakeId: cell.talentTakeId,
      attireId: cell.attireId ?? null,
      backgroundId: cell.backgroundId ?? null,
      propIds: cell.propIds ?? [],
      designTokenPackId: cell.designTokenPackId,
      approvalStatus: "approved",
      reviewNotes: review?.notes ?? "",
      celtraFrameId: frame,
      platePath: `assets/${zipBase}`,
    });

    order += 1;
  }

  if (hardErrors.length) {
    throw new Error(hardErrors.join("\n"));
  }

  const xlsxBuf = await buildSocialVideoWorkbook(profile, wideRows);
  const csvText = buildCsv(profile, wideRows);

  await mkdir(PATHS.packages, { recursive: true });
  const zipName = await nextCeltraPackageFileName(campaign, wideRows.length);
  const zipPath = path.join(PATHS.packages, zipName);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(xlsxBuf, { name: "content_matrix.xlsx" });
    archive.append(csvText, { name: "content_matrix.csv" });
    archive.append(
      JSON.stringify(
        {
          campaignId,
          celtraTemplateProfileId: profile.id,
          ingestSheet: profile.ingestSheet,
          warnings: allWarnings,
          rows: debugRows,
        },
        null,
        2,
      ),
      { name: "matrix.json" },
    );
    archive.append(
      [
        `Celtra profile: ${profile.id}`,
        profile.celtraTemplateNote,
        "",
        "Ingest: open content_matrix.xlsx → sheet Social Video (or paste CSV).",
        "Assets are under assets/ — filenames match F* Image File Name cells.",
        "Thumbnail / Logo formula columns are intentionally blank (no #VALUE!).",
        "",
        ...(allWarnings.length
          ? ["Warnings:", ...allWarnings.map((w) => `- ${w}`)]
          : ["No validation warnings."]),
      ].join("\n"),
      { name: "README.txt" },
    );

    for (const f of assetFiles) {
      archive.file(f.abs, { name: f.zipName });
    }

    void archive.finalize();
  });

  await readFile(zipPath);
  const result = {
    zipPath,
    fileName: zipName,
    rowCount: wideRows.length,
    downloadPath: `/packages/${encodeURIComponent(zipName)}`,
  };
  emitCampaignEvent({
    campaignId,
    column: "celtra",
    type: "celtra_package",
    summary: `Celtra zip ${zipName} · ${wideRows.length} row(s)`,
    payload: { fileName: zipName, rowCount: wideRows.length },
  });
  return result;
}
