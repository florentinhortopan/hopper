import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nanoid } from "nanoid";
import unzipper from "unzipper";
import {
  ImportSessionSchema,
  type ImportRow,
  type ImportSession,
  type ImportSource,
  type Job,
  type LibraryKind,
} from "@attatta/shared";
import { PATHS } from "./config.js";
import {
  isMediaFilename,
  listDropboxFolder,
  listFrameioFolder,
  listLocalFolder,
  pullHttpsUrl,
  type ConnectorEntry,
} from "./importConnectors.js";
import { classifyIngredientMedia } from "./llmClient.js";
import { createLibraryIngredient } from "./library.js";
import {
  attachJobControl,
  finishJobControl,
  isCancelledError,
  JobCancelledError,
} from "./jobControl.js";
import { getJob, upsertJob } from "./store.js";

function sessionDir(importId: string) {
  return path.join(PATHS.imports, importId);
}

function sessionPath(importId: string) {
  return path.join(sessionDir(importId), "session.json");
}

function filesDir(importId: string) {
  return path.join(sessionDir(importId), "files");
}

/** Absolute path to staged import files (for magic workflow detection). */
export function getImportSessionFilesDir(importId: string) {
  return filesDir(importId);
}

export async function loadImportSession(
  importId: string,
): Promise<ImportSession | null> {
  try {
    const raw = JSON.parse(await readFile(sessionPath(importId), "utf8"));
    return ImportSessionSchema.parse(raw);
  } catch {
    return null;
  }
}

async function saveImportSession(session: ImportSession) {
  const next = ImportSessionSchema.parse({
    ...session,
    updatedAt: new Date().toISOString(),
  });
  await mkdir(sessionDir(next.id), { recursive: true });
  await writeFile(sessionPath(next.id), JSON.stringify(next, null, 2));
  return next;
}

async function extractZip(zipAbs: string, destDir: string) {
  await mkdir(destDir, { recursive: true });
  const directory = await unzipper.Open.file(zipAbs);
  await directory.extract({ path: destDir });
}

async function collectMediaFiles(
  root: string,
  baseRel = "",
): Promise<Array<{ abs: string; rel: string; name: string }>> {
  const out: Array<{ abs: string; rel: string; name: string }> = [];
  async function walk(dir: string, relBase: string) {
    for (const name of await readdir(dir)) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const s = await stat(abs);
      if (s.isDirectory()) await walk(abs, rel);
      else if (isMediaFilename(name)) out.push({ abs, rel, name });
    }
  }
  await walk(root, baseRel);
  return out;
}

function extractPosterFrames(mediaAbs: string, outDir: string): string[] {
  const ext = path.extname(mediaAbs).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
  spawnSync("mkdir", ["-p", outDir], { stdio: "ignore" });
  if (isImage) {
    const dest = path.join(outDir, `frame${ext}`);
    const res = spawnSync("cp", [mediaAbs, dest], { stdio: "ignore" });
    return res.status === 0 ? [dest] : [];
  }
  const frames: string[] = [];
  for (const [i, ss] of ["00:00:01", "00:00:03"].entries()) {
    const dest = path.join(outDir, `frame_${i}.jpg`);
    const res = spawnSync(
      "ffmpeg",
      ["-y", "-ss", ss, "-i", mediaAbs, "-frames:v", "1", "-q:v", "3", dest],
      { stdio: "ignore" },
    );
    if (res.status === 0) frames.push(dest);
  }
  return frames;
}

async function downloadEntries(
  entries: ConnectorEntry[],
  destRoot: string,
  onProgress?: (p: number, message: string) => void,
  signal?: AbortSignal,
) {
  let i = 0;
  const rowsMeta: Array<{
    rel: string;
    name: string;
    remoteRef?: ImportRow["remoteRef"];
  }> = [];
  for (const ent of entries) {
    if (signal?.aborted) throw new JobCancelledError();
    const dest = path.join(destRoot, ent.relativePath);
    await mkdir(path.dirname(dest), { recursive: true });
    // Skip if already downloaded (re-sync)
    const exists = await stat(dest).then(() => true).catch(() => false);
    let remoteRef: ImportRow["remoteRef"];
    if (!exists) {
      remoteRef = (await ent.download(dest)) || undefined;
    }
    rowsMeta.push({
      rel: ent.relativePath,
      name: ent.name,
      remoteRef,
    });
    i += 1;
    onProgress?.(
      Math.min(0.45, (i / Math.max(entries.length, 1)) * 0.45),
      `Downloaded ${i}/${entries.length}`,
    );
  }
  return rowsMeta;
}

