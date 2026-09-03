"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveColumnId } from "@attatta/shared";
import {
  LIVE_CHAT_SLASH_HINT,
  type RoutedLiveIntent,
} from "@/components/live/routeLiveChat";

type Props = {
  llmOn: boolean;
  disabled?: boolean;
  busyLabel?: string | null;
  /** Last routing result for a short status line. */
  lastRoute?: { column: LiveColumnId; label: string } | null;
  onSubmit: (text: string) => Promise<void>;
};

/**
 * Single workspace composer under Magic / Hopper / Celtra.
 * Collapsed = one line; expanded = multi-line panel that grows over the columns.
 */
export function WorkspaceComposer({
  llmOn,
  disabled,
  busyLabel,
  lastRoute,
  onSubmit,
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!expanded) return;
    taRef.current?.focus();
  }, [expanded]);

  // Auto-expand when the user needs more than a couple of lines
  useEffect(() => {
    if (expanded) return;
    if (text.includes("\n") || text.length > 120) {
      setExpanded(true);
    }
  }, [text, expanded]);

  async function send() {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setText("");
      if (expanded && t.length < 40) setExpanded(false);
    } finally {
      setBusy(false);
    }
  }

  const status =
    lastRoute != null
      ? `→ ${lastRoute.column}: ${lastRoute.label}`
      : llmOn
        ? "LLM on · routes free text when helpful"
        : "LLM off · slash + keywords route to columns";

  return (
    <div
      className={`relative z-30 shrink-0 border-t border-ink-200 bg-warm-paper/95 shadow-[0_-8px_24px_rgba(26,26,26,0.06)] ${
        expanded
          ? "-mt-28 px-3 pb-3 pt-3 backdrop-blur-sm"
          : "px-3 py-2"
      }`}
    >
      <div className="mx-auto flex max-w-[96rem] flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-500">
          <span className="min-w-0 truncate" title={LIVE_CHAT_SLASH_HINT}>
            ATTATTA · {LIVE_CHAT_SLASH_HINT}
          </span>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">{status}</span>
            <button
              type="button"
              className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-50"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        <div
          className={`flex gap-2 ${expanded ? "items-end" : "items-center"}`}
        >
          {expanded ? (
            <textarea
              ref={taRef}
              rows={4}
              className="min-h-[5.5rem] min-w-0 flex-1 resize-y rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs leading-relaxed shadow-sm"
              value={text}
              disabled={disabled || busy}
              placeholder="Talk to ATTATTA — /prepare, /generate, /keep cellId, /package, or plain language…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          ) : (
            <input
              className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm"
              value={text}
              disabled={disabled || busy}
              placeholder="Message ATTATTA… (/prepare · /generate · /package)"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          )}
          <button
            type="button"
            className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-xs text-white disabled:opacity-40"
            disabled={disabled || busy || !text.trim()}
            onClick={() => void send()}
          >
            {busyLabel || (busy ? "…" : "Send")}
          </button>
        </div>
        {expanded ? (
          <p className="text-[10px] text-ink-400">
            ⌘/Ctrl+Enter to send · same command surface later for Teams / other
            chats
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type { RoutedLiveIntent };
