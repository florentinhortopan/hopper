import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesignTokens } from "@attatta/shared";
import { PATHS, REPO_ROOT } from "./config.js";

/** Canonical default pack id — campaigns / cells / Remotion defaults reference this. */
export const DEFAULT_BRAND_TOKEN_ID = "brand_default_v3";

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
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure brand_default_v3.json exists under data/tokens.
 * Railway volumes often start empty or partial — entrypoint may have been skipped
 * or only created the directory via ensureDataDirs.
 */
export async function ensureDefaultBrandTokens(): Promise<void> {
  await mkdir(PATHS.tokens, { recursive: true });
  const dest = path.join(PATHS.tokens, `${DEFAULT_BRAND_TOKEN_ID}.json`);
  if (await exists(dest)) return;

  const candidates = [
    path.join(REPO_ROOT, "data-seed", "tokens", `${DEFAULT_BRAND_TOKEN_ID}.json`),
    // Local / image path when volume is not masking a pre-seeded tree
    path.join(REPO_ROOT, "data", "tokens", `${DEFAULT_BRAND_TOKEN_ID}.json`),
  ];
  for (const src of candidates) {
    if (!(await exists(src)) || src === dest) continue;
    await copyFile(src, dest);
    console.log(`Seeded design tokens from ${src}`);
    return;
  }

  await writeFile(dest, JSON.stringify(DEFAULT_BRAND_TOKENS, null, 2));
  console.log(`Wrote embedded design tokens → ${dest}`);
}
