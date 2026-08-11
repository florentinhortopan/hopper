import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ImportRemoteRef } from "@attatta/shared";

const MEDIA_EXT = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export function isMediaFilename(name: string) {
  return MEDIA_EXT.has(path.extname(name).toLowerCase());
}

export type ConnectorEntry = {
  name: string;
  /** Relative path for staging */
  relativePath: string;
  download: (destAbs: string) => Promise<ImportRemoteRef | void>;
};

export function connectorStatus() {
  return {
    dropbox: Boolean(process.env.DROPBOX_ACCESS_TOKEN?.trim()),
    frameio: Boolean(process.env.FRAMEIO_TOKEN?.trim()),
    httpsAllowlist: (process.env.ATTATTA_IMPORT_URL_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    llm: Boolean(process.env.ATTATTA_LLM_API_KEY?.trim()),
  };
}

function assertHttpsUrl(urlStr: string) {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === "0.0.0.0" ||
    host === "[::1]"
  ) {
    throw new Error("Private / local hosts are not allowed");
  }
  const allow = (process.env.ATTATTA_IMPORT_URL_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.some((a) => host === a || host.endsWith(`.${a}`))) {
    throw new Error(
      `Host ${host} not in ATTATTA_IMPORT_URL_ALLOWLIST (${allow.join(", ") || "empty"})`,
    );
  }
  return u;
}

export async function listLocalFolder(folderPath: string): Promise<ConnectorEntry[]> {
  const root = path.resolve(folderPath);
  const st = await stat(root);
  if (!st.isDirectory()) throw new Error("folderPath must be a directory");

  const out: ConnectorEntry[] = [];
  async function walk(dir: string, relBase: string) {
    for (const name of await readdir(dir)) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      const rel = relBase ? `${relBase}/${name}` : name;
      const s = await stat(abs);
      if (s.isDirectory()) await walk(abs, rel);
      else if (isMediaFilename(name)) {
        out.push({
          name,
          relativePath: rel,
          download: async (dest) => {
            const { copyFile } = await import("node:fs/promises");
            await mkdir(path.dirname(dest), { recursive: true });
            await copyFile(abs, dest);
            return { type: "local" as const, path: abs };
          },
        });
      }
    }
  }
  await walk(root, "");
  return out;
}

export async function browseDropbox(folderPath = ""): Promise<
  Array<{ name: string; path: string; tag: "file" | "folder" }>
> {
  const token = process.env.DROPBOX_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("DROPBOX_ACCESS_TOKEN not set");
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: folderPath === "/" ? "" : folderPath || "",
      recursive: false,
      include_non_downloadable_files: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dropbox list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    entries?: Array<{ ".tag": string; name: string; path_display?: string }>;
  };
  return (data.entries || []).map((e) => ({
    name: e.name,
    path: e.path_display || e.name,
    tag: e[".tag"] === "folder" ? "folder" : "file",
  }));
}

export async function listDropboxFolder(folderPath: string): Promise<ConnectorEntry[]> {
  const token = process.env.DROPBOX_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("DROPBOX_ACCESS_TOKEN not set");
  const entries: ConnectorEntry[] = [];
  let cursor: string | undefined;
  let pathArg = folderPath === "/" ? "" : folderPath;

  async function page(body: Record<string, unknown>, endpoint: string) {
    const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Dropbox ${endpoint} failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as {
      entries?: Array<{
        ".tag": string;
        name: string;
        path_display?: string;
        path_lower?: string;
        rev?: string;
      }>;
      cursor?: string;
      has_more?: boolean;
    };
  }

  let data = await page(
    { path: pathArg, recursive: true, include_non_downloadable_files: false },
    "files/list_folder",
  );
  for (;;) {
    for (const e of data.entries || []) {
      if (e[".tag"] !== "file" || !isMediaFilename(e.name)) continue;
      const dbPath = e.path_display || e.path_lower || e.name;
      const rel = dbPath.replace(/^\//, "");
      const rev = e.rev;
      entries.push({
        name: e.name,
        relativePath: rel,
        download: async (dest) => {
          await mkdir(path.dirname(dest), { recursive: true });
          const res = await fetch(
            "https://content.dropboxapi.com/2/files/download",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Dropbox-API-Arg": JSON.stringify({ path: dbPath }),
              },
            },
          );
          if (!res.ok || !res.body) {
            throw new Error(`Dropbox download failed (${res.status}) for ${dbPath}`);
          }
          await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
          return { type: "dropbox" as const, path: dbPath, rev };
        },
      });
    }
    if (!data.has_more || !data.cursor) break;
    cursor = data.cursor;
    data = await page({ cursor }, "files/list_folder/continue");
  }
  return entries;
}

export async function browseFrameio(): Promise<
  Array<{ id: string; name: string; type: "account" | "project" | "folder" }>
