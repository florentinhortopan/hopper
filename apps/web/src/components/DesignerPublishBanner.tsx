"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ComfyPublishEvent } from "@/lib/api";

type Props = {
  /** Scope recent publishes to this campaign (activated ones) */
  campaignId?: string | null;
  libraryId?: string | null;
  /** Called when a new publish arrives so the page can refresh lists */
  onPublish?: (event: ComfyPublishEvent) => void;
  className?: string;
};

/**
 * Polls designer Comfy → SCOTTY publishes and surfaces a banner for
 * Advanced Ingredients and Magic.
 */
export function DesignerPublishBanner({
  campaignId,
  libraryId,
  onPublish,
  className = "",
}: Props) {
  const [latest, setLatest] = useState<ComfyPublishEvent | null>(null);
  const sinceRef = useRef<string>(new Date().toISOString());
  const seenRef = useRef<Set<string>>(new Set());
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const events = await api.recentComfyPublishes({
          since: sinceRef.current,
          campaignId: campaignId || undefined,
          libraryId: libraryId || undefined,
          limit: 5,
        });
        if (cancelled || !events.length) return;
        for (const ev of [...events].reverse()) {
          if (seenRef.current.has(ev.id)) continue;
          seenRef.current.add(ev.id);
          setLatest(ev);
          onPublishRef.current?.(ev);
        }
        sinceRef.current = events[0]!.at;
      } catch {
        /* ignore transient */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [campaignId, libraryId]);

  if (!latest) return null;

  return (
    <div
      className={`rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 ${className}`}
      role="status"
    >
      <p className="font-medium">
        Designer published {latest.kind}: {latest.label}
      </p>
      <p className="mt-0.5 text-xs opacity-80">
        {latest.activated
          ? "Activated on this campaign — available in Advanced Ingredients and Magic."
          : "Added to the library pack — activate on Ingredients (or re-publish with campaign id)."}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => setLatest(null)}
        >
          Dismiss
        </button>
      </p>
    </div>
  );
}
