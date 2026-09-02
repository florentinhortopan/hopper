"use client";

import { useEffect, useState } from "react";
import type { LibraryItem, MatrixCell } from "@attatta/shared";
import { isPlateReady } from "@/lib/plateStatus";
import { api } from "@/lib/api";

function looksLikeImage(src: string) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(src);
}

/** True when another size with a different aspect owns the same plate path. */
function isSharedWrongAspectPath(
  cell: MatrixCell,
  sizeId: string,
  path: string,
): boolean {
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  if (!asset) return false;
  const norm = path.trim();
  if (!norm) return false;
  return (cell.sizeAssets ?? []).some((a) => {
    if (a.sizeId === sizeId) return false;
    if (a.aspect === asset.aspect) return false;
    const other =
      a.genPath?.trim() || a.outputPath?.trim() || a.previewPath?.trim() || "";
    return other === norm;
  });
}

/**
 * Media path for one size slot (Comfy plate, then assemble masters).
 * Never returns a plate that is shared with a different aspect — that made every
 * size chip open the original 9:16 (or first) file.
 */
export function sizeAssetMediaPath(
  cell: MatrixCell | undefined | null,
  sizeId: string | null | undefined,
): string | null {
  if (!cell || !sizeId) return null;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  if (!asset) return null;
  // Prefer fields in order, but skip any path shared with another aspect.
  for (const candidate of [
    asset.genPath?.trim(),
    asset.outputPath?.trim(),
    asset.previewPath?.trim(),
  ]) {
    if (!candidate) continue;
    if (isSharedWrongAspectPath(cell, sizeId, candidate)) continue;
    return candidate;
  }
  return null;
}

/** Cache-bust token so thumbs refresh after re-gen (same path, new bytes). */
export function sizeAssetMediaRev(
  cell: MatrixCell | undefined | null,
  sizeId: string | null | undefined,
): string | null {
  if (!cell || !sizeId) return null;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  if (!asset) return null;
  const path = sizeAssetMediaPath(cell, sizeId);
  if (!path) return null;
  return (
    `${sizeId}:${asset.promptHash?.trim() || path}`
  );
}

/** Prefer first size with media. When preferredSizeId is set, do NOT fall back
 * to another size — that made every size chip open the original plate. */
export function cellMediaPath(
  cell: MatrixCell | undefined | null,
  preferredSizeId?: string | null,
): string | null {
  if (!cell) return null;
  if (preferredSizeId) {
    return sizeAssetMediaPath(cell, preferredSizeId);
  }
  for (const a of cell.sizeAssets || []) {
    const path = sizeAssetMediaPath(cell, a.sizeId);
    if (path) return path;
  }
  return (
    cell.outputPath?.trim() ||
    cell.previewPath?.trim() ||
    null
  );
}

export function cellMediaRev(
  cell: MatrixCell | undefined | null,
  preferredSizeId?: string | null,
): string | null {
  if (!cell) return null;
  if (preferredSizeId) {
    return sizeAssetMediaRev(cell, preferredSizeId);
  }
  for (const a of cell.sizeAssets || []) {
    const rev = sizeAssetMediaRev(cell, a.sizeId);
    if (rev) return rev;
  }
  return (
    cell.outputPath?.trim() ||
    cell.previewPath?.trim() ||
    null
  );
}

/** Video src that paints a real frame (avoids black first-frame thumbs). */
export function videoThumbSrc(url: string): string {
  if (!url || looksLikeImage(url)) return url;
  if (url.includes("#")) return url;
  return `${url}#t=0.1`;
}

export type MediaLightboxState = {
  path: string;
  rev?: string | null;
  label: string;
  aspect?: string;
  width?: number;
  height?: number;
  sizeId?: string;
};