export async function createImportSession(opts: {
  libraryId: string;
  source: ImportSource;
  autoClassify?: boolean;
  /** Multipart files already written to a temp dir */
  uploadedFilesDir?: string;
  zipBuffer?: Buffer;
  zipFilename?: string;
}): Promise<{ session: ImportSession; job: Job }> {
  const id = nanoid(10);
  const now = new Date().toISOString();
  let session = ImportSessionSchema.parse({
    id,
    libraryId: opts.libraryId,
    source: opts.source,
    status: "staging",
    autoClassify: opts.autoClassify !== false,
    progress: 0,
    message: "Staging…",
    jobId: null,
    rows: [],
    createdAt: now,
    updatedAt: now,
  });

  const job: Job = {
    id: nanoid(10),
    campaignId: `_library_import_${opts.libraryId}`,
    cellId: null,
    copyId: null,
    sizeId: null,
    width: null,
    height: null,
    stage: "ingredient_gen",
    status: "queued",
    progress: 0,
    message: "Library import staging",
    resultPath: null,
    etaSeconds: 120,
    createdAt: now,
    updatedAt: now,
  };
  session.jobId = job.id;
  await saveImportSession(session);
  upsertJob(job);
  const signal = attachJobControl(job.id);

  void (async () => {
    try {
      upsertJob({
        ...job,
        status: "running",
        progress: 0.05,
        message: "Pulling media…",
        updatedAt: new Date().toISOString(),
      });
      const filesRoot = filesDir(id);
      await mkdir(filesRoot, { recursive: true });

      const touch = async (progress: number, message: string) => {
        session = await saveImportSession({
          ...session,
          progress,
          message,
          status: session.status === "staging" ? "staging" : session.status,
        });
        upsertJob({
          ...getJob(job.id)!,
          status: "running",
          progress,
          message,
          updatedAt: new Date().toISOString(),
        });
      };

      if (opts.zipBuffer) {
        const zipAbs = path.join(sessionDir(id), opts.zipFilename || "upload.zip");
        await writeFile(zipAbs, opts.zipBuffer);
        await extractZip(zipAbs, filesRoot);
        await touch(0.35, "Zip extracted");
      } else if (opts.uploadedFilesDir) {
        await copyTree(opts.uploadedFilesDir, filesRoot);
        await touch(0.35, "Files staged");
      } else if (opts.source.type === "folder") {
        const entries = await listLocalFolder(opts.source.folderPath);
        await downloadEntries(entries, filesRoot, touch, signal);
      } else if (opts.source.type === "dropbox") {
        const entries = await listDropboxFolder(opts.source.dropboxPath);
        await downloadEntries(entries, filesRoot, touch, signal);
      } else if (opts.source.type === "frameio") {
        const entries = await listFrameioFolder(opts.source.frameioFolderId);
        await downloadEntries(entries, filesRoot, touch, signal);
      } else if (opts.source.type === "https") {
        const staged = path.join(sessionDir(id), "https");
        await mkdir(staged, { recursive: true });
        await pullHttpsUrl(opts.source.remoteUrl, staged);
        const zipMarker = path.join(staged, ".https-zip");
        try {
          const zipName = (await readFile(zipMarker, "utf8")).trim();
          await extractZip(path.join(staged, zipName), filesRoot);
        } catch {
          await copyTree(staged, filesRoot);
        }
        await touch(0.35, "Remote URL pulled");
      }

      if (signal.aborted) throw new JobCancelledError(job.id);

      const media = await collectMediaFiles(filesRoot);
      const rows: ImportRow[] = media.map((m) => ({
        id: nanoid(8),
        file: m.rel,
        originalName: m.name,
        suggestedKind: "prop" as LibraryKind,
        label: m.name.replace(/\.[^.]+$/, ""),
        tags: [],
        promptHint: "",
        confidence: 0,
        rationale: "",
        mediaType: [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(
          path.extname(m.name).toLowerCase(),
        )
          ? ("image" as const)
          : ("video" as const),
        status: "pending" as const,
        error: null,
      }));
      session = await saveImportSession({
        ...session,
        rows,
        progress: 0.4,
        message: `Found ${rows.length} media files`,
        status: opts.autoClassify !== false ? "classifying" : "review",
      });

      if (opts.autoClassify !== false && rows.length) {
        await classifyImportSession(id, (p, message) => {
          void touch(0.4 + p * 0.55, message);
        }, signal);
      } else {
        session = await saveImportSession({
          ...session,
          status: "review",
          progress: 1,
          message: "Ready for review",
        });
      }

      const final = await loadImportSession(id);
      upsertJob({
        ...getJob(job.id)!,
        status: "done",
        progress: 1,
        message: final?.message || "Import ready for review",
        updatedAt: new Date().toISOString(),
      });
      finishJobControl(job.id);
    } catch (err) {
      if (isCancelledError(err) || signal.aborted) {
        await saveImportSession({
          ...(await loadImportSession(id))!,
          status: "cancelled",
          message: "Cancelled",
          progress: 1,
        });
        if (getJob(job.id)?.status !== "cancelled") {
          upsertJob({
            ...getJob(job.id)!,
            status: "cancelled",
            progress: 1,
            message: "Cancelled",
            updatedAt: new Date().toISOString(),
          });
        }
        finishJobControl(job.id);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await saveImportSession({
        ...(await loadImportSession(id))!,
        status: "failed",
        message: msg,
        progress: 1,
      });
      upsertJob({
        ...getJob(job.id)!,
        status: "failed",
        progress: 1,
        message: msg,
        updatedAt: new Date().toISOString(),
      });
      finishJobControl(job.id);
    }
  })();

  return { session, job };
}

async function copyTree(src: string, dest: string) {
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(src)) {
    if (name.startsWith(".")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const s = await stat(from);
    if (s.isDirectory()) await copyTree(from, to);
    else {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
  }
}

export async function classifyImportSession(
  importId: string,
  onProgress?: (p: number, message: string) => void,
  signal?: AbortSignal,
) {
  let session = await loadImportSession(importId);
  if (!session) throw new Error("Import session not found");
  session = await saveImportSession({
    ...session,
    status: "classifying",
    message: "Classifying…",
  });
  const root = filesDir(importId);
  const framesRoot = path.join(sessionDir(importId), "frames");
  const rows = [...session.rows];
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) throw new JobCancelledError();
    const row = rows[i]!;
    const abs = path.join(root, row.file);
    const frameDir = path.join(framesRoot, row.id);
    await mkdir(frameDir, { recursive: true });
    const frames = extractPosterFrames(abs, frameDir);
    const result = await classifyIngredientMedia({
      filename: row.originalName,
      framePaths: frames,
    });
    rows[i] = {
      ...row,
      suggestedKind: result.kind,
      label: result.label || row.label,
      tags: result.tags,
      promptHint: result.promptHint || row.label,
      confidence: result.confidence,
      rationale: result.rationale,
    };
    onProgress?.(
      (i + 1) / Math.max(rows.length, 1),
      `Classified ${i + 1}/${rows.length}: ${result.kind}`,
    );
  }
  return saveImportSession({
    ...session,
    rows,
    status: "review",
    progress: 1,
    message: "Ready for review",
  });
}

export async function patchImportRows(
  importId: string,
  patches: Array<Partial<ImportRow> & { id: string }>,
) {
  const session = await loadImportSession(importId);
  if (!session) throw new Error("Import session not found");
  const byId = new Map(patches.map((p) => [p.id, p]));
  const rows = session.rows.map((r) => {
    const p = byId.get(r.id);
    if (!p) return r;
    return { ...r, ...p, id: r.id };
  });
  return saveImportSession({ ...session, rows, status: "review" });
}

export async function commitImportSession(importId: string) {
  let session = await loadImportSession(importId);
  if (!session) throw new Error("Import session not found");
  session = await saveImportSession({
    ...session,
    status: "committing",
    message: "Committing accepted rows…",
  });
  const root = filesDir(importId);
  const accepted = session.rows.filter((r) => r.status === "accepted");
  let n = 0;
  for (const row of accepted) {
    const abs = path.join(root, row.file);
    const buf = await readFile(abs);
    await createLibraryIngredient({
      kind: row.suggestedKind,
      label: row.label || row.originalName,
      tags: row.tags,
      promptHint: row.promptHint || row.label,
      filename: row.originalName,
      buffer: buf,
      libraryId: session.libraryId,
      allowNoMedia: false,
    });
    n += 1;
  }
  return saveImportSession({
    ...session,
    status: "done",
    progress: 1,
    message: `Committed ${n} plate(s) into library ${session.libraryId}`,
  });
}

export async function resyncImportSession(importId: string) {
  const session = await loadImportSession(importId);
  if (!session) throw new Error("Import session not found");
  const src = session.source;
  if (
    src.type !== "dropbox" &&
    src.type !== "frameio" &&
    src.type !== "folder" &&
    src.type !== "https"
  ) {
    throw new Error("Re-sync only supported for remote / folder sources");
  }
  // Start a fresh import with same source into same library
  return createImportSession({
    libraryId: session.libraryId,
    source: src,
    autoClassify: session.autoClassify,
  });
}
