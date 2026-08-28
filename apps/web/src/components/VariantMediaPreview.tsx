"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

function looksLikeImage(path: string) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(path);
}

/**
 * Compact media preview for Comfy/variant plates — native video controls
 * (play, scrub, fullscreen) plus download / open, matching Variant review.
 */
export function VariantMediaPreview({
  path,
  label,
  compact,
}: {
  /** Absolute path served via /files */
  path: string;
  label?: string;
  /** Tighter thumb for list rows */
  compact?: boolean;
}) {
  const url = api.fileUrl(path);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expanded, setExpanded] = useState(false);
  const image = looksLikeImage(path);

  async function toggleFullscreen() {
    const el = videoRef.current;
    if (!el) {
      setExpanded(true);
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        setExpanded(true);
      }
    } catch {
      setExpanded(true);
    }
  }

  const frame = (
    <div
      className={`overflow-hidden rounded-lg bg-ink-900 ${
        compact ? "w-16 shrink-0" : "w-full max-w-[200px]"
      }`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label || "Plate"}
          className={
            compact
              ? "aspect-[9/16] h-24 w-full object-cover"
              : "aspect-[9/16] max-h-56 w-full object-cover"
          }
          onClick={() => setExpanded(true)}
        />
      ) : (
        <video
          ref={videoRef}
          key={url}
          src={url}
          className={
            compact
              ? "aspect-[9/16] h-24 w-full object-cover"
              : "aspect-[9/16] max-h-56 w-full object-cover"
          }
          controls={!compact}
          muted
          playsInline
          preload="metadata"
          onMouseEnter={(e) => {
            if (compact) void e.currentTarget.play().catch(() => undefined);
          }}
          onMouseLeave={(e) => {
            if (compact) {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }
          }}
          onClick={
            compact
              ? () => setExpanded(true)
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-2 py-1 text-[10px]">
        <a
          className="text-warm-paper/90 underline hover:text-white"
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
        >
          Download
        </a>
        <a
          className="text-warm-paper/90 underline hover:text-white"
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </a>
        {!image ? (
          <button
            type="button"
            className="text-warm-paper/90 underline hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              void toggleFullscreen();
            }}
          >
            Fullscreen
          </button>
        ) : (
          <button
            type="button"
            className="text-warm-paper/90 underline hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            Expand
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {frame}
      {expanded ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-ink-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 z-10 rounded bg-black/50 px-2 py-1 text-xs text-white underline"
              onClick={() => setExpanded(false)}
            >
              Close
            </button>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={label || "Plate"}
                className="max-h-[90vh] w-full object-contain"
              />
            ) : (
              <video
                src={url}
                className="max-h-[90vh] w-full object-contain"
                controls
                autoPlay
                playsInline
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
      ) : null}
    </>
  );
}
