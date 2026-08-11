"use client";

import type { ReactNode } from "react";
import type { PlateDensity } from "@/components/PlateCard";

const MODES: {
  id: PlateDensity;
  label: string;
  title: string;
  icon: ReactNode;
}[] = [
  {
    id: "row",
    label: "Rows",
    title: "List rows",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d="M2 3.5h10M2 7h10M2 10.5h10"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "small",
    label: "Small",
    title: "Compact grid",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        <rect x="8" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        <rect x="1.5" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        <rect x="8" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: "big",
    label: "Large",
    title: "Large grid",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="1.5" y="1.5" width="11" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

export function ViewModeToggle({
  value,
  onChange,
  size = "default",
}: {
  value: PlateDensity;
  onChange: (v: PlateDensity) => void;
  /** compact = icon-forward secondary control under filters */
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <div
      role="group"
      aria-label="Plate view"
      className={
        compact
          ? "inline-flex w-full max-w-[220px] items-stretch rounded-full bg-ink-900/[0.06] p-0.5 sm:w-auto"
          : "inline-flex items-center rounded-lg border border-warm-line bg-warm-paper p-0.5 shadow-surface"
      }
    >
      {MODES.map((m) => {
        const on = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            title={m.title}
            aria-pressed={on}
            onClick={() => onChange(m.id)}
            className={
              compact
                ? `inline-flex flex-1 items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors ${
                    on
                      ? "bg-warm-paper text-ink-900 shadow-sm"
                      : "text-ink-600 hover:text-ink-900"
                  }`
                : `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
                    on
                      ? "bg-ink-900 text-warm-paper"
                      : "text-ink-600 hover:text-ink-900"
                  }`
            }
          >
            {m.icon}
            <span className={compact ? "sr-only sm:not-sr-only" : "hidden sm:inline"}>
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
