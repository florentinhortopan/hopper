"use client";

import { useState } from "react";
import type { LibraryItem, MatrixCell } from "@attatta/shared";
import { isPlateReady } from "@/lib/plateStatus";
import { api } from "@/lib/api";

function looksLikeImage(src: string) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(src);
}

/** Prefer Comfy plate, then assemble masters. */
export function cellMediaPath(cell: MatrixCell | undefined | null): string | null {
  if (!cell) return null;
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

type Size = "sm" | "md";

type Props = {
  label?: string;
  size?: Size;
  /** Absolute disk path → /files */
  filePath?: string | null;
  /** Library ingredient → /library/media/:id */
  libraryItem?: LibraryItem | null;
  emptyHint?: string;
  className?: string;
};

/**
 * Expandable thumbnail for live workspace lists (ingredients, plates, matrix).
 */
export function LiveThumb({
  label,
  size = "sm",
  filePath,
  libraryItem,
  emptyHint = "—",
  className = "",
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const libraryReady = libraryItem ? isPlateReady(libraryItem) : false;
  const copyOnly =
    libraryItem?.kind === "copy" || libraryItem?.mediaType === "json";

  let url: string | null = null;
  let image = false;

  if (filePath?.trim()) {
    url = api.fileUrl(filePath.trim());
    image = looksLikeImage(filePath);
  } else if (libraryItem && libraryReady && !copyOnly && libraryItem.path) {
    url = api.libraryMediaUrl(
      libraryItem.id,
      `${libraryItem.path}:${libraryItem.status}`,
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
        onClick={() => setExpanded(true)}
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

  return (
    <>
      <button
        type="button"
        className={`shrink-0 overflow-hidden rounded border border-ink-200 bg-ink-900 ${box} ${className}`}
        title={label ? `${label} — expand` : "Expand preview"}
        onClick={() => setExpanded(true)}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label || ""} className="h-full w-full object-cover" />
        ) : (
          <video
            src={url}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => {
              void e.currentTarget.play().catch(() => undefined);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        )}
      </button>
      {expanded ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-hidden rounded-2xl bg-ink-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 z-10 rounded bg-black/50 px-2 py-1 text-xs text-white"
              onClick={() => setExpanded(false)}
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
