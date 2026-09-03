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
      className={`ws-composer relative z-30 shrink-0 border-t-2 border-ink-900 bg-ink-900 text-warm-paper ${
        expanded ? "-mt-36 px-3 pb-3 pt-3" : "px-3 py-2.5"
      }`}
    >
      <div className="mx-auto flex max-w-[96rem] flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold tracking-tight text-warm-paper">
              Say the quiet part
            </p>
            <p
              className="truncate text-[10px] uppercase tracking-[0.12em] text-warm-paper/55"
              title={LIVE_CHAT_SLASH_HINT}
            >
              {LIVE_CHAT_SLASH_HINT}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-warm-paper/60">
            <span className="hidden sm:inline">{status}</span>
            {turns.length ? (
              <button
                type="button"
                className="text-warm-paper/70 underline decoration-warm-paper/30 underline-offset-2 hover:text-warm-paper"
                onClick={() => setTurns([])}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="ws-chip rounded-sm border border-warm-paper/25 bg-transparent px-2 py-0.5 font-semibold uppercase tracking-[0.1em] text-warm-paper/80 hover:border-warm-paper/50 hover:text-warm-paper"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {!expanded && latestAssistant ? (
          <p className="rounded-sm border border-warm-paper/15 bg-ink-800/80 px-2.5 py-1.5 text-[12px] leading-snug text-warm-paper/90">
            <span className="font-display font-semibold text-ember-500">
              ATTATTA ·{" "}
            </span>
            {latestAssistant.text}
          </p>
        ) : null}

        {expanded && turns.length ? (
          <div
            ref={threadRef}
            className="max-h-36 space-y-2 overflow-y-auto rounded-sm border border-warm-paper/15 bg-ink-800/70 px-2.5 py-2"
          >
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`text-[12px] leading-snug ${
                  turn.role === "user"
                    ? "text-warm-paper"
                    : "text-warm-paper/75"
                }`}
              >
                <span className="font-display text-[11px] font-semibold text-ember-500">
                  {turn.role === "user" ? "You" : "ATTATTA"}
                  {turn.meta ? ` · ${turn.meta}` : ""}
                  {": "}
                </span>
                {turn.text}
              </div>
            ))}
            {busy ? (
              <p className="text-[11px] text-warm-paper/45">
                ATTATTA is thinking…
              </p>
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
              className="min-h-[4.5rem] min-w-0 flex-1 resize-y rounded-sm border border-warm-paper/20 bg-warm-paper px-3 py-2 text-xs leading-relaxed text-ink-900 placeholder:text-ink-600/50"
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
              className="min-w-0 flex-1 rounded-sm border border-warm-paper/20 bg-warm-paper px-3 py-2.5 text-xs text-ink-900 placeholder:text-ink-600/50"
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
            className="ws-chip shrink-0 rounded-sm bg-ember-500 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-warm-paper hover:bg-ember-600 disabled:opacity-40"
            disabled={disabled || busy || !text.trim()}
            onClick={() => void send()}
          >
            {busyLabel || (busy ? "…" : "Send")}
          </button>
        </div>
        {expanded ? (
          <p className="text-[10px] uppercase tracking-[0.1em] text-warm-paper/40">
            ⌘/Ctrl+Enter to send · same surface later for Teams / other chats
          </p>
        ) : null}
      </div>
    </div>
  );
}
