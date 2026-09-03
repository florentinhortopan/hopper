import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesignTokens } from "@attatta/shared";
import { PATHS, REPO_ROOT } from "./config.js";

/** Canonical default pack id — campaigns / cells / Remotion defaults reference this. */
export const DEFAULT_BRAND_TOKEN_ID = "brand_default_v3";
export const ATT_BRAND_TOKEN_ID = "brand_att_v1";

export const DEFAULT_BRAND_TOKENS: DesignTokens = {
  id: DEFAULT_BRAND_TOKEN_ID,
  label: "Brand Default v3",
  colors: {
    background: "#1c1917",
    foreground: "#fafaf9",
    accent: "#ea580c",
    muted: "#44403c",
  },
  fonts: {
    display: "Georgia, serif",
    body: "system-ui, sans-serif",
  },
  endCardLayout: {
    ctaStyle: "solid",
    logoPosition: "bottom",
  },
  socialChrome: false,
  comfyStyleHints: [],
};

export const ATT_BRAND_TOKENS: DesignTokens = {
  id: ATT_BRAND_TOKEN_ID,
  label: "AT&T Brand v1",
  colors: {
    background: "#000000",
    foreground: "#FFFFFF",
    accent: "#067AB4",
    muted: "#5C6B73",
  },
  fonts: {
    display: "system-ui, sans-serif",
    body: "system-ui, sans-serif",
  },
  endCardLayout: {
    ctaStyle: "solid",
    logoPosition: "bottom",
  },
  socialChrome: false,
  comfyStyleHints: [
    "AT&T Blue #067AB4 primary",
    "AT&T New Orange #FF7200 accent CTA",
    "clean corporate flat, high contrast black/white",
  ],
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureTokenPack(
  id: string,
  embedded: DesignTokens,
): Promise<void> {
  await mkdir(PATHS.tokens, { recursive: true });
  const dest = path.join(PATHS.tokens, `${id}.json`);
  if (await exists(dest)) return;

  const candidates = [
    path.join(REPO_ROOT, "data-seed", "tokens", `${id}.json`),
    path.join(REPO_ROOT, "data", "tokens", `${id}.json`),
  ];
  for (const src of candidates) {
    if (!(await exists(src)) || src === dest) continue;
    await copyFile(src, dest);
    console.log(`Seeded design tokens from ${src}`);
    return;
  }

  await writeFile(dest, JSON.stringify(embedded, null, 2));
  console.log(`Wrote embedded design tokens → ${dest}`);
}

/**
 * Ensure brand token packs exist under data/tokens.
 * Railway volumes often start empty or partial — entrypoint may have been skipped
 * or only created the directory via ensureDataDirs.
 */
export async function ensureDefaultBrandTokens(): Promise<void> {
  await ensureTokenPack(DEFAULT_BRAND_TOKEN_ID, DEFAULT_BRAND_TOKENS);
  await ensureTokenPack(ATT_BRAND_TOKEN_ID, ATT_BRAND_TOKENS);
}
