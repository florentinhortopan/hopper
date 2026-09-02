"use client";

import type { LiveColumnId } from "@attatta/shared";

export type LiveChatPrompt = {
  id: string;
  column: LiveColumnId;
  /** Dedup / lifecycle key (prepare epoch, job batch, etc.) */
  key: string;
  summary: string;
  detail: string;
  primaryLabel: string;
  status: "open" | "acted" | "dismissed";
  at: number;
};

type Props = {
  prompts: LiveChatPrompt[];
  column: LiveColumnId;
  disabled?: boolean;
  busyLabel?: string | null;
  onAct: (prompt: LiveChatPrompt) => void | Promise<void>;
  onDismiss: (prompt: LiveChatPrompt) => void;
};

/** Ephemeral suggested actions for a column — chat turns, not a sticky composer bar. */
export function LiveChatPromptBar({
  prompts,
  column,
  disabled,
  busyLabel,
  onAct,
  onDismiss,
}: Props) {
  const open = prompts.filter(
    (p) => p.column === column && p.status === "open",
  );
  if (!open.length) return null;

  return (
    <div className="max-h-44 space-y-2 overflow-y-auto border-t border-ink-100 bg-[#f7f3eb]/90 px-3 py-2">
      {open.map((p) => (
        <article
          key={p.id}
          className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm"
        >
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
            Suggested
          </p>
          <p className="mt-1 font-medium text-ink-900">{p.summary}</p>
          {p.detail ? (
            <p className="mt-0.5 text-[11px] text-ink-600">{p.detail}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-ink-900 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
              disabled={disabled}
              onClick={() => void onAct(p)}
            >
              {busyLabel || p.primaryLabel}
            </button>
            <button
              type="button"
              className="rounded-md border border-ink-200 px-2.5 py-1 text-[11px] text-ink-600 disabled:opacity-40"
              disabled={disabled}
              onClick={() => onDismiss(p)}
            >
              Dismiss
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
