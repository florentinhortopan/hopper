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
  makeArchiveRef,
  sceneTagToCeltraFrame,
  validateCeltraWideRow,
  type Campaign,
  type CeltraFrameId,
  type CeltraMatrixRow,
  type CeltraPreview,
  type CeltraTemplateProfile,
  type MatrixCell,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import { emitCampaignEvent } from "./campaignEvents.js";
import { resolveDataMediaPath } from "./mediaPaths.js";
import { getCampaign, getReviews, getTokens } from "./store.js";

type PackRow = {
  ref: string;
  variantId: string;
  cell: MatrixCell;
};

function pickPlateAbsPath(cell: MatrixCell): string | null {
  const assets = cell.sizeAssets ?? [];
  for (const a of assets) {
    if (a.genPath?.trim()) {
      const abs = resolveDataMediaPath(a.genPath);
      if (existsSync(abs)) {
        // Prefer original still for Celtra image columns when wrap left a sibling PNG/JPG
        const ext = path.extname(abs).toLowerCase();
        if (ext === ".mp4" || ext === ".webm" || ext === ".mov") {
          for (const stillExt of [".png", ".jpg", ".jpeg", ".webp"]) {
            const sibling = abs.slice(0, -ext.length) + stillExt;
            if (existsSync(sibling)) return sibling;
          }
        }
        return abs;
      }
    }
  }
  for (const a of assets) {
    for (const p of [a.outputPath, a.previewPath]) {
      if (p?.trim()) {
        const abs = resolveDataMediaPath(p);
        if (existsSync(abs)) return abs;
      }
    }
  }
  for (const p of [cell.outputPath, cell.previewPath]) {
    if (p?.trim()) {
      const abs = resolveDataMediaPath(p);
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

function collectPackable(
  campaign: Campaign,
  approved: Set<string>,
): PackRow[] {
  const packable: PackRow[] = [];
  for (const cell of campaign.matrix.cells) {
    if (!approved.has(cell.cellId)) continue;
    if (!pickPlateAbsPath(cell)) continue;
    packable.push({ ref: cell.cellId, variantId: cell.cellId, cell });
  }
  for (const cell of campaign.matrix.retired ?? []) {
    const ref = makeArchiveRef(archiveIdOf(cell));
    if (!approved.has(ref) && !approved.has(cell.cellId)) continue;
    if (!pickPlateAbsPath(cell)) continue;
    packable.push({
      ref: approved.has(ref) ? ref : cell.cellId,
      variantId: ref,
      cell,
    });
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
 *   ATTATTA_<Campaign>_Celtra_vNN_<YYYYMMDD-HHmm>_<N>rows.zip
 * Version increments per campaign slug from existing files in data/packages.
 */
export async function nextCeltraPackageFileName(
  campaign: Campaign,
  rowCount: number,
): Promise<string> {
  const slug = campaignSlug(campaign);
  const prefix = `ATTATTA_${slug}_Celtra_v`;
  let nextVer = 1;
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(PATHS.packages);
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".zip")) continue;
      const m = name.slice(prefix.length).match(/^(\d+)_/);
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

/** Live Celtra matrix preview — all matrix cells (draft → kept). No zip write. */
export async function buildCeltraPreview(
  campaignId: string,
): Promise<CeltraPreview> {
  assertGuaranteeTranche3ProfileIntegrity();
  const campaign = await getCampaign(campaignId);
  const reviews = await getReviews(campaignId);
  const decisionByCell = new Map(
    reviews.map((r) => [r.cellId, r.decision] as const),
  );
  const profile = getCeltraTemplateProfile(campaign.celtraTemplateProfileId);
  const warnings: string[] = [];
  const rows: CeltraPreview["rows"] = [];

  let order = 1;
  for (const cell of campaign.matrix.cells) {
    const plateAbs = pickPlateAbsPath(cell);
    const decisionRaw = decisionByCell.get(cell.cellId) || "pending";
    const decision =
      decisionRaw === "approved" || decisionRaw === "rejected"
        ? decisionRaw
        : "pending";
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
    const rowWarnings: string[] = [];
    if (!plateAbs) rowWarnings.push("No plate yet");
    if (decision !== "approved") rowWarnings.push("Not kept — zip will skip");
    const packable = decision === "approved" && Boolean(plateAbs);
    rows.push({
      order,
      cellId: cell.cellId,
      frame,
      platePath: plateAbs,
      setup,
      punchline,
      endcard,
      decision,
      hasPlate: Boolean(plateAbs),
      packable,
      warnings: rowWarnings,
    });
    order += 1;
  }

  const approvedCount = rows.filter((r) => r.decision === "approved").length;
  const packableCount = rows.filter((r) => r.packable).length;

  if (!rows.length) {
    warnings.push("No matrix cells yet — run Magic prepare to draft Celtra rows");
  } else if (!packableCount) {
    warnings.push(
      "Draft matrix live — Keep variants with plates to include them in the zip",
    );
  }

  return {
    campaignId,
    profileId: profile.id,
    rowCount: rows.length,
    approvedCount,
    packableCount,
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
  const approved = new Set(
    reviews.filter((r) => r.decision === "approved").map((r) => r.cellId),
  );

  const profile = getCeltraTemplateProfile(campaign.celtraTemplateProfileId);
  const packable = collectPackable(campaign, approved);

  if (packable.length === 0) {
    throw new Error(
      "No approved cells with plate media (genPath / preview / master) to package. Keep at least one variant that still has a plate.",
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
  for (const { ref, variantId, cell } of packable) {
    const plateAbs = pickPlateAbsPath(cell);
    if (!plateAbs) continue;

    const frame =
      sceneTagToCeltraFrame(profile, cell.sceneTag) ??
      ("F2" as CeltraFrameId);

    const rawBase = path.basename(plateAbs);
    const zipBase = uniqueAssetBasename(
      `${variantId.replace(/[^a-zA-Z0-9._-]+/g, "_")}_${frame}_${rawBase}`,
      usedBasenames,
    );
    assetFiles.push({ abs: plateAbs, zipName: `assets/${zipBase}` });

    const frameFiles: Partial<Record<CeltraFrameId, string>> = {
      [frame]: zipBase,
    };

    const versionLabel =
      [cell.copy.setup, cell.copy.punchline].filter(Boolean).join(" / ").trim() ||
      variantId;

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
    for (const e of errors) hardErrors.push(`Row ${order} (${variantId}): ${e}`);
    for (const w of warnings) allWarnings.push(`Row ${order} (${variantId}): ${w}`);

    // Soft required-frame check for the tagged frame only
    if (!frameFiles[frame]) {
      hardErrors.push(`Row ${order}: missing plate for frame ${frame}`);
    }

    wideRows.push(values);

    const review =
      reviews.find((r) => r.cellId === ref) ||
      reviews.find((r) => r.cellId === cell.cellId);

    debugRows.push({
      variantId,
      campaignId: campaign.id,
      videoPath: zipBase,
      aspect: campaign.outputSizes?.[0]?.aspect ?? "9:16",
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
