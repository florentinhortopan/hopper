"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  listPreviewCells,
  resolveMatrixCell,
  type Campaign,
  type ReviewEntry,
} from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

export default function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [result, setResult] = useState<{ zipPath: string; downloadUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.getCampaign(id), api.getReviews(id)]).then(([c, r]) => {
      setCampaign(c);
      setReviews(r);
    });
  }, [id]);

  const entries = useMemo(
    () => (campaign ? listPreviewCells(campaign) : []),
    [campaign],
  );

  if (!campaign) return <p className="text-sm">Loading…</p>;

  const approved = reviews.filter((r) => r.decision === "approved");

  return (
    <div>
      <StepNav campaignId={id} current="package" />
      <h1 className="font-display text-3xl">Celtra package</h1>
      <p className="mt-1 text-sm text-ink-700">
        Finished masters + matrix.json — includes approved live and archive cuts.
      </p>

      <div className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <div className="text-sm">
          <strong>{approved.length}</strong> approved · token pack{" "}
          <code>{campaign.designTokenPackId}</code> · template{" "}
          <code>{campaign.templateId}</code>
          {" · "}
          {entries.filter((e) => e.isArchive).length} archive selectable
        </div>
        <ul className="mt-4 space-y-1 text-sm text-ink-700">
          {approved.map((r) => {
            const resolved = resolveMatrixCell(campaign, r.cellId);
            const cell = resolved?.cell;
            const archive = resolved?.pool === "retired";
            return (
              <li key={r.cellId}>
                <span className="font-mono text-xs">{r.cellId}</span>
                {archive ? (
                  <span className="ml-1 text-[10px] uppercase text-ink-500">
                    archive
                  </span>
                ) : null}
                {" · "}
                {cell?.handsId || "—"} ·{" "}
                {cell?.outputPath ? "has mp4" : "missing mp4"}
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        className="mt-6 rounded-md bg-ink-900 px-4 py-2 text-sm text-white"
        onClick={async () => {
          setError(null);
          try {
            setResult(await api.package(id));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Download Celtra package
      </button>

      {error ? (
        <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-800">
          {error}
        </pre>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-ink-200 bg-white p-4 text-sm">
          <div>Zip ready:</div>
          <a
            className="mt-2 inline-block"
            href={`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787"}${result.downloadUrl}`}
          >
            Download zip
          </a>
          <div className="mt-2 font-mono text-xs text-ink-700">{result.zipPath}</div>
        </div>
      ) : null}
    </div>
  );
}
