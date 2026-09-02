"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useState } from "react";
import type {
  CampaignEvent,
  CampaignEventType,
  LiveColumnId,
} from "@attatta/shared";
import { EventCard } from "@/components/live/EventCard";
import { api } from "@/lib/api";

/** Column tag is primary; also fan related types so Hopper/Celtra stay live during Magic work. */
function eventVisibleInColumn(
  e: CampaignEvent,
  column: LiveColumnId,
): boolean {
  if (e.column === column) return true;
  const t = e.type as CampaignEventType;
  if (column === "hopper") {
    return (
      t === "magic_prepare" ||
      t === "magic_generate" ||
      t === "job_update" ||
      t === "review_decision" ||
      t === "comfy_publish" ||
      t === "system"
    );
  }
  if (column === "celtra") {
    return (
      t === "celtra_preview" ||
      t === "celtra_package" ||
      t === "magic_prepare" ||
      t === "review_decision" ||
      t === "job_update"
    );
  }
  return false;
}

type Props = {
  campaignId: string;
  column: LiveColumnId;
  events: CampaignEvent[];
  onLoadOlder: () => Promise<boolean>;
  hasMore: boolean;
  /**
   * Render inside the column’s single scroller (no nested overflow).
   * Pass the column scroll element for load-older + stick-to-bottom.
   */
  scrollParentRef?: RefObject<HTMLElement | null>;
};

export function EventFeed({
  campaignId,
  column,
  events,
  onLoadOlder,
  hasMore,
  scrollParentRef,
}: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const filtered = events.filter((e) => eventVisibleInColumn(e, column));
  const loadingRef = useRef(false);

  const getScroller = useCallback(() => {
    return scrollParentRef?.current ?? localRef.current;
  }, [scrollParentRef]);

  const tryLoadOlder = useCallback(() => {
    const el = getScroller();
    if (!el || loadingRef.current || !hasMore) return;
    if (el.scrollTop >= 80) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    const prevHeight = el.scrollHeight;
    void onLoadOlder()
      .then(() => {
        requestAnimationFrame(() => {
          const scroller = getScroller();
          if (scroller) {
            scroller.scrollTop = scroller.scrollHeight - prevHeight;
          }
        });
      })
      .finally(() => {
        loadingRef.current = false;
        setLoadingOlder(false);
      });
  }, [getScroller, hasMore, onLoadOlder]);

  useEffect(() => {
    const el = getScroller();
    if (!el) return;
    const onScroll = () => tryLoadOlder();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [getScroller, tryLoadOlder, campaignId, column]);

  useEffect(() => {
    const el = getScroller();
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, campaignId, column, getScroller]);

  return (
    <div
      ref={scrollParentRef ? undefined : localRef}
      className={
        scrollParentRef
          ? "space-y-2 px-3 py-2"
          : "min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
      }
    >
      <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
        Activity
      </h3>
      {hasMore || loadingOlder ? (
        <p className="text-center text-[10px] text-ink-500">
          {loadingOlder ? "Loading…" : "Scroll up for older"}
        </p>
      ) : null}
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-500">
          No events yet — actions in this column will appear here.
        </p>
      ) : (
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
    let pollTimer: number | undefined;
    seen.current = new Set();
    setEvents([]);
    setConnected(false);

    function ingest(list: CampaignEvent[]) {
      if (cancelled || !list.length) return;
      const fresh: CampaignEvent[] = [];
      for (const e of list) {
        if (seen.current.has(e.id)) continue;
        seen.current.add(e.id);
        fresh.push(e);
      }
      if (!fresh.length) return;
      setEvents((prev) => [...fresh, ...prev].slice(0, 500));
    }

    void api
      .listCampaignEvents(campaignId, { limit: 40 })
      .then((page) => {
        if (cancelled) return;
        for (const e of page.events) seen.current.add(e.id);
        setEvents(page.events);
        setHasMore(page.hasMore);
      })
      .catch(() => undefined);

    const es = new EventSource(api.campaignEventsStreamUrl(campaignId));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as CampaignEvent;
        ingest([ev]);
        setConnected(true);
      } catch {
        /* ignore */
      }
    };

    const poll = () => {
      if (cancelled) return;
      void api
        .listCampaignEvents(campaignId, { limit: 20 })
        .then((page) => {
          if (cancelled) return;
          ingest(page.events);
        })
        .catch(() => undefined);
    };
    pollTimer = window.setInterval(poll, 2500);

    return () => {
      cancelled = true;
      es.close();
      if (pollTimer) window.clearInterval(pollTimer);
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
