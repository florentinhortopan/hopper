import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import {
  archiveIdOf,
  makeArchiveRef,
  type CeltraMatrixRow,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import { getCampaign, getReviews } from "./store.js";

export async function buildCeltraPackage(campaignId: string): Promise<string> {
  const campaign = await getCampaign(campaignId);
  const reviews = await getReviews(campaignId);
  const approved = new Set(
    reviews.filter((r) => r.decision === "approved").map((r) => r.cellId),
  );

  type PackRow = {
    ref: string;
    variantId: string;
    cell: (typeof campaign.matrix.cells)[number];
  };
  const packable: PackRow[] = [];

  for (const cell of campaign.matrix.cells) {
    if (!approved.has(cell.cellId)) continue;
    if (!cell.outputPath) continue;
    packable.push({ ref: cell.cellId, variantId: cell.cellId, cell });
  }
  for (const cell of campaign.matrix.retired ?? []) {
    const ref = makeArchiveRef(archiveIdOf(cell));
    if (!approved.has(ref) && !approved.has(cell.cellId)) continue;
    if (!cell.outputPath) continue;
    packable.push({
      ref: approved.has(ref) ? ref : cell.cellId,
      variantId: ref,
      cell,
    });
  }

  const rows: CeltraMatrixRow[] = [];
  for (const { ref, variantId, cell } of packable) {
    const review =
      reviews.find((r) => r.cellId === ref) ||
      reviews.find((r) => r.cellId === cell.cellId);
    rows.push({
      variantId,
      campaignId: campaign.id,
      videoPath: path.basename(cell.outputPath!),
      aspect: "9:16",
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
    });
  }

  if (rows.length === 0) {
    throw new Error("No approved cells with rendered outputs to package");
  }

  await mkdir(PATHS.packages, { recursive: true });
  const zipName = `${campaign.id}_${Date.now()}.zip`;
  const zipPath = path.join(PATHS.packages, zipName);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(JSON.stringify({ campaignId, rows }, null, 2), {
      name: "matrix.json",
    });

    const seenFiles = new Set<string>();
    for (const { cell } of packable) {
      if (!cell.outputPath) continue;
      const base = path.basename(cell.outputPath);
      if (seenFiles.has(base)) continue;
      seenFiles.add(base);
      archive.file(cell.outputPath, { name: base });
    }

    void archive.finalize();
  });

  // touch read to ensure file exists
  await readFile(zipPath);

  return zipPath;
}
