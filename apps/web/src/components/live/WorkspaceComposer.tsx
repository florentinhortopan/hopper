"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveColumnId } from "@attatta/shared";
import { LIVE_CHAT_SLASH_HINT } from "@/components/live/routeLiveChat";

export type WorkspaceChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  meta?: string;
};

export type WorkspaceChatResult = {
  reply: string;
  route?: { column: LiveColumnId; label: string } | null;
  replySource?: "llm" | "template";
};

type Props = {
  llmOn: boolean;
  disabled?: boolean;
  busyLabel?: string | null;
  /** Last routing result for a short status line. */
  lastRoute?: { column: LiveColumnId; label: string } | null;
  onSubmit: (text: string) => Promise<WorkspaceChatResult | null | void>;
};

/**
 * Single workspace composer under Magic / Hopper / Celtra.
 * Collapsed = one line; expanded = transcript + multi-line input over the columns.
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
  const [turns, setTurns] = useState<WorkspaceChatTurn[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    taRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (expanded) return;
    if (text.includes("\n") || text.length > 120) {
      setExpanded(true);
    }
  }, [text, expanded]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, expanded, busy]);

  async function send() {
    const t = text.trim();
    if (!t || busy || disabled) return;
    const userTurn: WorkspaceChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      text: t,
      at: Date.now(),
    };
    setTurns((prev) => [...prev.slice(-20), userTurn]);
    setText("");
    setExpanded(true);
    setBusy(true);
    try {
      const result = await onSubmit(t);
      const reply =
        result && typeof result === "object" && result.reply
          ? result.reply
          : "Done.";
      const meta =
        result && typeof result === "object"
          ? [
              result.route
                ? `→ ${result.route.column}: ${result.route.label}`
                : null,
              result.replySource === "llm"
                ? "LLM"
                : result.replySource === "template"
                  ? "local"
                  : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined;
      setTurns((prev) => [
        ...prev.slice(-20),
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: reply,
          at: Date.now(),
          meta,
        },
      ]);
    } catch (e) {
      setTurns((prev) => [
        ...prev.slice(-20),
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: e instanceof Error ? e.message : String(e),
          at: Date.now(),
          meta: "error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const status =
    lastRoute != null
      ? `→ ${lastRoute.column}: ${lastRoute.label}`
      : llmOn
        ? "LLM on · replies + routes free text"
        : "LLM off · template replies · slash commands still work";

  const latestAssistant = [...turns]
    .reverse()
    .find((x) => x.role === "assistant");

  return (
    <div
      className={`relative z-30 shrink-0 border-t border-ink-200 bg-warm-paper/95 shadow-[0_-8px_24px_rgba(26,26,26,0.06)] ${
        expanded
          ? "-mt-40 px-3 pb-3 pt-3 backdrop-blur-sm"
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
            {turns.length ? (
              <button
                type="button"
                className="text-[10px] text-ink-500 underline"
                onClick={() => setTurns([])}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] text-ink-600 hover:bg-ink-50"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {!expanded && latestAssistant ? (
          <p className="rounded-md border border-ink-100 bg-white/80 px-2 py-1.5 text-[11px] text-ink-700">
            <span className="font-medium text-ink-500">ATTATTA · </span>
            {latestAssistant.text}
          </p>
        ) : null}

        {expanded && turns.length ? (
          <div
            ref={threadRef}
            className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-ink-100 bg-white/90 px-2 py-2"
          >
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`text-[11px] leading-snug ${
                  turn.role === "user" ? "text-ink-800" : "text-ink-600"
                }`}
              >
                <span className="font-medium text-ink-500">
                  {turn.role === "user" ? "You" : "ATTATTA"}
                  {turn.meta ? ` · ${turn.meta}` : ""}
                  {": "}
                </span>
                {turn.text}
              </div>
            ))}
            {busy ? (
              <p className="text-[11px] text-ink-400">ATTATTA is thinking…</p>
            ) : null}
          </div>
        ) : null}

        <div
          className={`flex gap-2 ${expanded ? "items-end" : "items-center"}`}
        >
          {expanded ? (
            <textarea
              ref={taRef}
              rows={3}
              className="min-h-[4.5rem] min-w-0 flex-1 resize-y rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs leading-relaxed shadow-sm"
              value={text}
              disabled={disabled || busy}
              placeholder="Talk to ATTATTA — ask what to do next, or /prepare · /generate · /package…"
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
            ⌘/Ctrl+Enter to send · same surface later for Teams / other chats
          </p>
        ) : null}
      </div>
    </div>
  );
}
