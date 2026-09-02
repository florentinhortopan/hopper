"use client";

import { useState } from "react";
import type { LiveColumnId } from "@attatta/shared";

type Props = {
  column: LiveColumnId;
  llmOn: boolean;
  placeholder?: string;
  disabled?: boolean;
  onSubmit: (text: string) => Promise<void>;
};

export function ColumnComposer({
  column,
  llmOn,
  placeholder,
  disabled,
  onSubmit,
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const hints =
    column === "magic"
      ? "/prepare · /generate · brief text"
      : column === "hopper"
        ? "/keep <cellId> · /kill <cellId> · note"
        : "/package · note";

  async function send() {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-ink-200 bg-white/80 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-ink-500">
        <span>{hints}</span>
        <span>{llmOn ? "LLM on" : "LLM off"}</span>
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-ink-200 px-2 py-1.5 text-xs"
          value={text}
          disabled={disabled || busy}
          placeholder={placeholder || "Message this column…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="rounded-md bg-ink-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
          disabled={disabled || busy || !text.trim()}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
