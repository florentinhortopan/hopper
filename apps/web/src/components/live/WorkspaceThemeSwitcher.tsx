"use client";

import {
  WORKSPACE_THEME_LIST,
  resolveWorkspaceThemeId,
  type WorkspaceThemeId,
} from "@attatta/shared";

type Props = {
  value: string | null | undefined;
  disabled?: boolean;
  /** Compact for live header; cards for settings. */
  variant?: "compact" | "cards";
  onChange: (id: WorkspaceThemeId) => void;
};

export function WorkspaceThemeSwitcher({
  value,
  disabled,
  variant = "compact",
  onChange,
}: Props) {
  const current = resolveWorkspaceThemeId(value);

  if (variant === "cards") {
    return (
      <div
        className="grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Workspace theme"
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
              className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-40 ${
                on
                  ? "border-ember-500 bg-white shadow-surface"
                  : "border-ink-200 bg-white/70 hover:border-ink-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg text-ink-900">
                  {theme.label}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {theme.swatches.map((c) => (
                    <span
                      key={c}
                      className="h-3.5 w-3.5 rounded-sm border border-ink-900/10"
                      style={{ background: c }}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-600">{theme.description}</p>
              {on ? (
                <span className="mt-2 inline-block rounded bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ember-700">
                  Active
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="ws-theme-switch"
      role="radiogroup"
      aria-label="Workspace theme"
    >
      {WORKSPACE_THEME_LIST.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={theme.id === current}
          aria-pressed={theme.id === current}
          disabled={disabled}
          title={theme.description}
          className="ws-theme-opt"
          onClick={() => onChange(theme.id)}
        >
          <span className="ws-theme-swatches" aria-hidden>
            {theme.swatches.map((c) => (
              <span
                key={c}
                className="ws-theme-swatch"
                style={{ background: c }}
              />
            ))}
          </span>
          {theme.label}
        </button>
      ))}
    </div>
  );
}
