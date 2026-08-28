"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  getCeltraTemplateProfile,
  listPreviewCells,
  resolveMatrixCell,
  sceneTagToCeltraFrame,
  type Campaign,
  type MatrixCell,
  type ReviewEntry,
} from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";
import { triggerApiDownload } from "@/lib/download";

function cellHasPlate(cell: MatrixCell | undefined | null): boolean {
  if (!cell) return false;
  if (cell.sizeAssets?.some((a) => a.genPath || a.outputPath || a.previewPath)) {
    return true;
  }
  return Boolean(cell.outputPath || cell.previewPath);
}

export default function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [result, setResult] = useState<{
    zipPath: string;
    downloadUrl: string;
    fileName?: string;
    rowCount?: number;
  } | null>(null);
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

  const profile = useMemo(
    () =>
      campaign
        ? getCeltraTemplateProfile(campaign.celtraTemplateProfileId)
        : null,
    [campaign],
  );

  if (!campaign || !profile) return <p className="text-sm">Loading…</p>;

  const approved = reviews.filter((r) => r.decision === "approved");
  const withPlate = approved.filter((r) => {
    const cell = resolveMatrixCell(campaign, r.cellId)?.cell;
    return cellHasPlate(cell);
  });
  const missingPlate = approved.length - withPlate.length;

  return (
    <div>
      <StepNav campaignId={id} current="package" />
      <h1 className="font-display text-3xl">Celtra package</h1>
      <p className="mt-1 text-sm text-ink-700">
        Emits the Social Video content matrix (XLSX + CSV) and kept frame plates.
        Uses generated plates directly — Remotion assemble is not required.
      </p>

      <div className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <div className="text-sm">
          <strong>{approved.length}</strong> approved ·{" "}
          <strong>{withPlate.length}</strong> with plates
          {missingPlate > 0 ? (
            <span className="text-amber-800"> · {missingPlate} missing media</span>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-1 text-xs text-ink-700 sm:grid-cols-2">
          <div>
            <dt className="text-ink-500">Celtra profile</dt>
            <dd className="font-mono">{profile.id}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Ingest sheet</dt>
            <dd>{profile.ingestSheet}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-500">Note</dt>
            <dd>{profile.celtraTemplateNote || "—"}</dd>
          </div>
        </dl>

        <ul className="mt-4 space-y-1 text-sm text-ink-700">
          <li className="text-xs uppercase tracking-wide text-ink-500">
            Celtra-ready checklist
          </li>
          <li>✓ Headers match Guarantee Tranche 3 Social Video (A–AL)</li>
          <li>
            {withPlate.length > 0 ? "✓" : "○"} Approved rows with plate media:{" "}
            {withPlate.length}
          </li>
          <li>○ Thumbnail / Logo formula columns left blank (no #VALUE!)</li>
          <li>○ Remotion master not required</li>
        </ul>

        <ul className="mt-4 space-y-1 text-sm text-ink-700">
          {approved.map((r) => {
            const resolved = resolveMatrixCell(campaign, r.cellId);
            const cell = resolved?.cell;
            const archive = resolved?.pool === "retired";
            const frame = sceneTagToCeltraFrame(profile, cell?.sceneTag) ?? "F2";
            const hasPlate = cellHasPlate(cell);
            return (
              <li key={r.cellId}>
                <span className="font-mono text-xs">{r.cellId}</span>
                {archive ? (
                  <span className="ml-1 text-[10px] uppercase text-ink-500">
                    archive
                  </span>
                ) : null}
                {" · "}
                frame {frame}
                {" · "}
                {hasPlate ? "plate ok" : "missing plate"}
                {cell?.outputPath ? " · has Remotion master" : ""}
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        className="mt-6 rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        disabled={withPlate.length === 0}
        onClick={async () => {
          setError(null);
          try {
            const next = await api.package(id);
            setResult(next);
            triggerApiDownload(next.downloadUrl, next.fileName);
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
          <div>
            Zip ready
            {result.rowCount != null ? ` · ${result.rowCount} row(s)` : ""}
            {result.fileName ? (
              <>
                {" "}
                · <span className="font-mono text-xs">{result.fileName}</span>
              </>
            ) : (
              " (content_matrix.xlsx + assets/)"
            )}
          </div>
          <button
            type="button"
            className="mt-2 rounded-md bg-ink-900 px-3 py-1.5 text-sm text-white"
            onClick={() =>
              triggerApiDownload(result.downloadUrl, result.fileName)
            }
          >
            Download zip again
          </button>
          <div className="mt-2 font-mono text-xs text-ink-700">{result.zipPath}</div>
        </div>
      ) : null}

      {entries.filter((e) => e.isArchive).length > 0 ? (
        <p className="mt-4 text-xs text-ink-500">
          {entries.filter((e) => e.isArchive).length} archive cuts selectable in
          review.
        </p>
      ) : null}
    </div>
  );
}
