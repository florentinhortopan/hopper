import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataPaths, resolveRepoRoot } from "@attatta/shared/paths";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolveRepoRoot(path.join(here, "../../.."));
export const PATHS = dataPaths(REPO_ROOT);
export const PORT = Number(process.env.PORT || 8787);

/**
 * Normalize PUBLIC_BASE so Remotion / clients never get a host-without-scheme
 * (e.g. `foo.up.railway.app` → treated as a relative path under localhost:3000).
 */
export function normalizePublicBase(
  raw: string | undefined,
  port: number = PORT,
): string {
  const fallback = `http://127.0.0.1:${port}`;
  if (!raw?.trim()) return fallback;

  let base = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/\/+$/, "");
  }

  // Railway / misconfigured env: host pasted without https://
  const hostOnly =
    /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/i.test(base) ||
    /\.(railway\.app|vercel\.app|localhost)/i.test(base);
  if (!hostOnly) {
    console.warn(
      `[config] PUBLIC_BASE looks invalid (${JSON.stringify(raw)}); using ${fallback}`,
    );
    return fallback;
  }

  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(base);
  const scheme = isLocal ? "http" : "https";
  base = `${scheme}://${base}`;
  console.warn(
    `[config] PUBLIC_BASE missing scheme; normalized to ${base} (set https:// explicitly in Railway)`,
  );
  return base;
}

export const PUBLIC_BASE = normalizePublicBase(process.env.PUBLIC_BASE, PORT);
