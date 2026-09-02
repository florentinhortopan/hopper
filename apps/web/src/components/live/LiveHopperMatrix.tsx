"use client";

import { useMemo, useState, useEffect } from "react";
import type {
  Job,
  MatrixCell,
  OutputSize,
  ReviewEntry,
} from "@attatta/shared";
import {
  MediaLightbox,
  SizeMediaFrame,
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
  /** List with per-row expand is default — scales when many variants. */
  const [view, setView] = useState<"xy" | "list">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSizeId, setPreviewSizeId] = useState<string | null>(null);
  /** Multiple rows may stay open so Keep/Kill stays next to each variant. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
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

  // Drop expand state for cells that left the matrix
  useEffect(() => {
    const ids = new Set(cells.map((c) => c.cellId));
    setExpandedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [cells]);

  function selectCell(cellId: string, sizeId?: string | null) {
    setSelectedId(cellId);
    if (sizeId) setPreviewSizeId(sizeId);
  }

  function toggleExpand(cellId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
    selectCell(cellId);
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

  const lightboxGallery = useMemo((): MediaLightboxState[] => {
    if (!lightbox || !selected) return [];
    const out: MediaLightboxState[] = [];
    for (const s of sizes) {
      const path = sizeAssetMediaPath(selected, s.id);
      if (!path) continue;
      out.push({
        path,
        rev: sizeAssetMediaRev(selected, s.id) || `${s.id}:${path}`,
        label: `${selected.cellId} · ${s.aspect}`,
        aspect: s.aspect,
        width: s.width,
        height: s.height,
        sizeId: s.id,
      });
    }
    return out;
  }, [lightbox, selected, sizes]);

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
            title="Expandable rows — sizes & Keep/Kill inline"
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
          {cells.map((cell) => {
            const open = expandedIds.has(cell.cellId);
            const listSizeId =
              previewSizeId && selected?.cellId === cell.cellId
                ? previewSizeId
                : firstReadySizeId(cell, sizes);
            const listAspect =
              sizes.find((s) => s.id === listSizeId)?.aspect || null;
            return (
              <li
                key={cell.cellId}
                className={`rounded border ${
                  open
                    ? "border-ink-900 bg-white"
                    : selected?.cellId === cell.cellId
                      ? "border-ink-300 bg-white"
                      : "border-ink-100 bg-white/60"
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full cursor-pointer items-start gap-2 px-1.5 py-1 text-left"
                  aria-expanded={open}
                  onClick={() => toggleExpand(cell.cellId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpand(cell.cellId);
                    }
                  }}
                >
                  <span
                    className="mt-3 shrink-0 text-[10px] text-ink-500"
                    aria-hidden
                  >
                    {open ? "▾" : "▸"}
                  </span>
                  <div
                    className="h-12 shrink-0 overflow-hidden rounded"
                    style={{
                      aspectRatio: cssAspect(listAspect) || "9 / 16",
                    }}
                  >
                    <SizeMediaFrame
                      path={cellMediaPath(cell, listSizeId)}
                      rev={cellMediaRev(cell, listSizeId)}
                      aspect={listAspect}
                      label={cell.cellId}
                      className="h-full w-full border-0"
                    />
                  </div>
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
                      onSizeTap={(size) => {
                        if (!open) {
                          setExpandedIds((prev) =>
                            new Set(prev).add(cell.cellId),
                          );
                        }
                        openSizePreview(cell, size);
                      }}
                    />
                    <p className="mt-0.5 text-[10px] text-ink-500">
                      {reviewOf(reviews, cell.cellId)}
                      {!open ? " · expand for sizes" : ""}
                    </p>
                  </div>
                </div>
                {open ? (
                  <div className="border-t border-ink-100 px-2 pb-2 pt-2">
                    <VariantSizeDetail
                      cell={cell}
                      sizes={sizes}
                      jobs={jobs}
                      reviews={reviews}
                      previewSizeId={
                        selected?.cellId === cell.cellId
                          ? previewSizeId
                          : firstReadySizeId(cell, sizes)
                      }
                      busyId={busyId}
                      onPreviewSize={(sizeId) => {
                        selectCell(cell.cellId, sizeId);
                      }}
                      onOpenSize={(size, path) =>
                        openSizePreview(cell, size, path)
                      }
                      onDecision={(decision, sizeId) =>
                        void setDecision(cell.cellId, decision, sizeId)
                      }
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* XY views still use a shared detail bay; List expands each row inline. */}
      {view === "xy" && selected ? (
        <div className="rounded-lg border border-ink-200 bg-white p-2">
          <VariantSizeDetail
            cell={selected}
            sizes={sizes}
            jobs={jobs}
            reviews={reviews}
            previewSizeId={previewSizeId}
            busyId={busyId}
            showHero
            onPreviewSize={(sizeId) => selectCell(selected.cellId, sizeId)}
            onOpenSize={(size, path) =>
              openSizePreview(selected, size, path)
            }
            onDecision={(decision, sizeId) =>
              void setDecision(selected.cellId, decision, sizeId)
            }
          />
        </div>
      ) : view === "xy" ? (
        <p className="text-[10px] text-ink-500">
          Prepare a matrix in Magic to review combinations here.
        </p>
      ) : cells.length === 0 ? (
        <p className="text-[10px] text-ink-500">
          Prepare a matrix in Magic to review combinations here.
        </p>
      ) : null}

      {lightbox ? (
        <MediaLightbox
          key={lightbox.sizeId || lightbox.path}
          state={lightbox}
          items={lightboxGallery}
          onClose={() => setLightbox(null)}
          onSelect={(next) => {
            setLightbox(next);
            if (next.sizeId) setPreviewSizeId(next.sizeId);
          }}
        />
      ) : null}
    </div>
  );
}

