"use client";

import { useCallback, useEffect, useState } from "react";
import type { CeltraPreview } from "@attatta/shared";
import { api } from "@/lib/api";
import { triggerApiDownload } from "@/lib/download";

type Props = {
  campaignId: string;
  /** Bump to force refresh (e.g. on SSE review/package events). */
  refreshToken: number;
};

function decisionLabel(d: string) {
  if (d === "approved") return "kept";
  if (d === "rejected") return "killed";
  return "draft";
}

export function CeltraPreviewPanel({ campaignId, refreshToken }: Props) {
  const [preview, setPreview] = useState<CeltraPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [lastZip, setLastZip] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .celtraPreview(campaignId)
      .then((p) => {
        setPreview(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  async function packageNow() {
    setPkgBusy(true);
    setError(null);
    try {
      const result = await api.package(campaignId);
      setLastZip(result.fileName);
      await triggerApiDownload(result.downloadUrl, result.fileName);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPkgBusy(false);
    }
  }

  const packable = preview?.packableCount ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-500">
          Content matrix
          {preview
            ? ` · ${preview.rowCount} row(s) · ${packable} packable`
            : ""}
        </div>
        <button
          type="button"
          className="shrink-0 rounded bg-ember-500 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          disabled={pkgBusy || packable < 1}
          onClick={() => void packageNow()}
          title={
            packable < 1
              ? "Keep variants with plates to package"
              : "Build Celtra zip from packable rows"
          }
        >
          {pkgBusy ? "Packaging…" : "Package zip"}
        </button>
      </div>
      {error ? (
        <pre className="mx-3 mt-2 whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-800">
          {error}
        </pre>
      ) : null}
      {lastZip ? (
        <p className="px-3 pt-1 font-mono text-[10px] text-ink-600">{lastZip}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {!preview?.rows.length ? (
          <p className="py-6 text-center text-xs text-ink-500">
            Run Magic prepare — draft Celtra rows appear here live.
          </p>
        ) : (
          <table className="w-full min-w-[28rem] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wide text-ink-500">
                <th className="px-1 py-1 font-medium">#</th>
                <th className="px-1 py-1 font-medium">Frame</th>
                <th className="px-1 py-1 font-medium">Status</th>
                <th className="px-1 py-1 font-medium">Setup</th>
                <th className="px-1 py-1 font-medium">Punchline</th>
                <th className="px-1 py-1 font-medium">Endcard</th>
                <th className="px-1 py-1 font-medium">Plate</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr
                  key={`${row.cellId}-${row.order}`}
                  className={`border-b border-ink-100 align-top ${
                    row.packable
                      ? "bg-emerald-50/60"
                      : row.decision === "rejected"
                        ? "bg-ink-50/80 opacity-70"
                        : "bg-white"
                  }`}
                >
                  <td className="px-1 py-1.5 font-mono text-ink-500">
                    {row.order}
                  </td>
                  <td className="px-1 py-1.5 font-mono">{row.frame}</td>
                  <td className="px-1 py-1.5">
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] ${
                        row.packable
                          ? "bg-emerald-200 text-emerald-950"
                          : row.decision === "rejected"
                            ? "bg-ink-200 text-ink-700"
                            : "bg-amber-100 text-amber-950"
                      }`}
                    >
                      {decisionLabel(row.decision)}
                      {row.hasPlate ? "" : " · no plate"}
                    </span>
                  </td>
                  <td className="max-w-[8rem] truncate px-1 py-1.5" title={row.setup}>
                    {row.setup || "—"}
                  </td>
                  <td
                    className="max-w-[8rem] truncate px-1 py-1.5"
                    title={row.punchline}
                  >
                    {row.punchline || "—"}
                  </td>
                  <td
                    className="max-w-[8rem] truncate px-1 py-1.5"
                    title={row.endcard}
                  >
                    {row.endcard || "—"}
                  </td>
                  <td
                    className="max-w-[6rem] truncate px-1 py-1.5 font-mono text-[10px] text-ink-500"
                    title={row.platePath || undefined}
                  >
                    {row.hasPlate ? "yes" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {preview?.warnings?.length ? (
        <div className="border-t border-ink-100 px-3 py-2 text-[10px] text-amber-900">
          {preview.warnings.slice(0, 3).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
