import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4" || ext === ".mov" || ext === ".webm") return "video/mp4";
  return "application/octet-stream";
}

/**
 * Stream a local file with Content-Length + HTTP Range (206).
 * Remotion `<Video>` requires seekable media — plain pipe without Range hangs delayRender.
 */
export async function sendMediaFile(
  req: Request,
  res: Response,
  filePath: string,
): Promise<void> {
  const st = await stat(filePath);
  const size = st.size;
  const type = contentTypeForPath(filePath);

  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", String(size));
    createReadStream(filePath).pipe(res);
    return;
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    return;
  }

  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    return;
  }
  end = Math.min(end, size - 1);
  const chunk = end - start + 1;

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", String(chunk));
  createReadStream(filePath, { start, end }).pipe(res);
}