/** Single lightbox owned by the parent — avoids per-thumb expand showing the wrong plate. */
export function MediaLightbox({
  state,
  onClose,
}: {
  state: MediaLightboxState;
  onClose: () => void;
}) {
  const cacheKey =
    state.rev ??
    `${state.sizeId || state.label}:${state.path}:${state.aspect || ""}`;
  const url = api.fileUrl(state.path, cacheKey);
  const image = looksLikeImage(state.path);
  const dims =
    state.aspect || state.width
      ? [state.aspect, state.width && state.height ? `${state.width}×${state.height}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/85 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-ink-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-10 rounded bg-black/50 px-2 py-1 text-xs text-white"
          onClick={onClose}
        >
          Close
        </button>
        <div className="border-b border-white/10 px-3 py-2">
          <p className="text-xs text-warm-paper">{state.label}</p>
          {dims ? (
            <p className="font-mono text-[10px] text-warm-paper/70">{dims}</p>
          ) : null}
          <p className="truncate font-mono text-[9px] text-warm-paper/50">
            {state.path.split("/").pop()}
          </p>
        </div>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={cacheKey}
            src={url}
            alt={state.label}
            className="max-h-[75vh] w-full bg-ink-900 object-contain"
          />
        ) : (
          <video
            key={cacheKey}
            src={url}
            className="max-h-[75vh] w-full bg-ink-900 object-contain"
            controls
            autoPlay
            playsInline
            preload="auto"
          />
        )}
        <div className="flex gap-3 border-t border-white/10 px-3 py-2 text-xs">
          <a className="text-warm-paper underline" href={url} download>
            Download
          </a>
          <a
            className="text-warm-paper underline"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Open
          </a>
        </div>
      </div>
    </div>
  );
}

type Size = "sm" | "md";

type Props = {
  label?: string;
  size?: Size;
  /** Absolute disk path → /files */
  filePath?: string | null;
  /** Cache-bust / identity for filePath (promptHash etc.) */
  rev?: string | number | null;
  /** Library ingredient → /library/media/:id */
  libraryItem?: LibraryItem | null;
  emptyHint?: string;
  className?: string;
  /** CSS aspect-ratio for the thumb box (e.g. "1 / 1", "9 / 16"). */
  frameAspect?: string | null;
  /**
   * When set, thumb click calls this with the path currently shown —
   * parent should open MediaLightbox with that exact path (no re-resolve).
   */
  onOpenPreview?: (path: string) => void;
};

/**
 * Expandable thumbnail for live workspace lists (ingredients, plates, matrix).
 */
export function LiveThumb({
  label,
  size = "sm",
  filePath,
  rev,
  libraryItem,
  emptyHint = "—",
  className = "",
  frameAspect = null,
  onOpenPreview,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setFrameReady(false);
  }, [filePath, rev, libraryItem?.id, libraryItem?.path, libraryItem?.status]);

  function openExpanded() {
    if (onOpenPreview) {
      const path = filePath?.trim();
      if (path) onOpenPreview(path);
      return;
    }
    setExpanded(true);
  }

  const libraryReady = libraryItem ? isPlateReady(libraryItem) : false;
  const copyOnly =
    libraryItem?.kind === "copy" || libraryItem?.mediaType === "json";

  let url: string | null = null;
  let image = false;

  if (filePath?.trim()) {
    url = api.fileUrl(filePath.trim(), rev ?? filePath.trim());
    image = looksLikeImage(filePath);
  } else if (libraryItem && libraryReady && !copyOnly && libraryItem.path) {
    url = api.libraryMediaUrl(
      libraryItem.id,
      rev ?? `${libraryItem.path}:${libraryItem.status}`,
    );
    image = libraryItem.mediaType === "image" || looksLikeImage(libraryItem.path);
  }

  const box = frameAspect
    ? size === "sm"
      ? "h-12 w-auto"
      : "h-20 w-auto"
    : size === "sm"
      ? "h-12 w-9"
      : "h-20 w-14";

  if (copyOnly && libraryItem) {
    return (
      <button
        type="button"
        title={label || libraryItem.label}
        className={`shrink-0 overflow-hidden rounded border border-ink-200 bg-white px-1 py-0.5 text-left ${box} ${className}`}
        onClick={openExpanded}
      >
        <span className="line-clamp-3 text-[8px] leading-tight text-ink-700">
          {libraryItem.copy?.setup || libraryItem.label}
        </span>
      </button>
    );
  }

  if (!url) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded border border-dashed border-ink-200 bg-ink-50 text-[9px] text-ink-400 ${box} ${className}`}
        style={frameAspect ? { aspectRatio: frameAspect } : undefined}
        title={label}
      >
        {emptyHint}
      </div>
    );
  }

  const mediaUrl = image ? url : videoThumbSrc(url);

  function revealFrame(el: HTMLVideoElement) {
    try {
      if (el.currentTime < 0.05) el.currentTime = 0.1;
    } catch {
      /* ignore seek errors */
    }
    setFrameReady(true);
  }

  return (
    <>
      <button
        type="button"
        className={`relative shrink-0 overflow-hidden rounded border border-ink-200 bg-ink-100 ${box} ${className}`}
        style={frameAspect ? { aspectRatio: frameAspect } : undefined}
        title={label ? `${label} — expand` : "Expand preview"}
        onClick={(e) => {
          e.stopPropagation();
          openExpanded();
        }}
      >
        {!frameReady && !image ? (
          <span className="absolute inset-0 flex items-center justify-center text-[9px] text-ink-400">
            …
          </span>
        ) : null}
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={mediaUrl}
            src={mediaUrl}
            alt={label || ""}
            className="h-full w-full object-contain"
            onLoad={() => setFrameReady(true)}
          />
        ) : (
          <video
            key={mediaUrl}
            src={mediaUrl}
            className={`h-full w-full object-contain transition-opacity ${
              frameReady ? "opacity-100" : "opacity-0"
            }`}
            muted
            playsInline
            preload="auto"
            onLoadedData={(e) => revealFrame(e.currentTarget)}
            onLoadedMetadata={(e) => revealFrame(e.currentTarget)}
            onMouseEnter={(e) => {
              void e.currentTarget.play().catch(() => undefined);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              try {
                e.currentTarget.currentTime = 0.1;
              } catch {
                /* ignore */
              }
            }}
          />
        )}
      </button>
      {expanded && !onOpenPreview ? (
        <MediaLightbox
          state={{
            path: filePath!.trim(),
            rev: rev != null ? String(rev) : filePath!.trim(),
            label: label || "Preview",
          }}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </>
  );
}

/** "9:16" → "9 / 16" for CSS aspect-ratio. */
export function cssAspect(aspect: string | null | undefined): string | null {
  if (!aspect?.includes(":")) return null;
  const [w, h] = aspect.split(":");
  if (!w || !h) return null;
  return `${w} / ${h}`;
}
