"use client";

import { useEffect, useRef, type RefObject } from "react";

type Props = {
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Content / data version — scroll when this changes if pinned. */
  contentKey: string | number;
  /** When this changes, force pin + scroll (e.g. generate started). */
  forceKey?: string | number | null;
  thresholdPx?: number;
  /**
   * Optional element id inside the scroller. When present, pin to that
   * anchor (e.g. active queue band) instead of the absolute bottom —
   * keeps “next to finish” in view instead of a pile of DONE rows.
   */
  anchorId?: string | null;
};

/**
 * Keep a column scroller pinned to the latest content (queue progress, new rows).
 * Stops following if the user scrolls up; resumes when they return near the bottom.
 */
export function ColumnStickScroll({
  scrollerRef,
  contentKey,
  forceKey = null,
  thresholdPx = 96,
  anchorId = null,
}: Props) {
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedRef.current = distance < thresholdPx;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollerRef, thresholdPx]);

  function scrollPinned() {
    const el = scrollerRef.current;
    if (!el || !pinnedRef.current) return;
    const anchor =
      anchorId && typeof document !== "undefined"
        ? document.getElementById(anchorId)
        : null;
    if (anchor && el.contains(anchor)) {
      // Keep anchor near the lower third of the viewport (active work).
      const target =
        anchor.offsetTop - Math.max(48, Math.floor(el.clientHeight * 0.55));
      el.scrollTop = Math.max(0, target);
      return;
    }
    el.scrollTop = el.scrollHeight;
  }

  useEffect(() => {
    if (forceKey == null || forceKey === "") return;
    pinnedRef.current = true;
    const id = window.requestAnimationFrame(() => scrollPinned());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pin on forceKey only
  }, [forceKey, scrollerRef, anchorId]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => scrollPinned());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, scrollerRef, anchorId]);

  return null;
}
