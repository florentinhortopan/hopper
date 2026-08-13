import { mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  CampaignSchema,
  DEFAULT_LIBRARY_ID,
  DesignTokensSchema,
  JobSchema,
  LIBRARY_KINDS,
  LibraryItemSchema,
  ReviewEntrySchema,
  type Campaign,
  type DesignTokens,
  type Job,
  type LibraryItem,
  type ReviewEntry,
} from "@attatta/shared";
import { repairCampaignMediaPaths } from "./campaignMediaRepair.js";
import { PATHS } from "./config.js";
import { ensureDefaultBrandTokens } from "./defaultTokens.js";
import { migrateLegacyLibraryPack, packKindDir } from "./libraryPacks.js";
import { resolveDataMediaPath } from "./mediaPaths.js";

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function ensureDataDirs() {
  for (const dir of [
    PATHS.data,
    PATHS.libraries,
    PATHS.imports,
    PATHS.tokens,
    PATHS.campaigns,
    PATHS.packages,
  ]) {
    await ensureDir(dir);
  }
  // Railway empty/partial volumes: create brand_default_v3 if entrypoint missed it
  await ensureDefaultBrandTokens();
  await migrateLegacyLibraryPack();
  // Compat symlink so absolute `data/library/gen/...` refs still resolve
  const legacyLibrary = path.join(PATHS.data, "library");
  try {
    await stat(legacyLibrary);
  } catch {
    try {
      await symlink(path.join("libraries", DEFAULT_LIBRARY_ID), legacyLibrary);
    } catch {
      /* optional */
    }
  }
  for (const dir of [
    PATHS.talent,
    PATHS.hands,
    PATHS.motion,
    PATHS.attire,
    PATHS.background,
    PATHS.prop,
    PATHS.theme,
    PATHS.copy,
  ]) {
    await ensureDir(dir);
  }
}

function campaignDir(id: string) {
  return path.join(PATHS.campaigns, id);
}

/** Serialize concurrent saves per campaign (same pid shared .tmp was corrupting JSON). */
const saveLocks = new Map<string, Promise<unknown>>();

async function withCampaignLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = saveLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => gate);
  saveLocks.set(id, chained);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (saveLocks.get(id) === chained) saveLocks.delete(id);
  }
}

export class CampaignStoreError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "corrupt" | "invalid",
    readonly campaignId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CampaignStoreError";
  }
}

/** Parse campaign JSON; if file has trailing garbage from a race, keep the first object. */
function parseCampaignJson(raw: string, id: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    try {
      const s = raw.trimStart();
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth += 1;
        else if (c === "}") {
          depth -= 1;
          if (depth === 0) {
            const first = JSON.parse(s.slice(0, i + 1));
            console.warn(`[campaigns] recovered first JSON object for ${id} (trailing garbage trimmed)`);
            return first;
          }
        }
      }
    } catch {
      /* fall through */
    }
    throw new CampaignStoreError(
      `Campaign JSON corrupt: ${id}`,
      "corrupt",
      id,
      firstErr,
    );
  }
}

