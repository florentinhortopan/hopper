"use client";

import { useMemo, useState, useEffect } from "react";
import type {
  Job,
  MatrixCell,
  OutputSize,
  ReviewEntry,
} from "@attatta/shared";
import {
  LiveThumb,
  MediaLightbox,
  cellMediaPath,
  cellMediaRev,
  cssAspect,
  sizeAssetMediaPath,
  sizeAssetMediaRev,
  type MediaLightboxState,
} from "@/components/live/LiveThumb";
import {
  axisValue,
  cellComboLabel,
  detectComboAxes,
  findCellAt,
  reviewOf,
  shortId,
  sizeSlotTone,
  toneClass,
  toneLabel,
  type ComboAxisKey,
} from "@/components/live/liveMatrixUtils";
import { api } from "@/lib/api";

type Props = {
  campaignId: string;
  cells: MatrixCell[];
  sizes: OutputSize[];
  reviews: ReviewEntry[];
  refreshToken?: number;
  onChanged: () => Promise<void> | void;
};

function firstReadySizeId(cell: MatrixCell, sizes: OutputSize[]): string | null {
  for (const s of sizes) {
    if (sizeAssetMediaPath(cell, s.id)) return s.id;
  }
  return sizes[0]?.id ?? null;
}

export function LiveHopperMatrix({
  campaignId,
  cells,
  sizes,
  reviews,
  refreshToken = 0,
  onChanged,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [view, setView] = useState<"xy" | "list">("xy");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSizeId, setPreviewSizeId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<MediaLightboxState | null>(null);

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

  const axes = useMemo(() => detectComboAxes(cells), [cells]);
  const xAxis = axes[0];
  const yAxis = axes[1] || null;
  const canComboXy = Boolean(xAxis && yAxis && xAxis.key !== yAxis.key);

  const selected =
    cells.find((c) => c.cellId === selectedId) || cells[0] || null;

  useEffect(() => {
    if (!selected) {
      setPreviewSizeId(null);
      return;
    }
    setPreviewSizeId((prev) => {
      if (prev && sizeAssetMediaPath(selected, prev)) return prev;
      return firstReadySizeId(selected, sizes);
    });
  }, [selected?.cellId, selected, sizes]);

  function selectCell(cellId: string, sizeId?: string | null) {
    setSelectedId(cellId);
    if (sizeId) setPreviewSizeId(sizeId);
  }

  function openSizePreview(
    cell: MatrixCell,
    size: OutputSize,
    pathOverride?: string | null,
  ) {
    const path = pathOverride?.trim() || sizeAssetMediaPath(cell, size.id);
    selectCell(cell.cellId, size.id);
    if (!path) return;
    setLightbox({
      path,
      rev: sizeAssetMediaRev(cell, size.id) || `${size.id}:${path}`,
      label: `${cell.cellId} · ${size.aspect}`,
      aspect: size.aspect,
      width: size.width,
      height: size.height,
      sizeId: size.id,
    });
  }

  async function setDecision(
    cellId: string,
    decision: "approved" | "rejected" | "pending",
    sizeId?: string | null,
  ) {
    const busyKey = sizeId ? `${cellId}:${sizeId}` : cellId;
    setBusyId(busyKey);
    try {
      await api.setReview(campaignId, cellId, {
        decision,
        sizeId: sizeId ?? null,
      });
      // Whole-variant Keep/Kill also stamps every Settings size so Celtra pack matches.
      if (!sizeId && sizes.length) {
        await Promise.all(
          sizes.map((s) =>
            api.setReview(campaignId, cellId, {
              decision,
              sizeId: s.id,
            }),
          ),
        );
      }
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  const selectedPath = selected
    ? cellMediaPath(selected, previewSizeId)
    : null;
  const selectedRev = selected
    ? cellMediaRev(selected, previewSizeId)
    : null;
  const selectedSize = sizes.find((s) => s.id === previewSizeId) || null;

  return (
    <div className="space-y-3 border-b border-ink-100 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Matrix · review
        </h3>
        <span className="text-[10px] text-ink-500">
          {cells.length} combo(s) · {sizes.length} size(s)
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              view === "xy"
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-ink-200 bg-white hover:bg-ink-50"
            }`}
            title={
              canComboXy
                ? "Combination grid"
                : "Variants × sizes coverage grid"
            }
            onClick={() => setView("xy")}
          >
            XY
          </button>
          <button
            type="button"
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              view === "list"
                ? "border-ink-900 bg-ink-900 text-white"
                : "border-ink-200 bg-white hover:bg-ink-50"
            }`}
            title="Flat list"
            onClick={() => setView("list")}
          >
            List
          </button>
        </div>
      </div>

      <p className="text-[10px] text-ink-500">
        <a className="underline" href={`/campaigns/${campaignId}/matrix`}>
          Advanced matrix
        </a>
        {" · "}
        <a className="underline" href={`/campaigns/${campaignId}/variants`}>
          Variants
        </a>
        {" · "}
        <a className="underline" href={`/campaigns/${campaignId}/review`}>
          Assemble
        </a>
      </p>

      {view === "xy" && canComboXy && xAxis && yAxis ? (
        <XyGrid
          cells={cells}
          sizes={sizes}
          jobs={jobs}
          reviews={reviews}
          xKey={xAxis.key}
          xLabel={xAxis.label}
          xValues={xAxis.values}
          yKey={yAxis.key}
          yLabel={yAxis.label}
          yValues={yAxis.values}
          selectedId={selected?.cellId ?? null}
          previewSizeId={previewSizeId}
          onSelect={selectCell}
        />
      ) : view === "xy" ? (
        <SizeCoverageGrid
          cells={cells}
          sizes={sizes}
          jobs={jobs}
          selectedId={selected?.cellId ?? null}
          previewSizeId={previewSizeId}
          onSelect={selectCell}
          onOpenSize={openSizePreview}
        />
      ) : (
        <ul className="space-y-1.5">
          {cells.map((cell) => (
            <li key={cell.cellId}>
              <div
                role="button"
                tabIndex={0}
                className={`flex w-full cursor-pointer items-start gap-2 rounded border px-1.5 py-1 text-left ${
                  selected?.cellId === cell.cellId
                    ? "border-ink-900 bg-white"
                    : "border-ink-100 bg-white/60"
                }`}
                onClick={() => selectCell(cell.cellId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectCell(cell.cellId);
                  }
                }}
              >
                <LiveThumb
                  filePath={cellMediaPath(
                    cell,
                    previewSizeId && selected?.cellId === cell.cellId
                      ? previewSizeId
                      : firstReadySizeId(cell, sizes),
                  )}
                  rev={cellMediaRev(
                    cell,
                    previewSizeId && selected?.cellId === cell.cellId
                      ? previewSizeId
                      : firstReadySizeId(cell, sizes),
                  )}
                  label={cell.cellId}
                  emptyHint="…"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] text-ink-500">
                    {cell.cellId}
                    {cell.sceneTag ? ` · ${cell.sceneTag}` : ""}
                  </p>
                  <p className="truncate text-[11px] text-ink-800">
                    {cellComboLabel(cell)}
                  </p>
                  <SizeDots
                    cell={cell}
                    sizes={sizes}
                    jobs={jobs}
                    activeSizeId={
                      selected?.cellId === cell.cellId ? previewSizeId : null
                    }
                    onSizeTap={(size) => openSizePreview(cell, size)}
                  />
                  <p className="mt-0.5 text-[10px] text-ink-500">
                    {reviewOf(reviews, cell.cellId)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <div className="rounded-lg border border-ink-200 bg-white p-2">
          <div className="flex items-start gap-2">
            <LiveThumb
              filePath={selectedPath}
              rev={selectedRev}
              label={
                selectedSize
                  ? `${selected.cellId} · ${selectedSize.aspect}`
                  : selected.cellId
              }
              size="md"
              frameAspect={cssAspect(selectedSize?.aspect)}
              onOpenPreview={
                selectedSize
                  ? (path) => openSizePreview(selected, selectedSize, path)
                  : undefined
              }
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] text-ink-500">
                {selected.cellId}
                {selectedSize ? ` · ${selectedSize.aspect}` : ""}
              </p>
              <p className="text-[11px] font-medium text-ink-900">
                {cellComboLabel(selected)}
              </p>
              {selected.sceneTag ? (
                <p className="text-[10px] text-ink-600">
                  Scene / plate beat:{" "}
                  <span className="font-mono">{selected.sceneTag}</span>
                </p>
              ) : null}
              <p className="mt-1 line-clamp-2 text-[10px] text-ink-600">
                {selected.copy?.setup || "—"}
                {selected.copy?.punchline
                  ? ` → ${selected.copy.punchline}`
                  : ""}
              </p>
              <p className="mt-2 text-[9px] uppercase tracking-wide text-ink-500">
                Sizes — tap thumb to preview · Keep/Kill per size for Celtra
              </p>
              <div className="mt-1 flex flex-col gap-1">
                {sizes.map((s) => {
                  const tone = sizeSlotTone(selected, s, jobs);
                  const path = sizeAssetMediaPath(selected, s.id);
                  const active = previewSizeId === s.id;
                  const sizeDecision = reviewOf(reviews, selected.cellId, s.id);
                  const busyKey = `${selected.cellId}:${s.id}`;
                  return (
                    <div
                      key={s.id}
                      className={`flex w-full items-center gap-2 rounded border px-1.5 py-1 ${
                        active
                          ? "border-ink-900 bg-ink-50"
                          : "border-ink-100"
                      }`}
                    >
                      <LiveThumb
                        filePath={path}
                        rev={sizeAssetMediaRev(selected, s.id)}
                        label={`${selected.cellId} · ${s.aspect} (${s.width}×${s.height})`}
                        emptyHint={tone === "running" ? "…" : "—"}
                        className="!h-9"
                        frameAspect={cssAspect(s.aspect)}
                        onOpenPreview={(path) =>
                          openSizePreview(selected, s, path)
                        }
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left text-[10px]"
                        title={
                          path
                            ? `Preview ${s.aspect} (${s.width}×${s.height})`
                            : `${s.label}: ${toneLabel(tone)}`
                        }
                        onClick={() => openSizePreview(selected, s, path)}
                      >
                        <span
                          className={`mr-1 inline-block h-2 w-2 rounded-full ${toneClass(tone)}`}
                        />
                        <span className="font-medium">{s.aspect}</span>
                        <span className="text-ink-500">
                          {" "}
                          {s.width}×{s.height} · {toneLabel(tone)}
                          {sizeDecision !== "pending"
                            ? ` · ${sizeDecision === "approved" ? "kept" : "killed"}`
                            : ""}
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[9px] disabled:opacity-40"
                          disabled={busyId === busyKey || !path}
                          title="Keep this size for Celtra zip"
                          onClick={() =>
                            void setDecision(selected.cellId, "approved", s.id)
                          }
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] disabled:opacity-40"
                          disabled={busyId === busyKey}
                          title="Kill this size — skip in zip"
                          onClick={() =>
                            void setDecision(selected.cellId, "rejected", s.id)
                          }
                        >
                          Kill
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] disabled:opacity-40"
                  disabled={busyId === selected.cellId}
                  onClick={() =>
                    void setDecision(selected.cellId, "approved")
                  }
                >
                  Keep all sizes
                </button>
                <button
                  type="button"
                  className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] disabled:opacity-40"
                  disabled={busyId === selected.cellId}
                  onClick={() =>
                    void setDecision(selected.cellId, "rejected")
                  }
                >
                  Kill all
                </button>
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-0.5 text-[10px] disabled:opacity-40"
                  disabled={busyId === selected.cellId}
                  onClick={() =>
                    void setDecision(selected.cellId, "pending")
                  }
                >
                  Reset all
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-ink-500">
          Prepare a matrix in Magic to review combinations here.
        </p>
      )}

      {lightbox ? (
        <MediaLightbox
          key={`${lightbox.sizeId || ""}:${lightbox.path}:${lightbox.rev || ""}`}
          state={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

function SizeDots({
  cell,
  sizes,
  jobs,
  activeSizeId,
  onSizeTap,
}: {
  cell: MatrixCell;
  sizes: OutputSize[];
  jobs: Job[];
  activeSizeId?: string | null;
  onSizeTap?: (size: OutputSize) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {sizes.map((s) => {
        const tone = sizeSlotTone(cell, s, jobs);
        const active = activeSizeId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] ${
              active
                ? "bg-ink-900 text-white"
                : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
            title={`${s.label}: ${toneLabel(tone)} — tap to preview`}
            onClick={(e) => {
              e.stopPropagation();
              onSizeTap?.(s);
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${toneClass(tone)}`} />
            {s.aspect}
          </button>
        );
      })}
    </div>
  );
}

/** Fallback XY when only one combo axis — variants × Settings sizes. */
function SizeCoverageGrid({
  cells,
  sizes,
  jobs,
  selectedId,
  previewSizeId,
  onSelect,
  onOpenSize,
}: {
  cells: MatrixCell[];
  sizes: OutputSize[];
  jobs: Job[];
  selectedId: string | null;
  previewSizeId: string | null;
  onSelect: (id: string, sizeId?: string | null) => void;
  onOpenSize: (cell: MatrixCell, size: OutputSize) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[10px] text-ink-500">
        Variants × sizes — tap a size cell to preview
      </p>
      <table className="w-full min-w-[16rem] border-collapse text-[10px]">
        <thead>
          <tr className="border-b border-ink-200 text-ink-500">
            <th className="px-1 py-1 text-left font-medium">Variant</th>
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
          {cells.slice(0, 32).map((cell) => {
            const selected = selectedId === cell.cellId;
            return (
              <tr key={cell.cellId} className="border-b border-ink-50">
                <td className="max-w-[9rem] px-1 py-0.5">
                  <button
                    type="button"
                    className={`w-full truncate rounded px-1 py-0.5 text-left ${
                      selected
                        ? "bg-ink-900 text-white"
                        : "hover:bg-ink-50"
                    }`}
                    onClick={() => onSelect(cell.cellId)}
                    title={cellComboLabel(cell)}
                  >
                    <span className="font-mono text-[9px] opacity-70">
                      {cell.sceneTag || shortId(cell.cellId, 8)}
                    </span>
                    <span className="block truncate text-[10px]">
                      {cellComboLabel(cell)}
                    </span>
                  </button>
                </td>
                {sizes.map((s) => {
                  const tone = sizeSlotTone(cell, s, jobs);
                  const active = selected && previewSizeId === s.id;
                  return (
                    <td key={s.id} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 ${
                          active ? "ring-1 ring-ink-900 " : ""
                        }${
                          tone === "ready"
                            ? "bg-emerald-50 text-emerald-900"
                            : tone === "running"
                              ? "bg-amber-50 text-amber-950"
                              : tone === "failed"
                                ? "bg-red-50 text-red-800"
                                : "bg-ink-50 text-ink-500"
                        }`}
                        title={`${s.label}: ${toneLabel(tone)} — tap to preview`}
                        onClick={() => onOpenSize(cell, s)}
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
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {cells.length > 32 ? (
        <p className="mt-1 text-[10px] text-ink-500">
          +{cells.length - 32} more — use List or Advanced matrix
        </p>
      ) : null}
    </div>
  );
}

function XyGrid({
  cells,
  sizes,
  jobs,
  reviews,
  xKey,
  xLabel,
  xValues,
  yKey,
  yLabel,
  yValues,
  selectedId,
  previewSizeId,
  onSelect,
}: {
  cells: MatrixCell[];
  sizes: OutputSize[];
  jobs: Job[];
  reviews: ReviewEntry[];
  xKey: ComboAxisKey;
  xLabel: string;
  xValues: string[];
  yKey: ComboAxisKey;
  yLabel: string;
  yValues: string[];
  selectedId: string | null;
  previewSizeId: string | null;
  onSelect: (id: string, sizeId?: string | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[10px] text-ink-500">
        {yLabel} × {xLabel}
      </p>
      <table className="w-full min-w-[16rem] border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-warm-paper px-1 py-1 text-left font-medium text-ink-500">
              {yLabel} \ {xLabel}
            </th>
            {xValues.map((xv) => (
              <th
                key={xv}
                className="px-1 py-1 text-center font-mono font-medium text-ink-600"
                title={xv}
              >
                {shortId(xv, 8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yValues.map((yv) => (
            <tr key={yv}>
              <th
                className="sticky left-0 bg-warm-paper px-1 py-1 text-left font-mono font-medium text-ink-600"
                title={yv}
              >
                {shortId(yv, 8)}
              </th>
              {xValues.map((xv) => {
                const cell = findCellAt(cells, xKey, xv, yKey, yv);
                if (!cell) {
                  return (
                    <td
                      key={xv}
                      className="border border-ink-50 bg-ink-50/40 px-0.5 py-1 text-center text-ink-300"
                    >
                      ·
                    </td>
                  );
                }
                const decision = reviewOf(reviews, cell.cellId);
                const selected = selectedId === cell.cellId;
                const thumbSize =
                  (selected && previewSizeId) ||
                  sizes.find((s) => sizeAssetMediaPath(cell, s.id))?.id ||
                  sizes[0]?.id ||
                  null;
                return (
                  <td key={xv} className="border border-ink-100 p-0.5">
                    <button
                      type="button"
                      className={`flex w-full flex-col items-center gap-0.5 rounded px-0.5 py-1 ${
                        selected
                          ? "bg-ink-900 text-white"
                          : decision === "approved"
                            ? "bg-emerald-50"
                            : decision === "rejected"
                              ? "bg-ink-100 opacity-60"
                              : "bg-white hover:bg-ink-50"
                      }`}
                      onClick={() => onSelect(cell.cellId)}
                      title={`${cell.cellId}\n${cellComboLabel(cell)}`}
                    >
                      <LiveThumb
                        filePath={cellMediaPath(cell, thumbSize)}
                        rev={cellMediaRev(cell, thumbSize)}
                        label={cell.cellId}
                        emptyHint="…"
                      />
                      <span
                        className={`font-mono text-[8px] ${
                          selected ? "text-white/80" : "text-ink-500"
                        }`}
                      >
                        {axisValue(cell, "sceneTag") !== "—"
                          ? shortId(cell.sceneTag, 6)
                          : shortId(cell.cellId, 6)}
                      </span>
                      <div className="flex gap-0.5">
                        {sizes.map((s) => (
                          <span
                            key={s.id}
                            className={`h-1.5 w-1.5 rounded-full ${toneClass(
                              sizeSlotTone(cell, s, jobs),
                            )} ${selected && previewSizeId === s.id ? "ring-1 ring-ember-400" : selected ? "ring-1 ring-white/40" : ""}`}
                            title={`${s.aspect}: ${toneLabel(sizeSlotTone(cell, s, jobs))}`}
                          />
                        ))}
                      </div>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
