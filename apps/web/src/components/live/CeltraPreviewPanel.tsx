"use client";

import { useCallback, useEffect, useState } from "react";
import type { CeltraPreview } from "@attatta/shared";
import {
  MediaLightbox,
  SizeMediaFrame,
  cssAspect,
  type MediaLightboxState,
} from "@/components/live/LiveThumb";
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
  const [lightbox, setLightbox] = useState<MediaLightboxState | null>(null);

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
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
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
  const sizeCols = preview?.sizes?.length
    ? preview.sizes
    : preview?.rows[0]?.sizes?.map((s) => ({
        id: s.sizeId,
        aspect: s.aspect,
        label: s.label,
      })) || [];

  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[10px] uppercase tracking-wide text-ink-500">
          Content matrix
          {preview
            ? ` · ${preview.rowCount} variant(s) · ${packable} kept size(s) packable`
            : ""}
        </div>
        <button
          type="button"
          className="shrink-0 rounded bg-ember-500 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          disabled={pkgBusy || packable < 1}
          onClick={() => void packageNow()}
          title={
            packable < 1
              ? "Keep sizes in Hopper first"
              : "Build Celtra zip — one order row per kept size"
          }
        >
          {pkgBusy ? "Packaging…" : "Package zip"}
        </button>
      </div>
      <p className="text-[10px] text-ink-500">
        Keep/Kill sizes in Hopper. Killed sizes are greyed here; zip only
        includes kept plates. Tap a thumb to preview that size.
      </p>
      {error ? (
        <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-800">
          {error}
        </pre>
      ) : null}
      {lastZip ? (
        <p className="font-mono text-[10px] text-ink-600">{lastZip}</p>
      ) : null}
      {!preview?.rows.length ? (
        <p className="py-4 text-center text-xs text-ink-500">
          Run Magic prepare — draft Celtra rows appear here live.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wide text-ink-500">
                <th className="px-1 py-1 font-medium">#</th>
                <th className="px-1 py-1 font-medium">Frame</th>
                {sizeCols.map((s) => (
                  <th
                    key={s.id}
                    className="px-1 py-1 text-center font-medium"
                    title={s.label}
                  >
                    {s.aspect}
                  </th>
                ))}
                <th className="px-1 py-1 font-medium">Copy</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => {
                const slots =
                  row.sizes?.length > 0
                    ? row.sizes
                    : sizeCols.map((s) => ({
                        sizeId: s.id,
                        aspect: s.aspect,
                        label: s.label,
                        platePath:
                          s.id === sizeCols[0]?.id ? row.platePath : null,
                        ready: s.id === sizeCols[0]?.id ? row.hasPlate : false,
                        decision: row.decision,
                        packable: false,
                        width: null as number | null,
                        height: null as number | null,
                      }));
                return (
                  <tr
                    key={`${row.cellId}-${row.order}`}
                    className={`border-b border-ink-100 align-top ${
                      row.packable
                        ? "bg-emerald-50/40"
                        : "bg-white"
                    }`}
                  >
                    <td className="px-1 py-1.5 font-mono text-ink-500">
                      {row.order}
                    </td>
                    <td className="px-1 py-1.5 font-mono">{row.frame}</td>
                    {slots.map((slot) => {
                      const killed = slot.decision === "rejected";
                      const kept = slot.packable || slot.decision === "approved";
                      return (
                        <td
                          key={slot.sizeId}
                          className="px-1 py-1.5 text-center"
                        >
                          <div
                            className={`inline-flex flex-col items-center gap-0.5 ${
                              killed ? "opacity-35 grayscale" : ""
                            }`}
                            title={
                              killed
                                ? `${slot.aspect} killed in Hopper — skipped in zip`
                                : kept
                                  ? `${slot.aspect} kept — included in zip`
                                  : `${slot.aspect} · ${decisionLabel(slot.decision)}`
                            }
                          >
                            <div
                              className="mx-auto h-12 overflow-hidden"
                              style={{
                                aspectRatio: cssAspect(slot.aspect) || "9 / 16",
                              }}
                            >
                              <SizeMediaFrame
                                path={slot.platePath}
                                rev={`${slot.sizeId}:${slot.platePath || ""}`}
                                aspect={slot.aspect}
                                label={`${row.cellId} · ${slot.aspect}`}
                                className="h-full w-full border-0"
                                onOpen={
                                  slot.platePath
                                    ? () =>
                                        setLightbox({
                                          path: slot.platePath!,
                                          rev: `${slot.sizeId}:${slot.platePath}`,
                                          label: `${row.cellId} · ${slot.aspect}`,
                                          aspect: slot.aspect,
                                          width: slot.width ?? undefined,
                                          height: slot.height ?? undefined,
                                          sizeId: slot.sizeId,
                                        })
                                    : undefined
                                }
                              />
                            </div>
                            <span
                              className={`text-[9px] ${
                                killed
                                  ? "text-ink-400 line-through"
                                  : kept
                                    ? "text-emerald-800"
                                    : slot.ready
                                      ? "text-ink-600"
                                      : "text-ink-400"
                              }`}
                            >
                              {slot.ready
                                ? decisionLabel(slot.decision)
                                : "—"}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="max-w-[10rem] px-1 py-1.5">
                      <p className="truncate text-ink-800" title={row.setup}>
                        {row.setup || "—"}
                      </p>
                      <p
                        className="truncate text-[10px] text-ink-500"
                        title={row.punchline}
                      >
                        {row.punchline || "—"}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {preview?.warnings?.length ? (
        <p className="text-[10px] text-amber-900">
          {preview.warnings.slice(0, 3).join(" · ")}
        </p>
      ) : null}
      {lightbox ? (
        <MediaLightbox
          key={`${lightbox.sizeId || ""}:${lightbox.path}`}
          state={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