export async function listCampaigns(opts?: {
  includeArchived?: boolean;
}): Promise<Campaign[]> {
  await ensureDataDirs();
  const ids = await readdir(PATHS.campaigns).catch(() => [] as string[]);
  const out: Campaign[] = [];
  const broken: string[] = [];
  for (const id of ids) {
    if (id.startsWith(".")) continue;
    try {
      out.push(await getCampaign(id));
    } catch (err) {
      broken.push(id);
      console.warn(
        `[campaigns] skip ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (broken.length) {
    console.warn(
      `[campaigns] ${broken.length} unreadable campaign(s): ${broken.join(", ")}`,
    );
  }
  const filtered = opts?.includeArchived
    ? out
    : out.filter((c) => !c.archived);
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteCampaign(id: string): Promise<void> {
  await withCampaignLock(id, async () => {
    await rm(campaignDir(id), { recursive: true, force: true });
  });
}

export async function getCampaign(id: string): Promise<Campaign> {
  const file = path.join(campaignDir(id), "campaign.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new CampaignStoreError(`Campaign not found: ${id}`, "not_found", id);
  }
  let data: unknown;
  try {
    data = parseCampaignJson(raw, id);
  } catch (err) {
    if (err instanceof CampaignStoreError) throw err;
    throw new CampaignStoreError(`Campaign JSON corrupt: ${id}`, "corrupt", id, err);
  }
  let campaign: Campaign;
  try {
    campaign = CampaignSchema.parse(data);
  } catch (err) {
    throw new CampaignStoreError(
      `Campaign schema invalid: ${id}`,
      "invalid",
      id,
      err,
    );
  }
  if (repairCampaignMediaPaths(campaign)) {
    try {
      campaign = await saveCampaign(campaign);
      console.log(`[campaigns] repaired media paths for ${id}`);
    } catch (err) {
      console.warn(
        `[campaigns] media repair save failed for ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return campaign;
}

export async function saveCampaign(campaign: Campaign): Promise<Campaign> {
  return withCampaignLock(campaign.id, async () => {
    const dir = campaignDir(campaign.id);
    await ensureDir(dir);
    await ensureDir(path.join(dir, "outputs"));
    await ensureDir(path.join(dir, "previews"));
    const next = { ...campaign, updatedAt: new Date().toISOString() };
    CampaignSchema.parse(next);
    const file = path.join(dir, "campaign.json");
    // Unique tmp per write — concurrent same-pid saves previously shared one tmp and concatenated JSON
    const tmp = `${file}.${process.pid}.${nanoid(8)}.tmp`;
    const payload = `${JSON.stringify(next, null, 2)}\n`;
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, file);
    return next;
  });
}

export async function getReviews(campaignId: string): Promise<ReviewEntry[]> {
  const file = path.join(campaignDir(campaignId), "review-manifest.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return raw.map((r: unknown) => ReviewEntrySchema.parse(r));
  } catch {
    return [];
  }
}

export async function saveReviews(campaignId: string, reviews: ReviewEntry[]) {
  const file = path.join(campaignDir(campaignId), "review-manifest.json");
  await writeFile(file, JSON.stringify(reviews, null, 2));
}

export async function getTokens(id: string): Promise<DesignTokens> {
  await ensureDefaultBrandTokens();
  const file = path.join(PATHS.tokens, `${id}.json`);
  try {
    return DesignTokensSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(
        `Design token pack "${id}" not found at ${file}. Expected brand_default_v3 (or upload a pack under data/tokens/).`,
      );
    }
    throw err;
  }
}

export async function listTokenPacks(): Promise<DesignTokens[]> {
  await ensureDataDirs();
  const files = await readdir(PATHS.tokens);
  const out: DesignTokens[] = [];
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    out.push(await getTokens(f.replace(/\.json$/, "")));
  }
  return out;
}

async function readKindInPack(
  kind: LibraryItem["kind"],
  libraryId: string,
): Promise<LibraryItem[]> {
  const metaPath = path.join(packKindDir(libraryId, kind), "index.json");
  try {
    const raw = JSON.parse(await readFile(metaPath, "utf8"));
    return raw.map((item: unknown) => LibraryItemSchema.parse(item));
  } catch {
    return [];
  }
}

export async function listLibrary(
  kind?: LibraryItem["kind"],
  libraryId = DEFAULT_LIBRARY_ID,
) {
  if (kind) return readKindInPack(kind, libraryId);
  const lists = await Promise.all(
    LIBRARY_KINDS.map((k) => readKindInPack(k, libraryId)),
  );
  return lists.flat();
}

export function libraryAbsolutePath(item: LibraryItem): string {
  return resolveDataMediaPath(item.path);
}

const jobs = new Map<string, Job>();

export function upsertJob(job: Job) {
  const parsed = JobSchema.parse(job);
  jobs.set(parsed.id, parsed);
  return parsed;
}

export function getJob(id: string) {
  return jobs.get(id) ?? null;
}

export function listJobs(campaignId?: string) {
  const all = [...jobs.values()];
  return campaignId ? all.filter((j) => j.campaignId === campaignId) : all;
}

export function campaignOutputPath(
  campaignId: string,
  cellId: string,
  stage: "preview" | "render",
  sizeId = "v_9x16_1080",
  copyId?: string | null,
) {
  const dir = path.join(campaignDir(campaignId), stage === "preview" ? "previews" : "outputs");
  const copyPart = copyId?.trim() ? `__${copyId.trim()}` : "";
  return path.join(dir, `${cellId}${copyPart}__${sizeId}.mp4`);
}
