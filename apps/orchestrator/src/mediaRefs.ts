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

function even(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

/**
 * Center-crop a video into exact WxH (full-bleed, no letterbox).
 * Used so MiniMax/Bria R2V follow the target delivery aspect instead of the
 * raw talent take (often 9:16) when generating 4:5 / 1:1 / 16:9 plates.
 */
export async function fitVideoToSize(
  absMediaPath: string,
  width: number,
  height: number,
  cacheKey: string,
): Promise<string> {
  if (!(await exists(absMediaPath))) {
    throw new Error(`fitVideoToSize: missing source ${absMediaPath}`);
  }
  const w = even(width);
  const h = even(height);
  const outDir = path.join(PATHS.library, "gen", "_refs");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${cacheKey}_${w}x${h}.mp4`);
  if (await exists(outPath)) return outPath;

  // Cover-scale then center-crop — matches full-bleed gen framing (no black bars).
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
  const res = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      absMediaPath,
      "-vf",
      vf,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  if (res.status === 0 && (await exists(outPath))) return outPath;
  const err = String(res.stderr || res.stdout || `exit ${res.status}`).slice(0, 800);
  throw new Error(
    `fitVideoToSize ${w}×${h} failed for ${path.basename(absMediaPath)}: ${err}`,
  );
}

/** True when media aspect is within tol of target W/H. */
export function mediaAspectMatches(
  dims: { w: number; h: number },
  width: number,
  height: number,
  tol = 0.12,
): boolean {
  const actualR = dims.w / dims.h;
  const targetR = width / height;
  return Math.abs(actualR - targetR) / targetR <= tol;
}
