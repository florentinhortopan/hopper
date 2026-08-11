import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export type ComfyTarget = {
  baseUrl: string;
  apiKey?: string;
  /** cloud.comfy.org uses /api/* and job status polling */
  isCloud: boolean;
};

export function resolveComfyTarget(): ComfyTarget {
  const baseUrl = (process.env.COMFY_BASE_URL || "http://127.0.0.1:8188").replace(
    /\/$/,
    "",
  );
  const apiKey = process.env.COMFY_API_KEY || process.env.COMFY_CLOUD_API_KEY;
  const isCloud = /cloud\.comfy\.org/i.test(baseUrl);
  return { baseUrl, apiKey, isCloud };
}

function headers(target: ComfyTarget, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (target.apiKey) h["X-API-Key"] = target.apiKey;
  return h;
}

function apiPath(target: ComfyTarget, p: string) {
  if (target.isCloud) {
    if (p.startsWith("/api/")) return `${target.baseUrl}${p}`;
    return `${target.baseUrl}/api${p.startsWith("/") ? p : `/${p}`}`;
  }
  return `${target.baseUrl}${p.startsWith("/") ? p : `/${p}`}`;
}

export async function comfyHealth(target = resolveComfyTarget()): Promise<{
  ok: boolean;
  mode: "cloud" | "local";
  detail: unknown;
}> {
  try {
    if (target.isCloud) {
      const res = await fetch(apiPath(target, "/user"), {
        headers: headers(target),
      });
      const detail = await res.json().catch(() => ({}));
      return { ok: res.ok, mode: "cloud", detail };
    }
    const res = await fetch(apiPath(target, "/system_stats"), {
      headers: headers(target),
    });
    const detail = await res.json().catch(() => ({}));
    return { ok: res.ok, mode: "local", detail };
  } catch (err) {
    return {
      ok: false,
      mode: target.isCloud ? "cloud" : "local",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function queuePrompt(
  target: ComfyTarget,
  prompt: Record<string, unknown>,
  clientId: string,
): Promise<string> {
  const body: Record<string, unknown> = { prompt, client_id: clientId };
  // Partner nodes (Bria, MiniMax, …) auth via extra_data — X-API-Key alone is not enough
  if (target.apiKey) {
    body.extra_data = { api_key_comfy_org: target.apiKey };
  }
  const res = await fetch(apiPath(target, "/prompt"), {
    method: "POST",
    headers: headers(target, true),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    prompt_id?: string;
    error?: unknown;
    node_errors?: unknown;
  };
  if (!res.ok || !data.prompt_id) {
    throw new Error(
      `Comfy /prompt failed (${res.status}): ${JSON.stringify(data.error || data.node_errors || data)}`,
    );
  }
  return data.prompt_id;
}

const DONE = new Set(["completed", "success"]);
const FAIL = new Set(["failed", "cancelled", "error"]);

export type ComfyWaitTick = {
  status: string;
  elapsedMs: number;
  /** Soft 0–1 within the wait (Cloud status has no %). */
  softProgress: number;
};

export async function cancelComfyJob(
  target: ComfyTarget,
  promptId: string,
): Promise<void> {
  // Prefer unified cancel (Cloud / newer Comfy), then legacy pending + interrupt
  const attempts: Array<() => Promise<Response>> = [
    () =>
      fetch(apiPath(target, `/jobs/${promptId}/cancel`), {
        method: "POST",
        headers: headers(target, true),
        body: "{}",
      }),
    () =>
      fetch(apiPath(target, "/queue"), {
        method: "POST",
        headers: headers(target, true),
        body: JSON.stringify({ delete: [promptId] }),
      }),
    () =>
      fetch(apiPath(target, "/interrupt"), {
        method: "POST",
        headers: headers(target, true),
        body: JSON.stringify({ prompt_id: promptId }),
      }),
  ];
  for (const run of attempts) {
    try {
      const res = await run();
      if (res.ok || res.status === 404) return;
    } catch {
      /* try next */
    }
  }
}

export async function waitForJob(
  target: ComfyTarget,
  promptId: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    /** Abort waiting + best-effort Comfy cancel */
    signal?: AbortSignal;
    /** Called each poll — use for Job UI (status + soft ETA progress). */
    onTick?: (tick: ComfyWaitTick) => void;
  },
): Promise<void> {
  // Video partner jobs commonly exceed 5 minutes
  const timeoutMs = opts?.timeoutMs ?? 900_000;
  const pollMs = opts?.pollMs ?? 3000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (opts?.signal?.aborted) {
      await cancelComfyJob(target, promptId).catch(() => undefined);
      const err = new Error(`Comfy job cancelled: ${promptId}`);
      err.name = "JobCancelledError";
      throw err;
    }
    const elapsedMs = Date.now() - start;
    let status = "waiting";
    if (target.isCloud) {
      const res = await fetch(apiPath(target, `/job/${promptId}/status`), {
        headers: headers(target),
      });
      const data = (await res.json()) as { status?: string; error_message?: string };
      status = data.status || "";
      if (DONE.has(status)) return;
      if (FAIL.has(status)) {
        if (status === "cancelled") {
          const err = new Error(`Comfy job cancelled: ${promptId}`);
          err.name = "JobCancelledError";
          throw err;
        }
        throw new Error(`Comfy job ${status}: ${data.error_message || promptId}`);
      }
    } else {
      const res = await fetch(apiPath(target, `/history/${promptId}`), {
        headers: headers(target),
      });
      const hist = (await res.json()) as Record<string, unknown>;
      if (hist[promptId]) return;
      status = "in_progress";
    }
    // Cap soft progress under 1 so completion still jumps visibly
    const softProgress = Math.min(0.92, elapsedMs / Math.max(timeoutMs * 0.35, 60_000));
    opts?.onTick?.({ status, elapsedMs, softProgress });
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Comfy job timed out after ${timeoutMs}ms: ${promptId}`);
}

export type ComfyOutputFile = {
  filename: string;
  subfolder: string;
  type: string;
};

export async function listJobOutputs(
  target: ComfyTarget,
  promptId: string,
): Promise<ComfyOutputFile[]> {
  if (target.isCloud) {
    const res = await fetch(apiPath(target, `/jobs/${promptId}`), {
      headers: headers(target),
    });
    const job = (await res.json()) as {
      outputs?: Record<string, { images?: ComfyOutputFile[]; gifs?: ComfyOutputFile[]; videos?: ComfyOutputFile[] }>;
      status?: string;
    };
    const videos: ComfyOutputFile[] = [];
    const gifs: ComfyOutputFile[] = [];
    const images: ComfyOutputFile[] = [];
    for (const node of Object.values(job.outputs || {})) {
      for (const f of node.videos || []) {
        videos.push({
          filename: f.filename,
          subfolder: f.subfolder || "",
          type: f.type || "output",
        });
      }
      for (const f of node.gifs || []) {
        gifs.push({
          filename: f.filename,
          subfolder: f.subfolder || "",
          type: f.type || "output",
        });
      }
      for (const f of node.images || []) {
        images.push({
          filename: f.filename,
          subfolder: f.subfolder || "",
          type: f.type || "output",
        });
      }
    }
    // Prefer real video outputs over stills
    return [...videos, ...gifs, ...images];
  }

  const res = await fetch(apiPath(target, `/history/${promptId}`), {
    headers: headers(target),
  });
  const hist = (await res.json()) as Record<
    string,
    {
      outputs?: Record<
        string,
        { images?: ComfyOutputFile[]; gifs?: ComfyOutputFile[]; videos?: ComfyOutputFile[] }
      >;
    }
  >;
  const entry = hist[promptId];
  const videos: ComfyOutputFile[] = [];
  const gifs: ComfyOutputFile[] = [];
  const images: ComfyOutputFile[] = [];
  for (const node of Object.values(entry?.outputs || {})) {
    for (const f of node.videos || []) {
      videos.push({
        filename: f.filename,
        subfolder: f.subfolder || "",
        type: f.type || "output",
      });
    }
    for (const f of node.gifs || []) {
      gifs.push({
        filename: f.filename,
        subfolder: f.subfolder || "",
        type: f.type || "output",
      });
    }
    for (const f of node.images || []) {
      images.push({
        filename: f.filename,
        subfolder: f.subfolder || "",
        type: f.type || "output",
      });
    }
  }
  return [...videos, ...gifs, ...images];
}

export async function downloadOutput(
  target: ComfyTarget,
  file: ComfyOutputFile,
  destPath: string,
): Promise<void> {
  const qs = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || "output",
  });
  const res = await fetch(apiPath(target, `/view?${qs}`), {
    headers: headers(target),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Comfy /view failed (${res.status}) for ${file.filename}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
}

export function hashWorkflow(prompt: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(prompt)).digest("hex").slice(0, 16);
}

export function newClientId() {
  return nanoid(16);
}

export type ComfyUploadResult = {
  name: string;
  subfolder: string;
  type: string;
};

/** Upload a local image into Comfy input storage (local or cloud). */
export async function uploadImage(
  target: ComfyTarget,
  localPath: string,
  opts?: { overwrite?: boolean; subfolder?: string },
): Promise<ComfyUploadResult> {
  const buf = await readFile(localPath);
  const filename = path.basename(localPath);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)]), filename);
  form.append("overwrite", opts?.overwrite === false ? "false" : "true");
  form.append("type", "input");
  if (opts?.subfolder) form.append("subfolder", opts.subfolder);

  const res = await fetch(apiPath(target, "/upload/image"), {
    method: "POST",
    headers: headers(target), // no Content-Type — boundary set by fetch
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ComfyUploadResult> & {
    error?: unknown;
  };
  if (!res.ok || !data.name) {
    throw new Error(
      `Comfy /upload/image failed (${res.status}): ${JSON.stringify(data.error || data)}`,
    );
  }
  return {
    name: data.name,
    subfolder: data.subfolder || "",
    type: data.type || "input",
  };
}

/** LoadImage / LoadVideo filename field: prefer subfolder/name when present. */
export function comfyImageRef(upload: ComfyUploadResult): string {
  if (upload.subfolder) return `${upload.subfolder}/${upload.name}`.replace(/\/+/g, "/");
  return upload.name;
}

export const comfyVideoRef = comfyImageRef;

/**
 * Upload a local video into Comfy input storage.
 * Cloud accepts video via /upload/image (same multipart contract as images).
 */
export async function uploadVideo(
  target: ComfyTarget,
  localPath: string,
  opts?: { overwrite?: boolean; subfolder?: string },
): Promise<ComfyUploadResult> {
  const buf = await readFile(localPath);
  const filename = path.basename(localPath);
  const buildForm = () => {
    const form = new FormData();
    // Cloud accepts video bytes on /upload/image (field name stays "image")
    form.append("image", new Blob([new Uint8Array(buf)]), filename);
    form.append("overwrite", opts?.overwrite === false ? "false" : "true");
    form.append("type", "input");
    if (opts?.subfolder) form.append("subfolder", opts.subfolder);
    return form;
  };

  const tryPaths = ["/upload/image", "/upload/video"] as const;
  let lastErr: Error | null = null;
  for (const p of tryPaths) {
    try {
      const res = await fetch(apiPath(target, p), {
        method: "POST",
        headers: headers(target),
        body: buildForm(),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ComfyUploadResult> & {
        error?: unknown;
      };
      if (res.ok && data.name) {
        return {
          name: data.name,
          subfolder: data.subfolder || "",
          type: data.type || "input",
        };
      }
      lastErr = new Error(
        `Comfy ${p} failed (${res.status}): ${JSON.stringify(data.error || data)}`,
      );
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error(`Comfy video upload failed for ${filename}`);
}

export function isVideoFilename(name: string): boolean {
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(name);
}

let objectInfoCache: Record<string, unknown> | null = null;

export async function getObjectInfo(
  target = resolveComfyTarget(),
): Promise<Record<string, unknown>> {
  if (objectInfoCache) return objectInfoCache;
  try {
    const res = await fetch(apiPath(target, "/object_info"), {
      headers: headers(target),
    });
    if (!res.ok) return {};
    objectInfoCache = (await res.json()) as Record<string, unknown>;
    return objectInfoCache;
  } catch {
    return {};
  }
}

export function clearObjectInfoCache() {
  objectInfoCache = null;
}

export async function hasNodeClass(
  classType: string,
  target = resolveComfyTarget(),
): Promise<boolean> {
  const info = await getObjectInfo(target);
  return Boolean(info[classType]);
}
