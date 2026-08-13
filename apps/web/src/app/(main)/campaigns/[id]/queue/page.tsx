"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Job } from "@attatta/shared";
import { JobProgressRow } from "@/components/JobProgressRow";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

export default function QueuePage() {
  const { id } = useParams<{ id: string }>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [planRows, setPlanRows] = useState<
    {
      cellId: string;
      sizeId: string;
      label: string;
      aspect: string;
      width: number;
      height: number;
      status: string;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  async function refresh() {
    const [j, plan] = await Promise.all([api.jobs(id), api.assetPlan(id)]);
    setJobs(j);
    setPlanRows(plan.rows);
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [id]);

  const activeCount = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  return (
    <div>
      <StepNav campaignId={id} current="queue" />
      <h1 className="font-display text-3xl">Render queue</h1>
      <p className="mt-1 text-sm text-ink-700">
        Each job is cell × size. Planned assets: {planRows.length}.
        {activeCount ? ` ${activeCount} live — Stop cancels Comfy when possible.` : " Poll every 2s."}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white"
          onClick={async () => {
            setBusy(true);
            try {
              await api.render(id);
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          Assemble missing masters
        </button>
        <button
          type="button"
          disabled={stopping || activeCount === 0}
          className="rounded-md bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40"
          title="Cancel all queued and running jobs for this campaign"
          onClick={async () => {
            setStopping(true);
            try {
              await api.cancelCampaignJobs(id);
              await refresh();
            } finally {
              setStopping(false);
            }
          }}
        >
          {stopping
            ? "Stopping…"
            : activeCount
              ? `Stop all (${activeCount})`
              : "Stop all"}
        </button>
        <a
          href={`/campaigns/${id}/review`}
          className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm text-ink-900"
        >
          Go to review
        </a>
      </div>

      <div className="mt-8">
        <h2 className="text-xs uppercase tracking-wider text-ink-700">Planned assets by size</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-ink-200 text-xs uppercase tracking-wider text-ink-700">
              <tr>
                <th className="px-3 py-2">Cell</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Pixels</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((r) => (
                <tr key={`${r.cellId}-${r.sizeId}`} className="border-b border-ink-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.cellId}</td>
                  <td className="px-3 py-2">
                    {r.label}{" "}
                    <span className="text-ink-700">({r.aspect})</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.width}×{r.height}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.status}</td>
                </tr>
              ))}
              {planRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-sm text-ink-700">
                    No matrix cells yet — build from rail first.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="mt-8 space-y-2">
        <li className="text-xs uppercase tracking-wider text-ink-700">Active jobs</li>
        {jobs.length === 0 ? (
          <li className="text-sm text-ink-700">No jobs yet — generate variants on Matrix, then Assemble from Review.</li>
        ) : null}
        {jobs.map((j) => (
          <JobProgressRow key={j.id} job={j} onCancelled={() => void refresh()} />
        ))}
      </ul>
    </div>
  );
}
