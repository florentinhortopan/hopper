import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type { RemotionProps } from "@attatta/shared";
import { PATHS, PUBLIC_BASE, REPO_ROOT } from "./config.js";

let bundleLocation: string | null = null;

/** Drop cached webpack bundle (call after template changes in long-lived processes). */
export function invalidateRemotionBundle() {
  bundleLocation = null;
}

async function getBundle() {
  if (bundleLocation) return bundleLocation;
  const entry = path.join(
    REPO_ROOT,
    "packages/remotion-template/src/entry.ts",
  );
  bundleLocation = await bundle({
    entryPoint: entry,
    // Still attach data/ for any relative staticFile usage; library plates
    // are served live via PUBLIC_BASE (see toPublicMediaSrc) so new uploads
    // are not trapped in a stale webpack publicDir snapshot.
    publicDir: PATHS.data,
    webpackOverride: (config) => config,
  });
  return bundleLocation;
}

/**
 * Remotion downloads media from a URL. Prefer the orchestrator /files endpoint
 * so plates uploaded after the first bundle still resolve (webpack publicDir
 * is snapshotted once and would 404 new library files on :3004).
 */
export function toPublicMediaSrc(absoluteOrRelative: string): string {
  if (!absoluteOrRelative) return "";
  if (absoluteOrRelative.startsWith("http")) return absoluteOrRelative;
  const abs = path.isAbsolute(absoluteOrRelative)
    ? absoluteOrRelative
    : path.join(PATHS.data, absoluteOrRelative);
  const underData =
    abs === PATHS.data || abs.startsWith(`${PATHS.data}${path.sep}`);
  if (underData) {
    return `${PUBLIC_BASE}/files?path=${encodeURIComponent(abs)}`;
  }
  return absoluteOrRelative;
}

export async function renderAd(opts: {
  props: RemotionProps;
  outputPath: string;
  scale?: number;
  /** Remotion frame progress 0–1 (real API signal). */
  onProgress?: (progress: number, detail: string) => void;
  /** AbortSignal → Remotion cancelSignal */
  signal?: AbortSignal;
}) {
  const serveUrl = await getBundle();
  // Prefer real library / Comfy plates under data/ (publicDir). Empty src → labeled fallback.
  const inputProps: RemotionProps = {
    ...opts.props,
    talentVideoSrc: toPublicMediaSrc(opts.props.talentVideoSrc),
    handsVideoSrc: toPublicMediaSrc(opts.props.handsVideoSrc),
  };

  const composition = await selectComposition({
    serveUrl,
    id: "paid-social-9x16-v1",
    inputProps,
  });

  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  if (opts.signal?.aborted) cancel();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  let lastEmit = 0;
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: opts.outputPath,
      inputProps,
      scale: opts.scale ?? 1,
      overwrite: true,
      cancelSignal,
      // Library plates download over HTTP; leave headroom for first fetch
      timeoutInMilliseconds: 120_000,
      onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
        if (!opts.onProgress) return;
        const now = Date.now();
        // Throttle UI writes — Remotion fires per frame
        if (progress < 1 && now - lastEmit < 400) return;
        lastEmit = now;
        const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
        opts.onProgress(
          Math.min(1, Math.max(0, progress)),
          `Remotion ${stitchStage} · ${pct}% (${renderedFrames}r/${encodedFrames}e)`,
        );
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.signal?.aborted || /cancel/i.test(msg)) {
      const e = new Error("Remotion render cancelled");
      e.name = "JobCancelledError";
      throw e;
    }
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  return opts.outputPath;
}

export function remotionEntryPath() {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../packages/remotion-template/src/entry.ts",
  );
}
