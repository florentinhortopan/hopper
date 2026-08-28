"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportSession } from "@attatta/shared";

const ACTIVE: ReadonlySet<ImportSession["status"]> = new Set([
  "staging",
  "classifying",
  "committing",
]);

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function parseClassified(message: string): { done: number; total: number } | null {
  const m = message.match(/Classified\s+(\d+)\s*\/\s*(\d+)/i);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total < 1) return null;
  return { done, total };
}

export type ImportEta = {
  /** True while staging / classifying / committing */
  active: boolean;
  elapsedLabel: string;
  /** null until we have enough signal */
  etaLabel: string | null;
  /** e.g. "3/10" during classify */
  countLabel: string | null;
  progressPct: number;
  /** One-line summary for footers */
  summary: string;
};

/**
 * Elapsed + remaining estimate from import session progress / "Classified n/m".
 * Client-side only — polls the clock once per second while active.
 */
export function useImportEta(session: ImportSession | null): ImportEta {
  const [now, setNow] = useState(() => Date.now());
  const phaseStartRef = useRef<number | null>(null);
  const phaseKeyRef = useRef<string>("");
  const classifyStartRef = useRef<number | null>(null);

  const active = Boolean(session && ACTIVE.has(session.status));
  const phaseKey = session
    ? `${session.id}:${session.status}`
    : "";

  useEffect(() => {
    if (!active) {
      phaseStartRef.current = null;
      phaseKeyRef.current = "";
      classifyStartRef.current = null;
      return;
    }
    if (phaseKeyRef.current !== phaseKey) {
      phaseKeyRef.current = phaseKey;
      phaseStartRef.current = Date.now();
      if (session?.status === "classifying") {
        classifyStartRef.current = Date.now();
      }
    }
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active, phaseKey, session?.status]);

  if (!session || !active || !phaseStartRef.current) {
    return {
      active: false,
      elapsedLabel: "0s",
      etaLabel: null,
      countLabel: null,
      progressPct: 0,
      summary: "",
    };
  }

  const elapsedSec = (now - phaseStartRef.current) / 1000;
  const progressPct = Math.round(Math.min(1, Math.max(0, session.progress)) * 100);
  const classified = parseClassified(session.message || "");

  let etaSec: number | null = null;
  let countLabel: string | null = null;

  if (classified) {
    countLabel = `${classified.done}/${classified.total}`;
    if (
      classified.done > 0 &&
      classified.done < classified.total &&
      classifyStartRef.current
    ) {
      const classifyElapsed = (now - classifyStartRef.current) / 1000;
      const perItem = classifyElapsed / classified.done;
      etaSec = perItem * (classified.total - classified.done);
    } else if (classified.done >= classified.total) {
      etaSec = 0;
    }
  } else if (session.progress > 0.08 && session.progress < 0.99) {
    etaSec = (elapsedSec * (1 - session.progress)) / session.progress;
  }

  // Cap wild early estimates
  if (etaSec != null && etaSec > 60 * 30) etaSec = 60 * 30;

  const etaLabel =
    etaSec == null
      ? elapsedSec < 2
        ? "estimating…"
        : null
      : etaSec <= 1
        ? "almost done"
        : `~${formatDuration(etaSec)} left`;

  const verb =
    session.status === "classifying"
      ? "Classifying"
      : session.status === "committing"
        ? "Committing"
        : "Importing";

  const parts = [
    `${verb}…`,
    countLabel,
    `${formatDuration(elapsedSec)} elapsed`,
    etaLabel,
  ].filter(Boolean);

  return {
    active: true,
    elapsedLabel: formatDuration(elapsedSec),
    etaLabel,
    countLabel,
    progressPct,
    summary: parts.join(" · "),
  };
}
