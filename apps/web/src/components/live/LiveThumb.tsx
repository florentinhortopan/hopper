"use client";

import { useEffect, useState } from "react";
import type { LibraryItem, MatrixCell } from "@attatta/shared";
import { isPlateReady } from "@/lib/plateStatus";
import { api } from "@/lib/api";

function looksLikeImage(src: string) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(src);
}

/** Media path for one size slot (Comfy plate, then assemble masters). */
export function sizeAssetMediaPath(
  cell: MatrixCell | undefined | null,
  sizeId: string | null | undefined,
): string | null {
  if (!cell || !sizeId) return null;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  return (
    asset?.genPath?.trim() ||
    asset?.outputPath?.trim() ||
    asset?.previewPath?.trim() ||
    null
  );
}

/** Cache-bust token so thumbs refresh after re-gen (same path, new bytes). */
export function sizeAssetMediaRev(
  cell: MatrixCell | undefined | null,
  sizeId: string | null | undefined,
): string | null {
  if (!cell || !sizeId) return null;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  if (!asset) return null;
  return (
    asset.promptHash?.trim() ||
    asset.genPath?.trim() ||
    asset.outputPath?.trim() ||
    asset.previewPath?.trim() ||
    null
  );
}

/** Prefer first size with media; optional preferred sizeId. */
export function cellMediaPath(
  cell: MatrixCell | undefined | null,
  preferredSizeId?: string | null,
): string | null {
  if (!cell) return null;
  if (preferredSizeId) {
    const hit = sizeAssetMediaPath(cell, preferredSizeId);
    if (hit) return hit;
  }
  const asset =
    cell.sizeAssets?.find((a) => a.genPath?.trim()) ||
    cell.sizeAssets?.find((a) => a.outputPath?.trim() || a.previewPath?.trim()) ||
    cell.sizeAssets?.[0];
  return (
    asset?.genPath?.trim() ||
    asset?.outputPath?.trim() ||
    asset?.previewPath?.trim() ||
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
    const hit = sizeAssetMediaRev(cell, preferredSizeId);
    if (hit) return hit;
  }
  const asset =
    cell.sizeAssets?.find((a) => a.genPath?.trim()) ||
    cell.sizeAssets?.find((a) => a.outputPath?.trim() || a.previewPath?.trim()) ||
    cell.sizeAssets?.[0];
  return (
    asset?.promptHash?.trim() ||
    asset?.genPath?.trim() ||
    asset?.outputPath?.trim() ||
    asset?.previewPath?.trim() ||
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
  /** Open expanded viewer immediately (e.g. size chip tap). */
  startExpanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
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
  startExpanded = false,
  onExpandedChange,
}: Props) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (startExpanded) setExpanded(true);
  }, [startExpanded]);

  useEffect(() => {
    setFrameReady(false);
  }, [filePath, rev, libraryItem?.id, libraryItem?.path, libraryItem?.status]);

  function openExpanded() {
    setExpanded(true);
    onExpandedChange?.(true);
  }

  function closeExpanded() {
    setExpanded(false);
    onExpandedChange?.(false);
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

  const box =
    size === "sm"
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
            className="h-full w-full object-cover"
            onLoad={() => setFrameReady(true)}
          />
        ) : (
          <video
            key={mediaUrl}
            src={mediaUrl}
            className={`h-full w-full object-cover transition-opacity ${
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
      {expanded ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeExpanded}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-hidden rounded-2xl bg-ink-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 z-10 rounded bg-black/50 px-2 py-1 text-xs text-white"
              onClick={closeExpanded}
            >
              Close
            </button>
            {label ? (
              <p className="border-b border-white/10 px-3 py-2 text-xs text-warm-paper">
                {label}
              </p>
            ) : null}
            {copyOnly && libraryItem ? (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 text-sm text-warm-paper">
                {[
                  libraryItem.copy?.setup,
                  libraryItem.copy?.punchline,
                  libraryItem.copy?.endcard,
                ]
                  .filter(Boolean)
                  .join("\n\n")}
              </pre>
            ) : image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={label || ""}
                className="max-h-[80vh] w-full object-contain"
              />
            ) : (
              <video
                src={url!}
                className="max-h-[80vh] w-full object-contain"
                controls
                autoPlay
                playsInline
                preload="auto"
              />
            )}
            {url && !copyOnly ? (
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
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
