"use client";

import { useEffect, useRef, useState } from "react";

export type PlateMetaDraft = {
  promptHint: string;
  negativeHint: string;
  tags: string[];
  /** Present when editing kind=copy plates */
  copy?: {
    setup: string;
    punchline: string;
    endcard: string;
    cta: string;
  };
};

type Props = {
  promptHint: string;
  negativeHint: string;
  tags?: string[];
  disabled?: boolean;
  compact?: boolean;
  /** Immediate local update (so Generate sees latest text) */
  onDraftChange?: (next: PlateMetaDraft) => void;
  onSave: (next: PlateMetaDraft) => void | Promise<void>;
};

function tagsToInput(tags: string[] | undefined): string {
  return (tags || []).join(", ");
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Plate meta editor — tags + positive/negative prompts (all visible when open).
 * Autosaves on blur and after a short idle debounce.
 */
export function PlatePromptEditor({
  promptHint,
  negativeHint,
  tags = [],
  disabled,
  compact,
  onDraftChange,
  onSave,
}: Props) {
  const [prompt, setPrompt] = useState(promptHint);
  const [negative, setNegative] = useState(negativeHint);
  const [tagsText, setTagsText] = useState(tagsToInput(tags));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({
    prompt: promptHint,
    negative: negativeHint,
    tagsText: tagsToInput(tags),
    dirty: false,
  });

  useEffect(() => {
    setPrompt(promptHint);
    setNegative(negativeHint);
    setTagsText(tagsToInput(tags));
    setDirty(false);
    latest.current = {
      prompt: promptHint,
      negative: negativeHint,
      tagsText: tagsToInput(tags),
      dirty: false,
    };
  }, [promptHint, negativeHint, tags.join("\u0001")]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function persist(force = false) {
    const snap = latest.current;
    if ((!snap.dirty && !force) || disabled) return;
    setSaving(true);
    try {
      await onSave({
        promptHint: snap.prompt.trim(),
        negativeHint: snap.negative.trim(),
        tags: parseTags(snap.tagsText),
      });
      latest.current.dirty = false;
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function markDirty(nextPrompt: string, nextNegative: string, nextTags: string) {
    latest.current = {
      prompt: nextPrompt,
      negative: nextNegative,
      tagsText: nextTags,
      dirty: true,
    };
    setDirty(true);
    onDraftChange?.({
      promptHint: nextPrompt,
      negativeHint: nextNegative,
      tags: parseTags(nextTags),
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist();
    }, 450);
  }

  const field =
    compact
      ? "text-[11px] leading-snug"
      : "text-xs leading-relaxed";

  return (
    <div
      className={`min-w-0 w-full space-y-2 ${compact ? "mt-0" : "mt-1"}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="block min-w-0 w-full">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600">
          Tags
        </span>
        <input
          type="text"
          value={tagsText}
          disabled={disabled || saving}
          placeholder="desk, daylight, outdoor…"
          className={`mt-1 w-full rounded-lg border border-warm-line bg-white px-2.5 py-1.5 text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none ${field}`}
          onChange={(e) => {
            const v = e.target.value;
            setTagsText(v);
            markDirty(prompt, negative, v);
          }}
          onBlur={() => void persist()}
        />
      </label>

      <label className="block min-w-0 w-full">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600">
          Plate prompt
        </span>
        <textarea
          value={prompt}
          disabled={disabled || saving}
          rows={compact ? 2 : 3}
          placeholder="Describe this plate for Comfy — product, framing, materials, mood…"
          className={`mt-1 box-border min-h-[2.75rem] w-full min-w-0 resize-y rounded-lg border border-warm-line bg-white px-2.5 py-2 text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none ${field}`}
          onChange={(e) => {
            const v = e.target.value;
            setPrompt(v);
            markDirty(v, negative, tagsText);
          }}
          onBlur={() => void persist()}
        />
      </label>

      <label className="block min-w-0 w-full">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600">
          Negative prompt
        </span>
        <input
          type="text"
          value={negative}
          disabled={disabled || saving}
          placeholder="Avoid: blur, text, wrong brand…"
          className={`mt-1 w-full rounded-lg border border-warm-line bg-white px-2.5 py-1.5 text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none ${field}`}
          onChange={(e) => {
            const v = e.target.value;
            setNegative(v);
            markDirty(prompt, v, tagsText);
          }}
          onBlur={() => void persist()}
        />
      </label>

      {dirty || saving ? (
        <p className="text-[10px] text-ink-500">
          {saving ? "Saving…" : "Unsaved — autosaves for Comfy generate"}
        </p>
      ) : null}
    </div>
  );
}
