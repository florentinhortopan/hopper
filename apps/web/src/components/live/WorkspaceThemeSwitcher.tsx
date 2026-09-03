"use client";

import {
  WORKSPACE_THEME_LIST,
  resolveWorkspaceThemeId,
  type WorkspaceThemeId,
} from "@attatta/shared";

type Props = {
  value: string | null | undefined;
  disabled?: boolean;
  onChange: (id: WorkspaceThemeId) => void;
};

/** Campaign-settings theme picker (Vanilla · AT&T). */
export function WorkspaceThemeSwitcher({
  value,
  disabled,
  onChange,
}: Props) {
  const current = resolveWorkspaceThemeId(value);

  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      role="radiogroup"
      aria-label="Campaign theme"
    >
      {WORKSPACE_THEME_LIST.map((theme) => {
        const on = theme.id === current;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(theme.id)}
            className={`overflow-hidden border p-0 text-left transition-colors disabled:opacity-40 ${
              theme.id === "att" ? "rounded-none" : "rounded-xl"
            } ${
              on
                ? "border-ember-500 bg-white shadow-surface ring-1 ring-ember-500/30"
                : "border-ink-200 bg-white/70 hover:border-ink-300"
            }`}
          >
            <div
              className={
                theme.id === "att"
                  ? "theme-card-att-preview"
                  : "theme-card-vanilla-preview"
              }
              aria-hidden
            />
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-display text-lg text-ink-900 ${
                    theme.id === "att" ? "font-extrabold uppercase tracking-tight" : ""
                  }`}
                >
                  {theme.label}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {theme.swatches.map((c) => (
                    <span
                      key={c}
                      className={`h-3.5 w-3.5 border border-ink-900/10 ${
                        theme.id === "att" ? "rounded-none" : "rounded-sm"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-600">{theme.description}</p>
              {on ? (
                <span className="mt-2 inline-block bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ember-700">
                  Active
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
