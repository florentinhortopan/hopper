"use client";

import { useCallback, useEffect, useState } from "react";
import type { Job } from "@attatta/shared";
import { JobProgressRow } from "@/components/JobProgressRow";
import { api } from "@/lib/api";

type Props = {
  campaignId: string;
  /** Bump when bus events imply queue changed. */
  refreshToken?: number;
};

export function LiveQueuePreview({ campaignId, refreshToken = 0 }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .jobs(campaignId)
      .then((list) => {
        setJobs(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [campaignId]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [load, refreshToken]);

  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

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
    <div className="space-y-2 border-t border-ink-100 px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Queue
        </h3>
        <span className="text-[10px] text-ink-500">
          {jobs.length
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
      {jobs.length > 0 ? (
        <ul className="space-y-2">
          {jobs.slice(0, 24).map((job) => (
            <JobProgressRow
              key={job.id}
              job={job}
              onCancelled={load}
            />
          ))}
          {jobs.length > 24 ? (
            <li className="text-[10px] text-ink-500">
              +{jobs.length - 24} more — open Advanced → Queue for full list
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