function VariantSizeDetail({
  cell,
  sizes,
  jobs,
  reviews,
  previewSizeId,
  busyId,
  showHero = false,
  onPreviewSize,
  onOpenSize,
  onDecision,
}: {
  cell: MatrixCell;
  sizes: OutputSize[];
  jobs: Job[];
  reviews: ReviewEntry[];
  previewSizeId: string | null;
  busyId: string | null;
  showHero?: boolean;
  onPreviewSize: (sizeId: string) => void;
  onOpenSize: (size: OutputSize, path: string | null) => void;
  onDecision: (
    decision: "approved" | "rejected" | "pending",
    sizeId?: string | null,
  ) => void;
}) {
  const selectedPath = cellMediaPath(cell, previewSizeId);
  const selectedRev = cellMediaRev(cell, previewSizeId);
  const selectedSize = sizes.find((s) => s.id === previewSizeId) || null;

  return (
    <div
      className={
        showHero
          ? "flex flex-col gap-2 sm:flex-row sm:items-start"
          : "space-y-2"
      }
    >
      {showHero ? (
        <div className="shrink-0">
          <SizeMediaFrame
            path={selectedPath}
            rev={selectedRev}
            aspect={selectedSize?.aspect}
            label={
              selectedSize
                ? `${cell.cellId} · ${selectedSize.aspect}`
                : cell.cellId
            }
            bay
            onOpen={
              selectedPath && selectedSize
                ? () => onOpenSize(selectedSize, selectedPath)
                : undefined
            }
          />
          {selectedSize ? (
            <p className="mt-1 font-mono text-[9px] text-ink-500">
              {selectedSize.aspect} · {selectedSize.width}×
              {selectedSize.height}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        {showHero ? (
          <>
            <p className="font-mono text-[10px] text-ink-500">
              {cell.cellId}
              {selectedSize ? ` · ${selectedSize.aspect}` : ""}
            </p>
            <p className="text-[11px] font-medium text-ink-900">
              {cellComboLabel(cell)}
            </p>
            {cell.sceneTag ? (
              <p className="text-[10px] text-ink-600">
                Scene / plate beat:{" "}
                <span className="font-mono">{cell.sceneTag}</span>
              </p>
            ) : null}
            <p className="mt-1 line-clamp-2 text-[10px] text-ink-600">
              {cell.copy?.setup || "—"}
              {cell.copy?.punchline ? ` → ${cell.copy.punchline}` : ""}
            </p>
          </>
        ) : (
          <p className="line-clamp-2 text-[10px] text-ink-600">
            {cell.copy?.setup || "—"}
            {cell.copy?.punchline ? ` → ${cell.copy.punchline}` : ""}
          </p>
        )}
        <p className="mt-2 text-[9px] uppercase tracking-wide text-ink-500">
          Sizes — tap to preview · Keep/Kill per size for Celtra
        </p>
        <div className="mt-1 flex flex-col gap-1">
          {sizes.map((s) => {
            const tone = sizeSlotTone(cell, s, jobs);
            const path = sizeAssetMediaPath(cell, s.id);
            const active = previewSizeId === s.id;
            const sizeDecision = reviewOf(reviews, cell.cellId, s.id);
            const busyKey = `${cell.cellId}:${s.id}`;
            return (
              <div
                key={s.id}
                className={`flex w-full items-center gap-2 rounded border px-1.5 py-1 ${
                  active ? "border-ink-900 bg-ink-50" : "border-ink-100"
                }`}
              >
                <div
                  className="h-10 shrink-0 overflow-hidden"
                  style={{
                    aspectRatio: cssAspect(s.aspect) || "9 / 16",
                  }}
                >
                  <SizeMediaFrame
                    path={path}
                    rev={sizeAssetMediaRev(cell, s.id)}
                    aspect={s.aspect}
                    label={`${cell.cellId} · ${s.aspect}`}
                    className="h-full w-full border-0"
                    onOpen={path ? () => onOpenSize(s, path) : undefined}
                  />
                </div>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-[10px]"
                  title={
                    path
                      ? `Preview ${s.aspect} (${s.width}×${s.height})`
                      : `${s.label}: ${toneLabel(tone)}`
                  }
                  onClick={() => {
                    onPreviewSize(s.id);
                    onOpenSize(s, path);
                  }}
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
                    onClick={() => onDecision("approved", s.id)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] disabled:opacity-40"
                    disabled={busyId === busyKey}
                    title="Kill this size — skip in zip"
                    onClick={() => onDecision("rejected", s.id)}
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
            disabled={busyId === cell.cellId}
            onClick={() => onDecision("approved")}
          >
            Keep all sizes
          </button>
          <button
            type="button"
            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] disabled:opacity-40"
            disabled={busyId === cell.cellId}
            onClick={() => onDecision("rejected")}
          >
            Kill all
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-0.5 text-[10px] disabled:opacity-40"
            disabled={busyId === cell.cellId}
            onClick={() => onDecision("pending")}
          >
            Reset all
          </button>
        </div>
      </div>
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
                      <div
                        className="h-14 w-auto overflow-hidden rounded"
                        style={{
                          aspectRatio: thumbSize
                            ? cssAspect(
                                sizes.find((s) => s.id === thumbSize)?.aspect,
                              ) || "9 / 16"
                            : "9 / 16",
                        }}
                      >
                        <SizeMediaFrame
                          path={cellMediaPath(cell, thumbSize)}
                          rev={cellMediaRev(cell, thumbSize)}
                          aspect={
                            sizes.find((s) => s.id === thumbSize)?.aspect
                          }
                          label={cell.cellId}
                          className="h-full w-full border-0"
                        />
                      </div>
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
