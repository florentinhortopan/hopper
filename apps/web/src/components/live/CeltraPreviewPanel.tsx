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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-500">
          Live Celtra preview
          {preview ? ` · ${preview.rowCount} row(s)` : ""}
        </div>
        <button
          type="button"
          className="rounded bg-ember-500 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          disabled={pkgBusy || !preview?.rowCount}
          onClick={() => void packageNow()}
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
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!preview?.rows.length ? (
          <li className="py-6 text-center text-xs text-ink-500">
            Keep variants with plates — rows appear here live.
          </li>
        ) : (
          preview.rows.map((row) => (
            <li
              key={`${row.cellId}-${row.order}`}
              className="rounded-lg border border-ink-100 bg-white px-2 py-2 text-xs"
            >
              <div className="flex flex-wrap gap-2 font-mono text-[10px] text-ink-500">
                <span>#{row.order}</span>
                <span>{row.frame}</span>
                <span className="truncate">{row.cellId}</span>
              </div>
              <p className="mt-1 text-ink-900">
                {row.setup}
                {row.punchline ? ` → ${row.punchline}` : ""}
              </p>
              {row.warnings.length ? (
                <p className="mt-1 text-[10px] text-amber-800">
                  {row.warnings.join(" · ")}
                </p>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {preview?.warnings?.length ? (
        <div className="border-t border-ink-100 px-3 py-2 text-[10px] text-amber-900">
          {preview.warnings.slice(0, 3).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