> {
  const token = process.env.FRAMEIO_TOKEN?.trim();
  if (!token) throw new Error("FRAMEIO_TOKEN not set");
  // Frame.io V4 / legacy: try accounts endpoint
  const res = await fetch("https://api.frame.io/v2/accounts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Frame.io accounts failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const accounts = (await res.json()) as Array<{ id: string; name?: string; display_name?: string }>;
  return accounts.map((a) => ({
    id: a.id,
    name: a.name || a.display_name || a.id,
    type: "account" as const,
  }));
}

export async function browseFrameioProjects(accountId: string) {
  const token = process.env.FRAMEIO_TOKEN?.trim();
  if (!token) throw new Error("FRAMEIO_TOKEN not set");
  const res = await fetch(
    `https://api.frame.io/v2/accounts/${accountId}/projects`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Frame.io projects failed (${res.status})`);
  }
  const projects = (await res.json()) as Array<{ id: string; name: string; root_asset_id?: string }>;
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    type: "project" as const,
    rootAssetId: p.root_asset_id,
  }));
}

export async function listFrameioFolder(folderId: string): Promise<ConnectorEntry[]> {
  const token = process.env.FRAMEIO_TOKEN?.trim();
  if (!token) throw new Error("FRAMEIO_TOKEN not set");

  async function children(parentId: string): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      filesize?: number;
      media_links?: { original?: { download_url?: string } };
      versions?: Array<{ id: string }>;
    }>
  > {
    const res = await fetch(
      `https://api.frame.io/v2/assets/${parentId}/children`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(
        `Frame.io children failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as Array<{
      id: string;
      name: string;
      type: string;
      filesize?: number;
      media_links?: { original?: { download_url?: string } };
      versions?: Array<{ id: string }>;
    }>;
  }

  const out: ConnectorEntry[] = [];
  async function walk(id: string, relBase: string) {
    const kids = await children(id);
    for (const k of kids) {
      const rel = relBase ? `${relBase}/${k.name}` : k.name;
      if (k.type === "folder" || k.type === "version_stack") {
        // version_stack often holds the media; still walk
        if (k.type === "folder") await walk(k.id, rel);
        else {
          // treat stack as file container — fetch self for download
          if (isMediaFilename(k.name) || k.filesize) {
            const assetId = k.id;
            const versionId = k.versions?.[0]?.id;
            out.push({
              name: k.name,
              relativePath: rel,
              download: async (dest) => {
                const detailRes = await fetch(
                  `https://api.frame.io/v2/assets/${assetId}`,
                  { headers: { Authorization: `Bearer ${token}` } },
                );
                if (!detailRes.ok) throw new Error(`Frame.io asset ${assetId} failed`);
                const detail = (await detailRes.json()) as {
                  media_links?: { original?: { download_url?: string } };
                  name?: string;
                };
                const url = detail.media_links?.original?.download_url;
                if (!url) throw new Error(`No download URL for Frame.io asset ${assetId}`);
                await mkdir(path.dirname(dest), { recursive: true });
                const fileRes = await fetch(url);
                if (!fileRes.ok || !fileRes.body) {
                  throw new Error(`Frame.io download failed (${fileRes.status})`);
                }
                await pipeline(
                  fileRes.body as unknown as NodeJS.ReadableStream,
                  createWriteStream(dest),
                );
                return {
                  type: "frameio" as const,
                  assetId,
                  versionId,
                  path: detail.name || k.name,
                };
              },
            });
          }
        }
      } else if (k.type === "file" || isMediaFilename(k.name)) {
        const assetId = k.id;
        const versionId = k.versions?.[0]?.id;
        out.push({
          name: k.name,
          relativePath: rel,
          download: async (dest) => {
            const detailRes = await fetch(`https://api.frame.io/v2/assets/${assetId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!detailRes.ok) throw new Error(`Frame.io asset ${assetId} failed`);
            const detail = (await detailRes.json()) as {
              media_links?: { original?: { download_url?: string } };
            };
            const url =
              detail.media_links?.original?.download_url ||
              k.media_links?.original?.download_url;
            if (!url) throw new Error(`No download URL for Frame.io asset ${assetId}`);
            await mkdir(path.dirname(dest), { recursive: true });
            const fileRes = await fetch(url);
            if (!fileRes.ok || !fileRes.body) {
              throw new Error(`Frame.io download failed (${fileRes.status})`);
            }
            await pipeline(
              fileRes.body as unknown as NodeJS.ReadableStream,
              createWriteStream(dest),
            );
            return {
              type: "frameio" as const,
              assetId,
              versionId,
              path: k.name,
            };
          },
        });
      }
    }
  }
  await walk(folderId, "");
  return out;
}

/** Download a remote HTTPS zip (or single media file) into stagingDir. */
export async function pullHttpsUrl(
  remoteUrl: string,
  stagingDir: string,
): Promise<ConnectorEntry[]> {
  const u = assertHttpsUrl(remoteUrl);
  await mkdir(stagingDir, { recursive: true });
  const res = await fetch(u.toString());
  if (!res.ok || !res.body) {
    throw new Error(`HTTPS fetch failed (${res.status})`);
  }
  const base = path.basename(u.pathname) || "download.bin";
  const dest = path.join(stagingDir, base);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));

  if (base.toLowerCase().endsWith(".zip")) {
    // Caller will unzip; return empty list — libraryImport handles zip extract
    await writeFile(path.join(stagingDir, ".https-zip"), base);
    return [];
  }
  if (!isMediaFilename(base)) {
    throw new Error("Remote URL must be a media file or .zip");
  }
  return [
    {
      name: base,
      relativePath: base,
      download: async () => ({ type: "https" as const, url: u.toString() }),
    },
  ];
}
