import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./config.js";

export type PlateCacheEntry = {
  promptHash: string;
  assetPath: string;
  workflowId: string;
  modelProfileId: string;
  knob: string;
  sizeId: string;
  createdAt: string;
  cellId?: string;
};

type PlateCacheFile = {
  version: 1;
  entries: Record<string, PlateCacheEntry>;
};

function cachePath() {
  return path.join(PATHS.library, "gen", "plate-cache.json");
}

async function loadCache(): Promise<PlateCacheFile> {
  try {
    const raw = JSON.parse(await readFile(cachePath(), "utf8")) as PlateCacheFile;
    if (raw?.version === 1 && raw.entries) return raw;
  } catch {
    /* miss */
  }
  return { version: 1, entries: {} };
}

async function saveCache(cache: PlateCacheFile) {
  await mkdir(path.dirname(cachePath()), { recursive: true });
  await writeFile(cachePath(), JSON.stringify(cache, null, 2));
}

async function fileExists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Lookup a reusable plate by prompt hash (ingredient + size + context). */
export async function lookupPlateCache(
  promptHash: string,
): Promise<PlateCacheEntry | null> {
  if (!promptHash) return null;
  const cache = await loadCache();
  const hit = cache.entries[promptHash];
  if (!hit?.assetPath) return null;
  if (!(await fileExists(hit.assetPath))) {
    delete cache.entries[promptHash];
    await saveCache(cache);
    return null;
  }
  return hit;
}

export async function putPlateCache(entry: PlateCacheEntry): Promise<void> {
  const cache = await loadCache();
  cache.entries[entry.promptHash] = entry;
  await saveCache(cache);
}
