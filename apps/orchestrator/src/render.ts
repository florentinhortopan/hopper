import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type { RemotionProps } from "@attatta/shared";
import { PATHS, PORT, REPO_ROOT } from "./config.js";
import { h264SafeScaledRender } from "./h264Scale.js";

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
    // are served live via loopback /files (see toPublicMediaSrc) so new uploads
    // are not trapped in a stale webpack publicDir snapshot.
    publicDir: PATHS.data,
    // Avoid flaky webpack pack_ rename ENOENT on Railway ephemeral disks.
    enableCaching: false,
    webpackOverride: (config) => config,
  });
  return bundleLocation;
}

/**
 * Remotion loads media over HTTP (no raw filesystem / file:// paths).
 * Serve plates via the orchestrator /files endpoint on loopback so assemble
 * does not depend on PUBLIC_BASE (a host without https:// becomes a relative
 * URL under Remotion's webpack server and 404s).
 */
export function toPublicMediaSrc(absoluteOrRelative: string): string {
  if (!absoluteOrRelative) return "";
  if (/^https?:\/\//i.test(absoluteOrRelative)) return absoluteOrRelative;
  const abs = path.isAbsolute(absoluteOrRelative)
    ? absoluteOrRelative
    : path.join(PATHS.data, absoluteOrRelative);
  const underData =
    abs === PATHS.data || abs.startsWith(`${PATHS.data}${path.sep}`);
  if (underData) {
    return `http://127.0.0.1:${PORT}/files?path=${encodeURIComponent(abs)}`;
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
  // H264 needs even W/H after Remotion scale (4:5 1080×1350 @ 0.5 → 675 odd).
  const safe = h264SafeScaledRender(
    opts.props.width,
    opts.props.height,
    opts.scale ?? 1,
  );
  const inputProps: RemotionProps = {
    ...opts.props,
    width: safe.width,
    height: safe.height,
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
      scale: safe.scale,
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
