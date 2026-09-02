"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignEvent, LiveColumnId } from "@attatta/shared";
import { EventCard } from "@/components/live/EventCard";
import { api } from "@/lib/api";

type Props = {
  campaignId: string;
  column: LiveColumnId;
  events: CampaignEvent[];
  onLoadOlder: () => Promise<boolean>;
  hasMore: boolean;
};

export function EventFeed({
  campaignId,
  column,
  events,
  onLoadOlder,
  hasMore,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const filtered = events.filter((e) => e.column === column);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || loadingOlder || !hasMore) return;
    // Feed is newest at bottom; load older when near top
    if (el.scrollTop < 80) {
      setLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      void onLoadOlder()
        .then(() => {
          requestAnimationFrame(() => {
            if (scrollerRef.current) {
              scrollerRef.current.scrollTop =
                scrollerRef.current.scrollHeight - prevHeight;
            }
          });
        })
        .finally(() => setLoadingOlder(false));
    }
  }, [hasMore, loadingOlder, onLoadOlder]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Stick to bottom on new events when already near bottom
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, campaignId, column]);

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
    >
      {hasMore || loadingOlder ? (
        <p className="text-center text-[10px] text-ink-500">
          {loadingOlder ? "Loading…" : "Scroll up for older"}
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-500">
          No events yet — actions in this column will appear here.
        </p>
      ) : (
        // Chronological: oldest first in the list (events array is newest-first)
        [...filtered].reverse().map((ev) => (
          <EventCard key={ev.id} event={ev} />
        ))
      )}
    </div>
  );
}

export function useCampaignEventStream(
  campaignId: string | null,
): {
  events: CampaignEvent[];
  hasMore: boolean;
  loadOlder: () => Promise<boolean>;
  connected: boolean;
  prependBootstrap: (ev: CampaignEvent) => void;
} {
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    seen.current = new Set();
    setEvents([]);

    void api
      .listCampaignEvents(campaignId, { limit: 40 })
      .then((page) => {
        if (cancelled) return;
        for (const e of page.events) seen.current.add(e.id);
        setEvents(page.events);
        setHasMore(page.hasMore);
      })
      .catch(() => undefined);

    const newestId = () => {
      /* after = last received id for replay — use oldest of current? stream uses after as last-event */
      return "";
    };
    void newestId;

    const es = new EventSource(api.campaignEventsStreamUrl(campaignId));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as CampaignEvent;
        if (seen.current.has(ev.id)) return;
        seen.current.add(ev.id);
        setEvents((prev) => [ev, ...prev].slice(0, 500));
      } catch {
        /* ignore */
      }
    };

    return () => {
      cancelled = true;
      es.close();
      setConnected(false);
    };
  }, [campaignId]);

  async function loadOlder() {
    if (!campaignId || !events.length) return false;
    const oldest = events[events.length - 1];
    if (!oldest) return false;
    const page = await api.listCampaignEvents(campaignId, {
      before: oldest.id,
      limit: 30,
    });
    const fresh = page.events.filter((e) => !seen.current.has(e.id));
    for (const e of fresh) seen.current.add(e.id);
    if (fresh.length) {
      setEvents((prev) => [...prev, ...fresh]);
    }
    setHasMore(page.hasMore);
    return page.hasMore;
  }

  function prependBootstrap(ev: CampaignEvent) {
    if (seen.current.has(ev.id)) return;
    seen.current.add(ev.id);
    setEvents((prev) => [ev, ...prev]);
  }

  return { events, hasMore, loadOlder, connected, prependBootstrap };
}
