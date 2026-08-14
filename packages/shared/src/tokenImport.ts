import { DesignTokensSchema, type DesignTokens } from "./schemas.js";

/** Auto hints when comfyStyleHints is empty — English, not CSS. */
export function deriveComfyStyleHints(tokens: DesignTokens): string[] {
  const { colors, fonts } = tokens;
  const palette = `brand palette: background ${colors.background}, foreground ${colors.foreground}, accent ${colors.accent}, muted ${colors.muted}`;
  const type = `display type ${fonts.display}; body type ${fonts.body}`;
  return [palette, type];
}

/** Resolve operator hints or derived palette/type lines. */
export function resolveComfyStyleHints(tokens: DesignTokens): string[] {
  const custom = (tokens.comfyStyleHints ?? [])
    .map((h) => h.trim())
    .filter(Boolean);
  if (custom.length) return custom;
  return deriveComfyStyleHints(tokens);
}

/** Compact "Brand look: …" clause for Comfy positives (capped). */
export function formatBrandLookClause(
  tokens: DesignTokens,
  maxLen = 240,
): string {
  const joined = resolveComfyStyleHints(tokens).join("; ");
  const clause = `Brand look: ${joined}`;
  if (clause.length <= maxLen) return clause;
  return `${clause.slice(0, maxLen - 1)}…`;
}

export function sanitizeTokenPackId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!id) throw new Error("Token pack id is empty after sanitize");
  return id;
}

export function parseAttattaTokensJson(
  raw: string,
  opts?: { id?: string; label?: string },
): DesignTokens {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON — paste a DesignTokens object");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Token JSON must be an object");
  }
  const obj = data as Record<string, unknown>;
  if (opts?.id) obj.id = opts.id;
  if (opts?.label) obj.label = opts.label;
  if (!obj.id && opts?.id) obj.id = opts.id;
  if (!obj.label) {
    obj.label = typeof obj.id === "string" ? String(obj.id) : "Imported pack";
  }
  return DesignTokensSchema.parse(obj);
}

function cssVarMap(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const key = m[1]!.toLowerCase().replace(/_/g, "-");
    const val = m[2]!.trim().replace(/^['"]|['"]$/g, "");
    if (val) map.set(key, val);
  }
  return map;
}

function pickVar(
  map: Map<string, string>,
  names: string[],
  fallback: string,
): string {
  for (const n of names) {
    const v = map.get(n);
    if (v) return v;
  }
  // also try without color-/font- prefix variants already listed
  return fallback;
}

const DEFAULT_COLORS = {
  background: "#1c1917",
  foreground: "#fafaf9",
  accent: "#ea580c",
  muted: "#44403c",
};

const DEFAULT_FONTS = {
  display: "Georgia, serif",
  body: "system-ui, sans-serif",
};

/**
 * Map CSS custom properties into DesignTokens.
 * Recognizes --color-background|bg, --color-foreground|fg|text,
 * --color-accent|primary, --color-muted, --font-display|heading, --font-body|sans.
 */
export function parseCssVariablesToTokens(
  css: string,
  opts: { id: string; label?: string },
): DesignTokens {
  const map = cssVarMap(css);
  if (!map.size) {
    throw new Error(
      "No CSS variables found — use --color-accent: #…; --font-display: …;",
    );
  }
  const id = sanitizeTokenPackId(opts.id);
  return DesignTokensSchema.parse({
    id,
    label: opts.label?.trim() || id,
    colors: {
      background: pickVar(
        map,
        ["color-background", "color-bg", "background", "bg"],
        DEFAULT_COLORS.background,
      ),
      foreground: pickVar(
        map,
        ["color-foreground", "color-fg", "color-text", "foreground", "text"],
        DEFAULT_COLORS.foreground,
      ),
      accent: pickVar(
        map,
        ["color-accent", "color-primary", "accent", "primary"],
        DEFAULT_COLORS.accent,
      ),
      muted: pickVar(
        map,
        ["color-muted", "color-secondary", "muted", "secondary"],
        DEFAULT_COLORS.muted,
      ),
    },
    fonts: {
      display: pickVar(
        map,
        ["font-display", "font-heading", "font-title", "display", "heading"],
        DEFAULT_FONTS.display,
      ),
      body: pickVar(
        map,
        ["font-body", "font-sans", "font-text", "body", "sans"],
        DEFAULT_FONTS.body,
      ),
    },
    endCardLayout: { ctaStyle: "solid", logoPosition: "bottom" },
    socialChrome: false,
    comfyStyleHints: [],
  });
}

export function importTokensFromText(
  format: "json" | "css",
  text: string,
  opts?: { id?: string; label?: string },
): DesignTokens {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste is empty");
  if (format === "json") {
    return parseAttattaTokensJson(trimmed, opts);
  }
  const id = opts?.id?.trim() || "brand_from_css";
  return parseCssVariablesToTokens(trimmed, {
    id,
    label: opts?.label,
  });
}
