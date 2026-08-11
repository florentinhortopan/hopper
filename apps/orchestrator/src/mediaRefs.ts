import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PATHS } from "./config.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a library media path to a still PNG for Comfy upload.
 * Videos → first-frame extract; images → convert/copy to PNG.
 */
export async function resolveStillPng(
  absMediaPath: string,
  cacheKey: string,
): Promise<string | null> {
  if (!(await exists(absMediaPath))) return null;

  const ext = path.extname(absMediaPath).toLowerCase();
  const outDir = path.join(PATHS.library, "gen", "_refs");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${cacheKey}.png`);

  if (await exists(outPath)) {
    // Reuse extracted still if source hasn't changed (mtime encoded in key when hashing)
    return outPath;
  }

  if (IMAGE_EXT.has(ext)) {
    if (ext === ".png") {
      const buf = await readFile(absMediaPath);
      await writeFile(outPath, buf);
      return outPath;
    }
    const res = spawnSync(
      "ffmpeg",
      ["-y", "-i", absMediaPath, "-frames:v", "1", outPath],
      { stdio: "pipe" },
    );
    if (res.status === 0 && (await exists(outPath))) return outPath;
    return null;
  }

  // Video / other: grab an early frame (0.3s avoids black opens)
  const res = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "0.3",
      "-i",
      absMediaPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outPath,
    ],
    { stdio: "pipe" },
  );
  if (res.status === 0 && (await exists(outPath))) return outPath;

  // Retry at frame 0
  const retry = spawnSync(
    "ffmpeg",
    ["-y", "-i", absMediaPath, "-frames:v", "1", outPath],
    { stdio: "pipe" },
  );
  if (retry.status === 0 && (await exists(outPath))) return outPath;
  return null;
}

export function stillCacheKey(kind: string, id: string, absPath: string): string {
  const h = createHash("sha256").update(`${kind}:${id}:${absPath}`).digest("hex").slice(0, 16);
  return `${kind}_${id}_${h}`;
}
