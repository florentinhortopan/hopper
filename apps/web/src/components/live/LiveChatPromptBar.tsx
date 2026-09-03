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
  /** Disable primary action only — dismiss stays available. */
  actDisabled?: boolean;
  busyLabel?: string | null;
  onAct: (prompt: LiveChatPrompt) => void | Promise<void>;
  onDismiss: (prompt: LiveChatPrompt) => void;
  onDismissAll?: () => void;
};

/** Ephemeral suggested actions for a column — at most one open card shown. */
export function LiveChatPromptBar({
  prompts,
  column,
  actDisabled,
  busyLabel,
  onAct,
  onDismiss,
  onDismissAll,
}: Props) {
  const open = prompts
    .filter((p) => p.column === column && p.status === "open")
    .sort((a, b) => b.at - a.at);
  if (!open.length) return null;

  // Only the newest open nudge — older ones are noise
  const latest = open[0]!;
  const hiddenCount = open.length - 1;

  return (
    <div className="border-t border-ink-100 bg-[#f7f3eb]/90 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
          Suggested
          {hiddenCount > 0 ? ` · +${hiddenCount} older` : ""}
        </p>
        {onDismissAll ? (
          <button
            type="button"
            className="text-[10px] text-ink-500 underline"
            onClick={onDismissAll}
          >
            Dismiss all
          </button>
        ) : null}
      </div>
      <article className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm">
        <p className="font-medium text-ink-900">{latest.summary}</p>
        {latest.detail ? (
          <p className="mt-0.5 text-[11px] text-ink-600">{latest.detail}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-ink-900 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
            disabled={actDisabled}
            onClick={() => void onAct(latest)}
          >
            {busyLabel || latest.primaryLabel}
          </button>
          <button
            type="button"
            className="rounded-md border border-ink-200 px-2.5 py-1 text-[11px] text-ink-600"
            onClick={() => {
              onDismiss(latest);
              if (hiddenCount > 0) onDismissAll?.();
            }}
          >
            Dismiss
          </button>
        </div>
      </article>
    </div>
  );
}
