import path from "node:path";
import { mkdir } from "node:fs/promises";
import { renderAd } from "./render.js";
import {
  getCampaign,
  getTokens,
  libraryAbsolutePath,
  listLibrary,
} from "./store.js";

async function main() {
  const c = await getCampaign("demo_spring");
  const cell = c.matrix.cells[0];
  if (!cell) throw new Error("no cells");
  const lib = await listLibrary();
  const talent = lib.find((i) => i.id === cell.talentTakeId);
  const hands = lib.find((i) => i.id === cell.handsId);
  if (!talent || !hands) throw new Error("missing lib");
  const tokens = await getTokens(cell.designTokenPackId);
  const outDir = path.join(
    process.cwd(),
    "../../data/campaigns/demo_spring/outputs",
  );
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${cell.cellId}.mp4`);
  console.log("Rendering", cell.cellId, "→", out);
  await renderAd({
    props: {
      talentVideoSrc: libraryAbsolutePath(talent),
      handsVideoSrc: libraryAbsolutePath(hands),
      motionToken: cell.motionToken,
      copy: cell.copy,
      designTokens: tokens,
      width: 1080,
      height: 1920,
      sizeId: "v_9x16_1080",
      aspect: "9:16",
    },
    outputPath: out,
    scale: 0.35,
  });
  console.log("OK", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
