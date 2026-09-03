"use client";

import { useEffect, useRef, type RefObject } from "react";

type Props = {
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Content / data version — scroll when this changes if pinned. */
  contentKey: string | number;
  /** When this changes, force pin + scroll (e.g. generate started). */
  forceKey?: string | number | null;
  thresholdPx?: number;
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

  useEffect(() => {
    if (forceKey == null || forceKey === "") return;
    pinnedRef.current = true;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [forceKey, scrollerRef]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(id);
  }, [contentKey, scrollerRef]);

  return null;
}
