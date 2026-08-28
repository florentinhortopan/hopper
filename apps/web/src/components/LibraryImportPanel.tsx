"use client";

import { useCallback, useEffect, useState } from "react";
import type { ImportSession, LibraryKind } from "@attatta/shared";
import { api } from "@/lib/api";
import { useImportEta } from "@/lib/useImportEta";

type SourceTab =
  | "zip"
  | "files"
  | "folder"
  | "dropbox"
  | "frameio"
  | "https";

const KINDS: LibraryKind[] = [
  "talent",
  "hands",
  "motion",
  "attire",
  "background",
  "prop",
  "theme",
  "copy",
];

type Props = {
  libraryId: string;
  onCommitted: () => void;
  onError: (msg: string) => void;
};

export function LibraryImportPanel({ libraryId, onCommitted, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SourceTab>("zip");
  const [autoClassify, setAutoClassify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [connectors, setConnectors] = useState<{
    dropbox: boolean;
    frameio: boolean;
    httpsAllowlist: string[];
    llm: { configured: boolean; baseUrl: string; model: string };
  } | null>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [dropboxPath, setDropboxPath] = useState("");
  const [dropboxEntries, setDropboxEntries] = useState<
    Array<{ name: string; path: string; tag: "file" | "folder" }>
  >([]);
  const [frameioFolderId, setFrameioFolderId] = useState("");
  const [frameioProjects, setFrameioProjects] = useState<
    Array<{ id: string; name: string; type: string; rootAssetId?: string }>
  >([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const importEta = useImportEta(session);

  const refreshConnectors = useCallback(async () => {
    try {
      setConnectors(await api.importConnectorsStatus());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open) void refreshConnectors();
  }, [open, refreshConnectors]);

  useEffect(() => {
    if (!session) return;
    const id = session.id;
    const active =
      session.status === "staging" ||
      session.status === "classifying" ||
      session.status === "committing";
    if (!active) return;

    let cancelled = false;
    const tick = () => {
      void api
        .getImportSession(id)
        .then((next) => {
          if (cancelled) return;
          setSession(next);
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [session?.id, session?.status]);

  async function startImport() {
    setBusy(true);
    onError("");
    try {
      let result: { session: ImportSession };
      if (tab === "zip") {
        if (!zipFile) throw new Error("Choose a .zip file");
        const form = new FormData();
        form.set("zip", zipFile);
        form.set("autoClassify", String(autoClassify));
        result = await api.startLibraryImport(libraryId, form);
      } else if (tab === "files") {
        if (!files?.length) throw new Error("Choose one or more media files");
        const form = new FormData();
        Array.from(files).forEach((f) => form.append("files", f));
        form.set("autoClassify", String(autoClassify));
        result = await api.startLibraryImport(libraryId, form);
      } else if (tab === "folder") {
        if (!folderPath.trim()) throw new Error("Enter a server folder path");
        result = await api.startLibraryImportJson(libraryId, {
          folderPath: folderPath.trim(),
          autoClassify,
        });
      } else if (tab === "dropbox") {
        if (!dropboxPath.trim()) throw new Error("Enter a Dropbox folder path");
        result = await api.startLibraryImportJson(libraryId, {
          dropboxPath: dropboxPath.trim(),
          autoClassify,
        });
      } else if (tab === "frameio") {
        if (!frameioFolderId.trim()) {
          throw new Error("Enter a Frame.io folder / asset id");
        }
        result = await api.startLibraryImportJson(libraryId, {
          frameioFolderId: frameioFolderId.trim(),
          autoClassify,
        });
      } else {
        if (!remoteUrl.trim()) throw new Error("Enter an HTTPS zip or manifest URL");
        result = await api.startLibraryImportJson(libraryId, {
          remoteUrl: remoteUrl.trim(),
          autoClassify,
        });
      }
      setSession(result.session);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function browseDropbox(path: string) {
    try {
      setDropboxEntries(await api.browseDropbox(path));
      setDropboxPath(path);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadFrameio() {
    try {
      setFrameioProjects(await api.browseFrameio());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function patchRow(
    rowId: string,
    patch: {
      suggestedKind?: LibraryKind;
      label?: string;
      status?: "pending" | "accepted" | "rejected";
    },
  ) {
    if (!session) return;
    try {
      setSession(
        await api.patchImportRows(session.id, [{ id: rowId, ...patch }]),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function bulkAcceptHighConfidence() {
    if (!session) return;
    const rows = session.rows
      .filter((r) => r.status === "pending" && r.confidence >= 0.9)
      .map((r) => ({ id: r.id, status: "accepted" as const }));
    if (!rows.length) return;
    try {
      setSession(await api.patchImportRows(session.id, rows));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function acceptAllPending() {
    if (!session) return;
    const rows = session.rows
      .filter((r) => r.status === "pending")
      .map((r) => ({ id: r.id, status: "accepted" as const }));
    if (!rows.length) return;
    try {
      setSession(await api.patchImportRows(session.id, rows));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function classify() {
    if (!session) return;
    setBusy(true);
    try {
      setSession(await api.classifyImport(session.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!session) return;
    setBusy(true);
    try {
      const next = await api.commitImport(session.id);
      setSession(next);
      onCommitted();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resync() {
    if (!session) return;
    setBusy(true);
    try {
      const { session: next } = await api.resyncImport(session.id);
      setSession(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const remoteSource =
    session?.source.type === "dropbox" ||
    session?.source.type === "frameio" ||
    session?.source.type === "https";

  const tabs: { id: SourceTab; label: string }[] = [
    { id: "zip", label: "Zip" },
    { id: "files", label: "Files" },
    { id: "folder", label: "Server path" },
    { id: "dropbox", label: "Dropbox" },
    { id: "frameio", label: "Frame.io" },
    { id: "https", label: "Remote URL" },
  ];

  return (
    <section className="rounded-2xl border border-warm-line bg-warm-paper/80 p-4 shadow-surface">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-600">
            Batch import
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Stage media → vision LLM suggests kinds (not Comfy) → review → commit into this
            pack.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-800"
        >
          {open ? "Hide" : "Import…"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          {connectors ? (
            <p className="text-[11px] text-ink-600">
              LLM:{" "}
              {connectors.llm.configured
                ? `${connectors.llm.model}`
                : "unset (heuristics only)"}
              {" · "}
              Dropbox: {connectors.dropbox ? "token ok" : "missing DROPBOX_ACCESS_TOKEN"}
              {" · "}
              Frame.io: {connectors.frameio ? "token ok" : "missing FRAMEIO_TOKEN"}
              {connectors.httpsAllowlist.length
                ? ` · HTTPS allowlist: ${connectors.httpsAllowlist.join(", ")}`
                : " · HTTPS allowlist empty"}
            </p>
          ) : null}

          {!session || session.status === "done" ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${
                      tab === t.id
                        ? "bg-ink-900 text-warm-paper"
                        : "border border-warm-line bg-white text-ink-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "zip" ? (
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm"
                />
              ) : null}
              {tab === "files" ? (
                <div className="space-y-2">
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => setFiles(e.target.files)}
                    className="block w-full text-sm"
                  />
                  <label className="block text-[11px] text-ink-600">
                    Or pick a folder
                    <input
                      type="file"
                      multiple
                      // @ts-expect-error non-standard folder picker
                      webkitdirectory=""
                      directory=""
                      onChange={(e) => setFiles(e.target.files)}
                      className="mt-1 block w-full text-sm"
                    />
                  </label>
                </div>
              ) : null}
              {tab === "folder" ? (
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/absolute/path/on/orchestrator/host"
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
                />
              ) : null}
              {tab === "dropbox" ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={dropboxPath}
                      onChange={(e) => setDropboxPath(e.target.value)}
                      placeholder="/ATTATTA/Pizza-Q3"
                      className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!connectors?.dropbox}
                      onClick={() => void browseDropbox(dropboxPath || "")}
                      className="rounded-md border border-ink-300 px-3 py-2 text-xs disabled:opacity-40"
                    >
                      Browse
                    </button>
                  </div>
                  {dropboxEntries.length ? (
                    <ul className="max-h-36 overflow-auto rounded-md border border-warm-line bg-white text-xs">
                      {dropboxEntries.map((e) => (
                        <li key={e.path}>
                          <button
                            type="button"
                            className="block w-full px-2 py-1.5 text-left hover:bg-warm-line/40"
                            onClick={() => {
                              if (e.tag === "folder") void browseDropbox(e.path);
                              else setDropboxPath(e.path);
                            }}
                          >
                            {e.tag === "folder" ? "📁 " : "📄 "}
                            {e.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {tab === "frameio" ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={frameioFolderId}
                      onChange={(e) => setFrameioFolderId(e.target.value)}
                      placeholder="Frame.io folder / asset id"
                      className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!connectors?.frameio}
                      onClick={() => void loadFrameio()}
                      className="rounded-md border border-ink-300 px-3 py-2 text-xs disabled:opacity-40"
                    >
                      List projects
                    </button>
                  </div>
                  {frameioProjects.length ? (
                    <ul className="max-h-36 overflow-auto rounded-md border border-warm-line bg-white text-xs">
                      {frameioProjects.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="block w-full px-2 py-1.5 text-left hover:bg-warm-line/40"
                            onClick={() =>
                              setFrameioFolderId(p.rootAssetId || p.id)
                            }
                          >
                            {p.name}{" "}
                            <span className="text-ink-500">({p.type})</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {tab === "https" ? (
                <input
                  type="url"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://cdn.example.com/plates.zip"
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
                />
              ) : null}

              <label className="flex items-center gap-2 text-sm text-ink-800">
                <input
                  type="checkbox"
                  checked={autoClassify}
                  onChange={(e) => setAutoClassify(e.target.checked)}
                />
                Auto-categorize with vision LLM after pull
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => void startImport()}
                className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-warm-paper disabled:opacity-40"
              >
                {busy ? "Starting…" : "Start import"}
              </button>
            </>
          ) : null}

          {session && session.status !== "done" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    Import {session.id.slice(0, 8)} · {session.status}
                  </p>
                  <p className="text-xs text-ink-600">
                    {session.message ||
                      `${Math.round(session.progress * 100)}% · ${session.rows.length} rows`}
                    {importEta.active
                      ? ` · ${importEta.elapsedLabel} elapsed${
                          importEta.etaLabel ? ` · ${importEta.etaLabel}` : ""
                        }`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {remoteSource ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resync()}
                      className="rounded-md border border-ink-300 px-3 py-1.5 text-xs"
                    >
                      Re-sync
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void classify()}
                    className="rounded-md border border-ink-300 px-3 py-1.5 text-xs"
                  >
                    Re-classify
                  </button>
                  <button
                    type="button"
                    onClick={() => void bulkAcceptHighConfidence()}
                    className="rounded-md border border-ink-300 px-3 py-1.5 text-xs"
                  >
                    Accept ≥0.9
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptAllPending()}
                    className="rounded-md border border-ink-300 px-3 py-1.5 text-xs"
                  >
                    Accept all
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void commit()}
                    className="rounded-md bg-ember-500 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Commit accepted
                  </button>
                </div>
              </div>

              {(session.status === "staging" ||
                session.status === "classifying" ||
                session.status === "committing") && (
                <div className="h-1.5 overflow-hidden rounded-full bg-warm-line">
                  <div
                    className="h-full bg-ember-500 transition-all"
                    style={{
                      width: `${Math.max(4, Math.round(session.progress * 100))}%`,
                    }}
                  />
                </div>
              )}

              {(session.detectedWorkflows?.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-700">
                  <p className="font-medium text-ink-900">
                    Workflows in package (not ingredient kinds)
                  </p>
                  <ul className="mt-1 space-y-1">
                    {session.detectedWorkflows!.map((w) => (
                      <li key={w.file} className="flex flex-wrap gap-2">
                        <span className="font-mono">{w.file}</span>
                        <span className="rounded bg-white px-1.5 uppercase tracking-wide text-[10px]">
                          workflow · {w.kind}
                        </span>
                        {w.sanity ? (
                          <span
                            className={
                              w.sanity.status === "ok"
                                ? "text-emerald-800"
                                : w.sanity.status === "warn"
                                  ? "text-amber-800"
                                  : w.sanity.status === "fail"
                                    ? "text-red-800"
                                    : "text-ink-500"
                            }
                          >
                            sanity:{w.sanity.status}
                            {w.sanity.nodeCount
                              ? ` (${w.sanity.nodeCount} nodes)`
                              : ""}
                          </span>
                        ) : null}
                        {w.sanity?.issues?.[0] ? (
                          <span className="text-ink-500">
                            — {w.sanity.issues[0]}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="max-h-[420px] overflow-auto rounded-xl border border-warm-line bg-white">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="sticky top-0 bg-warm-paper text-[10px] uppercase tracking-[0.12em] text-ink-600">
                    <tr>
                      <th className="px-2 py-2">File</th>
                      <th className="px-2 py-2">Src</th>
                      <th className="px-2 py-2">Kind</th>
                      <th className="px-2 py-2">Label</th>
                      <th className="px-2 py-2">Conf</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.rows.map((row) => (
                      <tr key={row.id} className="border-t border-warm-line/80">
                        <td className="max-w-[160px] truncate px-2 py-1.5 font-mono text-[11px]">
                          {row.originalName}
                        </td>
                        <td className="px-2 py-1.5 text-ink-600">
                          {row.remoteRef?.type || session.source.type}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={row.suggestedKind}
                            onChange={(e) =>
                              void patchRow(row.id, {
                                suggestedKind: e.target.value as LibraryKind,
                              })
                            }
                            className="rounded border border-ink-200 bg-white px-1 py-0.5"
                          >
                            {KINDS.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={row.label}
                            onChange={(e) =>
                              void patchRow(row.id, { label: e.target.value })
                            }
                            className="w-full min-w-[100px] rounded border border-ink-200 px-1 py-0.5"
                          />
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {row.confidence.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            {(
                              ["pending", "accepted", "rejected"] as const
                            ).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => void patchRow(row.id, { status: s })}
                                className={`rounded px-1.5 py-0.5 capitalize ${
                                  row.status === s
                                    ? s === "accepted"
                                      ? "bg-ink-900 text-warm-paper"
                                      : s === "rejected"
                                        ? "bg-red-700 text-white"
                                        : "bg-ink-400 text-white"
                                    : "border border-ink-200 text-ink-700"
                                }`}
                              >
                                {s[0]}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => setSession(null)}
                className="text-xs text-ink-600 underline"
              >
                Start another import
              </button>
            </div>
          ) : null}

          {session?.status === "done" ? (
            <p className="text-sm text-ink-800">
              Committed into pack.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setSession(null)}
              >
                Import more
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
