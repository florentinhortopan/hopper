"use client";

import { useEffect, useState } from "react";
import type { Job } from "@attatta/shared";
import { api } from "@/lib/api";

function isActive(j: Job) {
  return j.status === "queued" || j.status === "running";
}

/**
 * Sticky stop control whenever Comfy / Remotion jobs are live for this campaign
 * (or `_library` on Library).
 */
export function ActiveGenerationBar({
  campaignId,
}: {
  campaignId: string;
}) {
  const [active, setActive] = useState<Job[]>([]);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const jobs = await api.jobs(campaignId);
        if (!alive) return;
        setActive(jobs.filter(isActive));
      } catch {
        if (alive) setActive([]);
      }
    }
    void poll();
    const t = window.setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [campaignId]);

  if (!active.length) return null;

  const running = active.filter((j) => j.status === "running").length;
  const label =
    active.length === 1
      ? active[0]!.message || "Generating…"
      : `${active.length} jobs live (${running} running)`;

  return (
    <div className="sticky top-0 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 shadow-sm">
      <div className="min-w-0 flex items-center gap-2">
        <span className="attatta-spinner shrink-0" aria-hidden />
        <span className="truncate font-medium">{label}</span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <a
          href={
            campaignId === "_library"
              ? "/library"
              : `/campaigns/${campaignId}/queue`
          }
          className="text-xs text-amber-900 underline-offset-2 hover:underline"
        >
          {campaignId === "_library" ? "Library" : "Queue"}
        </a>
        <button
          type="button"
          disabled={stopping}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          title="Stop Comfy / Remotion jobs to save tokens"
          onClick={() => {
            setStopping(true);
            void api
              .cancelCampaignJobs(campaignId)
              .then(() => api.jobs(campaignId))
              .then((jobs) => setActive(jobs.filter(isActive)))
              .catch(() => undefined)
              .finally(() => setStopping(false));
          }}
        >
          {stopping ? "Stopping…" : `Stop generation${active.length > 1 ? ` (${active.length})` : ""}`}
        </button>
      </div>
    </div>
  );
}
