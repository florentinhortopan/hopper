"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@attatta/shared";
import { JobProgressRow } from "@/components/JobProgressRow";
import { api } from "@/lib/api";

type Props = {
  campaignId: string;
  /** Bump when bus events imply queue changed. */
  refreshToken?: number;
  /** Notify parent so Hopper/Celtra can refresh when jobs settle (jobs poll ≠ SSE). */
  onJobsChange?: (jobs: Job[]) => void;
};

function sortJobsNatural(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function LiveQueuePreview({
  campaignId,
  refreshToken = 0,
  onJobsChange,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onJobsChangeRef = useRef(onJobsChange);
  onJobsChangeRef.current = onJobsChange;

  const load = useCallback(() => {
    void api
      .jobs(campaignId)
      .then((list) => {
        const ordered = sortJobsNatural(list);
        setJobs(ordered);
        setError(null);
        onJobsChangeRef.current?.(ordered);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [campaignId]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [load, refreshToken]);

  const ordered = useMemo(() => sortJobsNatural(jobs), [jobs]);
  const active = ordered.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const done = ordered.filter((j) => j.status === "done").length;
  const failed = ordered.filter((j) => j.status === "failed").length;

  async function stopAll() {
    setStopping(true);
    try {
      await api.cancelCampaignJobs(campaignId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t border-ink-100 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Queue
        </h3>
        <span className="text-[10px] text-ink-500">
          {ordered.length
            ? `${active.length} live · ${done} done · ${failed} failed`
            : "No jobs yet — Generate to enqueue plates"}
        </span>
        {active.length > 0 ? (
          <button
            type="button"
            className="ml-auto rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-900 disabled:opacity-40"
            disabled={stopping}
            onClick={() => void stopAll()}
          >
            {stopping ? "Stopping…" : "Stop all"}
          </button>
        ) : null}
      </div>
      {error ? (
        <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-800">
          {error}
        </pre>
      ) : null}
      {ordered.length > 0 ? (
        <ul className="space-y-1">
          {ordered.slice(0, 24).map((job) => (
            <JobProgressRow
              key={job.id}
              job={job}
              compact
              onCancelled={load}
            />
          ))}
          {ordered.length > 24 ? (
            <li className="text-[10px] text-ink-500">
              +{ordered.length - 24} more — open Advanced → Queue for full list
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
