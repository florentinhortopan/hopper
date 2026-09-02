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
 * Media path for one size slot — same rules as Variants advanced preview:
 * only that size's gen → output → preview. Never fall back to another size
 * or cell.outputPath (that forced every chip to the original plate).
 */
export function sizeAssetMediaPath(
  cell: MatrixCell | undefined | null,
  sizeId: string | null | undefined,
): string | null {
  if (!cell || !sizeId) return null;
  const asset = cell.sizeAssets?.find((a) => a.sizeId === sizeId);
  if (!asset) return null;
  const own =
    asset.genPath?.trim() ||
    asset.outputPath?.trim() ||
    asset.previewPath?.trim() ||
    null;
  if (!own) return null;
  // Inherited cross-aspect clone of another size's plate → treat as missing
  if (isSharedWrongAspectPath(cell, sizeId, own)) return null;
  return own;
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

function aspectRatioNumber(aspect?: string | null, width?: number, height?: number): number | null {
  if (width && height && height > 0) return width / height;
  if (!aspect?.includes(":")) return null;
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return null;
  return w / h;
}

function ratiosMatch(a: number, b: number, tol = 0.12): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= tol;
}

/** Size gallery lightbox — arrow keys + chevrons cycle delivery sizes. */
export function MediaLightbox({
  state,
  items,
  onClose,
  onSelect,
}: {
  state: MediaLightboxState;
  /** All sizes for this variant (with media). Enables ←/→ and chevrons. */
  items?: MediaLightboxState[];
  onClose: () => void;
  onSelect?: (next: MediaLightboxState) => void;
}) {
  const gallery = items?.length ? items : [state];
  const index = Math.max(
    0,
    gallery.findIndex(
      (it) =>
        (state.sizeId && it.sizeId === state.sizeId) ||
        it.path === state.path,
    ),
  );
  const current = gallery[index] || state;
  const cacheKey =
    current.rev ??
    `${current.sizeId || current.label}:${current.path}:${current.aspect || ""}`;
  const url = api.fileUrl(current.path, cacheKey);
  const image = looksLikeImage(current.path);
  const claimed =
    current.aspect || current.width
      ? [current.aspect, current.width && current.height ? `${current.width}×${current.height}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;
  const [nativeDims, setNativeDims] = useState<string | null>(null);
  const [aspectMismatch, setAspectMismatch] = useState(false);

  useEffect(() => {
    setNativeDims(null);
    setAspectMismatch(false);
  }, [current.path, current.sizeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!onSelect || gallery.length < 2) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = gallery[(index - 1 + gallery.length) % gallery.length]!;
        onSelect(next);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = gallery[(index + 1) % gallery.length]!;
        onSelect(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelect, gallery, index]);

  function noteNativeSize(w: number, h: number) {
    if (!w || !h) return;
    setNativeDims(`${w}×${h}`);
    const claimedR = aspectRatioNumber(current.aspect, current.width, current.height);
    if (claimedR != null && !ratiosMatch(w / h, claimedR)) {
      setAspectMismatch(true);
    }
  }

  const frameStyle =
    current.width && current.height
      ? { aspectRatio: `${current.width} / ${current.height}`, maxHeight: "70vh" }
      : current.aspect?.includes(":")
        ? {
            aspectRatio: current.aspect.replace(":", " / "),
            maxHeight: "70vh",
          }
        : { maxHeight: "70vh" };

  function go(delta: number) {
    if (!onSelect || gallery.length < 2) return;
    const next = gallery[(index + delta + gallery.length) % gallery.length]!;
    onSelect(next);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/85 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {gallery.length > 1 ? (
        <button
          type="button"
          className="absolute left-3 top-1/2 z-[81] -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-lg text-white hover:bg-black/80"
          aria-label="Previous size"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
        >
          ‹
        </button>
      ) : null}
      {gallery.length > 1 ? (
        <button
          type="button"
          className="absolute right-3 top-1/2 z-[81] -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-lg text-white hover:bg-black/80"
          aria-label="Next size"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
        >
          ›
        </button>
      ) : null}
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
        <div className="border-b border-white/10 px-3 py-2 pr-16">
          <p className="text-xs text-warm-paper">{current.label}</p>
          {claimed ? (
            <p className="font-mono text-[10px] text-warm-paper/70">{claimed}</p>
          ) : null}
          <p className="truncate font-mono text-[9px] text-warm-paper/50">
            {current.path.split("/").pop()}
            {nativeDims ? ` · native ${nativeDims}` : ""}
          </p>
          {gallery.length > 1 ? (
            <p className="mt-0.5 text-[9px] text-warm-paper/50">
              Size {index + 1}/{gallery.length} · ← → or chevrons
            </p>
          ) : null}
          {aspectMismatch ? (
            <p className="mt-1 rounded bg-amber-500/20 px-2 py-1 text-[10px] text-amber-100">
              Plate pixels do not match {current.aspect}. Regenerate this size for a
              true native frame (preview below is delivery-cropped like Variants).
            </p>
          ) : null}
        </div>
        <div className="mx-auto w-full max-w-xl bg-ink-900" style={frameStyle}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={cacheKey}
              src={url}
              alt={current.label}
              className="h-full w-full object-cover"
              onLoad={(e) =>
                noteNativeSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
              }
            />
          ) : (
            <video
              key={cacheKey}
              src={url}
              className="h-full w-full object-cover"
              controls
              autoPlay
              playsInline
              preload="auto"
              onLoadedMetadata={(e) =>
                noteNativeSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
              }
            />
          )}
        </div>
        {gallery.length > 1 ? (
          <div className="flex flex-wrap justify-center gap-1 border-t border-white/10 px-3 py-2">
            {gallery.map((it, i) => (
              <button
                key={it.sizeId || it.path}
                type="button"
                className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                  i === index
                    ? "bg-white text-ink-900"
                    : "bg-white/10 text-warm-paper hover:bg-white/20"
                }`}
                onClick={() => onSelect?.(it)}
              >
                {it.aspect || it.label}
              </button>
            ))}
          </div>
        ) : null}
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

