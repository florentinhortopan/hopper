import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  DEFAULT_LIBRARY_ID,
  LIBRARY_KINDS,
  LibraryPackSchema,
  type LibraryKind,
  type LibraryPack,
} from "@attatta/shared";
import { PATHS } from "./config.js";

const KIND_DIRS = LIBRARY_KINDS;

function packsIndexPath() {
  return path.join(PATHS.libraries, "index.json");
}

export function packRoot(libraryId: string) {
  return path.join(PATHS.libraries, libraryId);
}

export function packKindDir(libraryId: string, kind: LibraryKind) {
  return path.join(packRoot(libraryId), kind);
}

export function packRelPrefix(libraryId: string) {
  return `libraries/${libraryId}`;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function writePackIndex(packs: LibraryPack[]) {
  await ensureDir(PATHS.libraries);
  await writeFile(packsIndexPath(), JSON.stringify(packs, null, 2));
}

export async function listLibraryPacks(): Promise<LibraryPack[]> {
  await ensureDir(PATHS.libraries);
  try {
    const raw = JSON.parse(await readFile(packsIndexPath(), "utf8"));
    return (raw as unknown[]).map((p) => LibraryPackSchema.parse(p));
  } catch {
    return [];
  }
}

export async function getLibraryPack(id: string): Promise<LibraryPack | null> {
  const packs = await listLibraryPacks();
  return packs.find((p) => p.id === id) ?? null;
}

async function emptyKindIndexes(libraryId: string) {
  for (const kind of KIND_DIRS) {
    const dir = packKindDir(libraryId, kind);
    await ensureDir(dir);
    const idx = path.join(dir, "index.json");
    try {
      await readFile(idx, "utf8");
    } catch {
      await writeFile(idx, "[]");
    }
  }
}

export async function createLibraryPack(opts: {
  id?: string;
  name: string;
  version?: string;
  notes?: string;
}): Promise<LibraryPack> {
  const packs = await listLibraryPacks();
  const id =
    opts.id?.trim() ||
    opts.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) ||
    nanoid(8);
  if (packs.some((p) => p.id === id)) {
    throw new Error(`Library pack already exists: ${id}`);
  }
  const now = new Date().toISOString();
  const pack = LibraryPackSchema.parse({
    id,
    name: opts.name.trim() || id,
    version: opts.version || "1.0.0",
    notes: opts.notes || "",
    createdAt: now,
    updatedAt: now,
  });
  await emptyKindIndexes(id);
  await writeFile(
    path.join(packRoot(id), "manifest.json"),
    JSON.stringify(pack, null, 2),
  );
  packs.push(pack);
  await writePackIndex(packs);
  return pack;
}

export async function updateLibraryPack(
  id: string,
  patch: Partial<Pick<LibraryPack, "name" | "version" | "notes">>,
): Promise<LibraryPack> {
  const packs = await listLibraryPacks();
  const idx = packs.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`Library pack not found: ${id}`);
  const next = LibraryPackSchema.parse({
    ...packs[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  packs[idx] = next;
  await writeFile(
    path.join(packRoot(id), "manifest.json"),
    JSON.stringify(next, null, 2),
  );
  await writePackIndex(packs);
  return next;
}

async function copyDir(src: string, dest: string) {
  await ensureDir(dest);
  const entries = await readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(from, to);
    else await copyFile(from, to);
  }
}

export async function duplicateLibraryPack(
  sourceId: string,
  opts?: { name?: string; version?: string },
): Promise<LibraryPack> {
  const src = await getLibraryPack(sourceId);
  if (!src) throw new Error(`Library pack not found: ${sourceId}`);
  const newId = `${sourceId}_v${nanoid(4)}`;
  const pack = await createLibraryPack({
    id: newId,
    name: opts?.name || `${src.name} (copy)`,
    version: opts?.version || bumpVersion(src.version),
    notes: `Duplicated from ${sourceId} @ ${src.version}`,
  });
  // Overwrite empty dirs with full copy
  await rm(packRoot(newId), { recursive: true, force: true });
  await copyDir(packRoot(sourceId), packRoot(newId));
  // Rewrite media paths in indexes
  for (const kind of KIND_DIRS) {
    const idxPath = path.join(packKindDir(newId, kind), "index.json");
    try {
      const items = JSON.parse(await readFile(idxPath, "utf8")) as Array<{
        path?: string;
      }>;
      const prefixOld = `libraries/${sourceId}/`;
      const prefixLegacy = "library/";
      const prefixNew = `libraries/${newId}/`;
      for (const item of items) {
        if (!item.path) continue;
        if (item.path.startsWith(prefixOld)) {
          item.path = prefixNew + item.path.slice(prefixOld.length);
        } else if (item.path.startsWith(prefixLegacy)) {
          item.path = prefixNew + item.path.slice(prefixLegacy.length);
        }
      }
      await writeFile(idxPath, JSON.stringify(items, null, 2));
    } catch {
      /* empty */
    }
  }
  await writeFile(
    path.join(packRoot(newId), "manifest.json"),
    JSON.stringify(pack, null, 2),
  );
  return pack;
}

function bumpVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return `${v}-copy`;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * Move legacy `data/library` → `data/libraries/default` and rewrite index paths.
 * Safe to call repeatedly.
 */
export async function migrateLegacyLibraryPack(): Promise<void> {
  await ensureDir(PATHS.libraries);
  await ensureDir(PATHS.imports);

  const legacyRoot = path.join(PATHS.data, "library");
  const defaultRoot = packRoot(DEFAULT_LIBRARY_ID);
  let packs = await listLibraryPacks();

  const legacyExists = await stat(legacyRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);
  const defaultExists = await stat(defaultRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (legacyExists && !defaultExists) {
    await rename(legacyRoot, defaultRoot);
  } else if (legacyExists && defaultExists) {
    // Already migrated; leave legacy alone if still present
  } else if (!defaultExists) {
    await emptyKindIndexes(DEFAULT_LIBRARY_ID);
  }

  // Rewrite paths library/ → libraries/default/
  if (await stat(defaultRoot).then(() => true).catch(() => false)) {
    for (const kind of KIND_DIRS) {
      const idxPath = path.join(packKindDir(DEFAULT_LIBRARY_ID, kind), "index.json");
      try {
        const items = JSON.parse(await readFile(idxPath, "utf8")) as Array<{
          path?: string;
        }>;
        let dirty = false;
        for (const item of items) {
          if (item.path?.startsWith("library/")) {
            item.path = `libraries/${DEFAULT_LIBRARY_ID}/` + item.path.slice("library/".length);
            dirty = true;
          }
        }
        if (dirty) await writeFile(idxPath, JSON.stringify(items, null, 2));
      } catch {
        await ensureDir(packKindDir(DEFAULT_LIBRARY_ID, kind));
        await writeFile(idxPath, "[]");
      }
    }
  }

  packs = await listLibraryPacks();
  if (!packs.some((p) => p.id === DEFAULT_LIBRARY_ID)) {
    const now = new Date().toISOString();
    const pack = LibraryPackSchema.parse({
      id: DEFAULT_LIBRARY_ID,
      name: "Default library",
      version: "1.0.0",
      notes: "Migrated from legacy data/library",
      createdAt: now,
      updatedAt: now,
    });
    await writeFile(
      path.join(defaultRoot, "manifest.json"),
      JSON.stringify(pack, null, 2),
    );
    packs.unshift(pack);
    await writePackIndex(packs);
  }
}
