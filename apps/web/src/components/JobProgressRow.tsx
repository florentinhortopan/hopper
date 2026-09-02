"use client";

import { useEffect, useState } from "react";
import {
  estimateQueueJobSeconds,
  formatDurationShort,
  remainingEstimateSeconds,
  type Job,
} from "@attatta/shared";
import { api } from "@/lib/api";

function jobActive(j: Job) {
  return j.status === "queued" || j.status === "running";
}

function statusTone(status: Job["status"]) {
  if (status === "running") return "bg-amber-100 text-amber-950";
  if (status === "queued") return "bg-ink-100 text-ink-800";
  if (status === "done") return "bg-emerald-50 text-emerald-800";
  if (status === "cancelled") return "bg-ink-100 text-ink-600";
  return "bg-red-50 text-red-800";
}

export function JobProgressRow({
  job,
  onCancelled,
  compact = false,
}: {
  job: Job;
  onCancelled?: () => void;
  /** Tighter layout for live Magic queue. */
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const active = jobActive(job);
  const startedAt = Date.parse(job.createdAt) || Date.now();
  const etaTotal =
    job.etaSeconds ??
    estimateQueueJobSeconds({
      stage: job.stage,
      includesComfy: job.stage === "plates" || job.message.toLowerCase().includes("comfy"),
    });
  const remainSec = active
    ? remainingEstimateSeconds(startedAt, etaTotal, now)
    : 0;
  const elapsedSec = Math.max(0, (now - startedAt) / 1000);
  const barPct = Math.min(
    98,
    Math.max(
      active ? 6 : 0,
      Math.round(
        (job.progress > 0.01
          ? job.progress
          : active
            ? elapsedSec / Math.max(etaTotal, 1)
            : job.status === "done"
              ? 1
              : 0) * 100,
      ),
    ),
  );
  const etaHint = active
    ? `~${formatDurationShort(remainSec)} left · ${formatDurationShort(elapsedSec)} in`
    : null;

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  if (compact) {
    return (
      <li className="rounded border border-ink-100 bg-white px-2 py-1 text-[11px]">
        <div className="flex items-center gap-2">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${statusTone(job.status)}`}
            title={etaHint || job.message}
          >
            {active ? `~${formatDurationShort(remainSec)}` : job.status}
          </span>
          <div className="min-w-0 flex-1 truncate text-ink-700">
            <span className="font-mono text-[10px] text-ink-500">
              {job.cellId || job.id}
            </span>
            {job.sizeId ? (
              <span className="text-ink-500">
                {" · "}
                {job.width && job.height
                  ? `${job.width}×${job.height}`
                  : job.sizeId}
              </span>
            ) : null}
            <span className="text-ink-500"> — {job.message}</span>
          </div>
          {active ? (
            <button
              type="button"
              disabled={stopping}
              className="shrink-0 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-800 disabled:opacity-50"
              onClick={() => {
                setStopping(true);
                void api
                  .cancelJob(job.id)
                  .then(() => onCancelled?.())
                  .catch(() => undefined)
                  .finally(() => setStopping(false));
              }}
            >
              {stopping ? "…" : "Stop"}
            </button>
          ) : null}
        </div>
        {active || job.progress > 0 ? (
          <div
            className={`mt-1 h-0.5 overflow-hidden rounded-full ${
              active ? "bg-amber-100" : "bg-ink-100"
            }`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                job.status === "failed"
                  ? "bg-red-500"
                  : job.status === "cancelled"
                    ? "bg-ink-400"
                    : active
                      ? "bg-amber-500"
                      : "bg-ember-500"
              }`}
              style={{ width: `${job.status === "done" ? 100 : barPct}%` }}
            />
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink-600">{job.id}</span>
        <div className="flex items-center gap-2">
          {active ? (
            <button
              type="button"
              disabled={stopping}
              className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-800 disabled:opacity-50"
              title="Stop this job — cancels Comfy when possible"
              onClick={() => {
                setStopping(true);
                void api
                  .cancelJob(job.id)
                  .then(() => onCancelled?.())
                  .catch(() => undefined)
                  .finally(() => setStopping(false));
              }}
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusTone(job.status)}`}
            title={etaHint || job.message}
          >
            {active ? <span className="attatta-spinner" aria-hidden /> : null}
            {active ? `~${formatDurationShort(remainSec)}` : job.status}
          </span>
        </div>
      </div>
      <div className="mt-1 text-ink-700">
        <span className="capitalize">{job.stage.replace(/_/g, " ")}</span>
        {" · "}
        {job.cellId || "—"}
        {job.sizeId ? (
          <>
            {" "}
            · <span className="font-mono">{job.sizeId}</span>
            {job.width && job.height ? ` ${job.width}×${job.height}` : ""}
          </>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-ink-600">{job.message}</p>
      {active || job.progress > 0 ? (
        <div className="mt-2 min-w-0">
          <div
            className={`h-1 overflow-hidden rounded-full ${
              active ? "bg-amber-100" : "bg-ink-100"
            }`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                job.status === "failed"
                  ? "bg-red-500"
                  : job.status === "cancelled"
                    ? "bg-ink-400"
                    : active
                      ? "bg-amber-500"
                      : "bg-ember-500"
              }`}
              style={{ width: `${job.status === "done" ? 100 : barPct}%` }}
            />
          </div>
          {etaHint ? (
            <p className="mt-1 truncate text-[10px] text-amber-900/80">{etaHint}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
