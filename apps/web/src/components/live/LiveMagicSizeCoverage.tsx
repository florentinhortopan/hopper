"use client";

import { useEffect, useMemo, useState } from "react";
import type { Job, MatrixCell, OutputSize } from "@attatta/shared";
import {
  cellComboLabel,
  coverageSummary,
  shortId,
  sizeSlotTone,
  toneClass,
  toneLabel,
} from "@/components/live/liveMatrixUtils";
import { api } from "@/lib/api";

type Props = {
  campaignId: string;
  cells: MatrixCell[];
  sizes: OutputSize[];
  refreshToken?: number;
};

/**
 * Variant × size coverage for Magic — which plate/scene still needs gen.
 */
export function LiveMagicSizeCoverage({
  campaignId,
  cells,
  sizes,
  refreshToken = 0,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void api
        .jobs(campaignId)
        .then((j) => {
          if (!cancelled) setJobs(j);
        })
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [campaignId, refreshToken]);

  const summary = useMemo(
    () => coverageSummary(cells, sizes, jobs),
    [cells, sizes, jobs],
  );

  const running = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );

  if (!cells.length || !sizes.length) {
    return (
      <div className="rounded-lg border border-ink-100 bg-white/70 px-2 py-2 text-[10px] text-ink-500">
        Size coverage appears after prepare builds variants.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink-100 bg-white/70 p-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Size coverage
        </h3>
        <span className="text-[10px] text-ink-600">
          {summary.ready}/{summary.total} plate×size ready vs Settings
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {sizes.map((s) => {
          const row = summary.bySize[s.id];
          return (
            <span
              key={s.id}
              className="rounded border border-ink-100 bg-warm-paper px-1.5 py-0.5 text-[10px]"
              title={s.label}
            >
              <span className="font-medium">{s.aspect}</span>
              <span className="text-ink-500">
                {" "}
                {row?.ready ?? 0}/{row?.total ?? 0}
              </span>
            </span>
          );
        })}
      </div>

      {running.length > 0 ? (
        <ul className="space-y-1 rounded border border-amber-100 bg-amber-50/50 px-2 py-1.5">
          {running.slice(0, 8).map((j) => {
            const cell = cells.find((c) => c.cellId === j.cellId);
            const size = sizes.find((s) => s.id === j.sizeId);
            return (
              <li key={j.id} className="text-[10px] text-amber-950">
                <span className="font-medium">Generating</span>
                {" · "}
                <span className="font-mono">{j.cellId || "—"}</span>
                {cell?.sceneTag ? (
                  <>
                    {" · scene "}
                    <span className="font-mono">{cell.sceneTag}</span>
                  </>
                ) : null}
                {size ? (
                  <>
                    {" · "}
                    <span className="font-medium">{size.aspect}</span>
                    <span className="text-amber-800"> ({size.label})</span>
                  </>
                ) : j.sizeId ? (
                  <>
                    {" · size "}
                    <span className="font-mono">{shortId(j.sizeId, 12)}</span>
                  </>
                ) : null}
                {cell ? (
                  <span className="block truncate text-amber-800/80">
                    {cellComboLabel(cell)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="overflow-x-auto">
        <p className="mb-1 text-[10px] text-ink-500">
          Variants × sizes (XY)
        </p>
        <table className="w-full min-w-[18rem] border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-ink-200 text-ink-500">
              <th className="px-1 py-1 text-left font-medium">Variant / scene</th>
              {sizes.map((s) => (
                <th
                  key={s.id}
                  className="px-1 py-1 text-center font-medium"
                  title={s.label}
                >
                  {s.aspect}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.slice(0, 24).map((cell) => (
              <tr key={cell.cellId} className="border-b border-ink-50">
                <td className="max-w-[10rem] px-1 py-1">
                  <p className="truncate font-mono text-ink-500">
                    {cell.cellId}
                    {cell.sceneTag ? ` · ${cell.sceneTag}` : ""}
                  </p>
                  <p className="truncate text-ink-700">
                    {cellComboLabel(cell)}
                  </p>
                </td>
                {sizes.map((s) => {
                  const tone = sizeSlotTone(cell, s, jobs);
                  return (
                    <td key={s.id} className="px-1 py-1 text-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 ${
                          tone === "ready"
                            ? "bg-emerald-50 text-emerald-900"
                            : tone === "running"
                              ? "bg-amber-50 text-amber-950"
                              : tone === "failed"
                                ? "bg-red-50 text-red-800"
                                : "bg-ink-50 text-ink-500"
                        }`}
                        title={`${s.label}: ${toneLabel(tone)}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${toneClass(tone)}`}
                        />
                        {tone === "ready"
                          ? "ok"
                          : tone === "running"
                            ? "gen"
                            : tone === "failed"
                              ? "fail"
                              : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {cells.length > 24 ? (
          <p className="mt-1 text-[10px] text-ink-500">
            +{cells.length - 24} more variants
          </p>
        ) : null}
      </div>
    </div>
  );
}
