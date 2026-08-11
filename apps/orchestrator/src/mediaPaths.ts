import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LIBRARY_ID } from "@attatta/shared";
import { PATHS } from "./config.js";

const LEGACY_DATA_LIBRARY = `${path.sep}data${path.sep}library${path.sep}`;
const PACK_DATA_LIBRARY = `${path.sep}data${path.sep}libraries${path.sep}${DEFAULT_LIBRARY_ID}${path.sep}`;

function rewriteLegacyLibrarySegment(p: string): string | null {
  if (p.includes(LEGACY_DATA_LIBRARY)) {
    return p.replace(LEGACY_DATA_LIBRARY, PACK_DATA_LIBRARY);
  }
  if (p.startsWith("library/")) {
    return `libraries/${DEFAULT_LIBRARY_ID}/` + p.slice("library/".length);
  }
  return null;
}

/**
 * Resolve media under data/, rewriting pre-pack `data/library/...` paths
 * to `data/libraries/default/...`. Prefers a candidate that exists on disk.
 */
export function resolveDataMediaPath(p: string | null | undefined): string {
  if (!p?.trim()) return p || "";
  const raw = p.trim();
  const rewritten = rewriteLegacyLibrarySegment(raw);
  const candidates = rewritten && rewritten !== raw ? [rewritten, raw] : [raw];

  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.join(PATHS.data, c);
    if (existsSync(abs)) return abs;
  }

  const preferred = candidates[0]!;
  return path.isAbsolute(preferred) ? preferred : path.join(PATHS.data, preferred);
}

/** Persistable media path with legacy library segment rewritten when present. */
export function canonicalizeStoredMediaPath(
  p: string | null | undefined,
): string | null {
  if (p == null) return null;
  if (!p.trim()) return p;
  const rewritten = rewriteLegacyLibrarySegment(p.trim());
  if (rewritten) return rewritten;
  return p;
}