/** Match Variants advanced preview bay framing. */
export function sizeAspectClass(aspect: string | null | undefined): string {
  if (aspect === "16:9") return "aspect-video w-full max-w-md";
  if (aspect === "1:1") return "aspect-square w-full max-w-[11rem]";
  if (aspect === "4:5") return "aspect-[4/5] w-full max-w-[10rem]";
  if (aspect === "4:3") return "aspect-[4/3] w-full max-w-sm";
  return "aspect-[9/16] w-full max-w-[9rem]";
}

type SizeMediaProps = {
  path: string | null | undefined;
  rev?: string | null;
  aspect?: string | null;
  label: string;
  className?: string;
  /** Larger bay (selected detail) vs chip thumb */
  bay?: boolean;
  onOpen?: () => void;
};

/**
 * Size-accurate plate preview — same approach as Variants advanced:
 * aspect frame + object-cover + remount key on path/size.
 * Hover overlay: Download / Open (library-style).
 */
export function SizeMediaFrame({
  path,
  rev,
  aspect,
  label,
  className = "",
  bay = false,
  onOpen,
}: SizeMediaProps) {
  const trimmed = path?.trim() || null;
  const url = trimmed
    ? api.fileUrl(trimmed, rev ?? `${label}:${trimmed}`)
    : null;
  const image = trimmed ? looksLikeImage(trimmed) : false;
  const mediaUrl = url ? (image ? url : videoThumbSrc(url)) : null;
  const frame = bay
    ? sizeAspectClass(aspect)
    : "h-full w-full";
  const style =
    !bay && aspect
      ? { aspectRatio: cssAspect(aspect) || undefined }
      : undefined;

  if (!mediaUrl || !url) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-dashed border-ink-200 bg-ink-50 text-[9px] text-ink-400 ${
          bay ? frame : "h-9 w-7"
        } ${className}`}
        style={style}
        title={label}
      >
        —
      </div>
    );
  }

  const media = image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={mediaUrl}
      src={mediaUrl}
      alt={label}
      className="h-full w-full object-cover"
    />
  ) : (
    <video
      key={mediaUrl}
      src={mediaUrl}
      className="h-full w-full object-cover"
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(e) => {
        try {
          if (e.currentTarget.currentTime < 0.05) e.currentTarget.currentTime = 0.1;
        } catch {
          /* ignore */
        }
      }}
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
  );

  return (
    <div
      className={`group relative overflow-hidden rounded border border-ink-200 bg-ink-900 ${
        bay ? frame : ""
      } ${className}`}
      style={style}
      title={label}
    >
      <div
        className={`h-full w-full ${onOpen ? "cursor-zoom-in" : ""}`}
        onClick={onOpen}
        onKeyDown={
          onOpen
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen();
                }
              }
            : undefined
        }
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
        {media}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] flex translate-y-full items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[9px] text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
        <a
          className="pointer-events-auto underline hover:text-warm-paper"
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
        >
          Download
        </a>
        <a
          className="pointer-events-auto underline hover:text-warm-paper"
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </a>
        {onOpen ? (
          <button
            type="button"
            className="pointer-events-auto underline hover:text-warm-paper"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            Expand
          </button>
        ) : null}
      </div>
    </div>
  );
}
