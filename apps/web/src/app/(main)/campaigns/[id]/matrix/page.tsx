"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  DEFAULT_OUTPUT_SIZE_IDS,
  archiveIdOf,
  cellHasGen,
  cellHasVariantMedia,
  cellNeedsVariantGen,
  estimateQueueJobSeconds,
  formatDurationShort,
  remainingEstimateSeconds,
  type Campaign,
  type Job,
  type LibraryItem,
  type MatrixCell,
  type OutputSize,
  isPlateReady,
  makeArchiveRef,
  resolveOutputSizes,
} from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

type SizeFillTrack = {
  jobIds: string[];
  startedAt: number;
  etaSeconds: number;
  progress: number;
  message: string;
  status: Job["status"];
};

function sizeSlotKey(cellId: string, sizeId: string) {
  return `${cellId}:${sizeId}`;
}

/** Missing / wrong-aspect / failed — needs Comfy fill for this aspect. */
function sizeSlotNeedsFill(cell: MatrixCell, size: OutputSize): boolean {
  if (!cellNeedsVariantGen(cell)) return false;
  const a = cell.sizeAssets?.find((x) => x.sizeId === size.id);
  if (a?.status === "failed") return true;
  if (!a?.genPath?.trim()) return true;
  return (cell.sizeAssets ?? []).some(
    (o) =>
      o.sizeId !== size.id &&
      o.aspect !== size.aspect &&
      o.genPath === a.genPath,
  );
}

function trackFromJobs(jobs: Job[]): SizeFillTrack | null {
  if (!jobs.length) return null;
  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const primary = active[0] || jobs[0]!;
  const eta =
    jobs.reduce((m, j) => Math.max(m, j.etaSeconds ?? 0), 0) ||
    estimateQueueJobSeconds({ stage: "plates", includesComfy: true });
  const progress =
    jobs.reduce((s, j) => s + j.progress, 0) / Math.max(jobs.length, 1);
  let status: Job["status"] = "done";
  if (jobs.some((j) => j.status === "running")) status = "running";
  else if (jobs.some((j) => j.status === "queued")) status = "queued";
  else if (jobs.some((j) => j.status === "failed")) status = "failed";
  else if (jobs.every((j) => j.status === "cancelled")) status = "cancelled";
  return {
    jobIds: jobs.map((j) => j.id),
    startedAt: Math.min(...jobs.map((j) => Date.parse(j.createdAt) || Date.now())),
    etaSeconds: eta,
    progress,
    message: primary.message,
    status,
  };
}

/** Visual fan axes that can appear as matrix columns (not copy/setup). */
const AXIS_ORDER = ["hands", "attire", "background", "prop"] as const;
type AxisKey = (typeof AXIS_ORDER)[number];

type SortKey = "cell" | "variant" | AxisKey | `size:${string}`;

function cellAxisIds(cell: MatrixCell, axis: AxisKey): string[] {
  if (axis === "hands") return cell.handsId?.trim() ? [cell.handsId] : [];
  if (axis === "attire") return cell.attireId?.trim() ? [cell.attireId] : [];
  if (axis === "background")
    return cell.backgroundId?.trim() ? [cell.backgroundId] : [];
  return (cell.propIds ?? []).filter(Boolean);
}

function cellSortValue(cell: MatrixCell, key: SortKey): string {
  if (key === "cell") return cell.cellId;
  if (key === "hands" || key === "attire" || key === "background" || key === "prop") {
    return cellAxisIds(cell, key).join(",") || "";
  }
  if (key === "variant") {
    if (!cellNeedsVariantGen(cell)) return "0-n/a";
    if (cell.sizeAssets?.some((a) => a.status === "failed")) return "3-failed";
    if (cellHasVariantMedia(cell)) return "2-ready";
    return "1-pending";
  }
  const sizeId = key.slice("size:".length);
  return cell.sizeAssets?.find((a) => a.sizeId === sizeId)?.status || "pending";
}

function cellOmitsPlate(cell: MatrixCell, plateId: string): boolean {
  return (cell.genOmitIds ?? []).includes(plateId);
}

function PlateThumbLink({
  itemId,
  libById,
  campaignId,
  compact,
}: {
  itemId: string;
  libById: Map<string, LibraryItem>;
  campaignId: string;
  compact?: boolean;
}) {
  const item = libById.get(itemId);
  const label = item?.label || itemId;
  const media = item?.path
    ? api.libraryMediaUrl(itemId)
    : null;
  const href = `/campaigns/${campaignId}/ingredients#plate-${itemId}`;
  return (
    <a
      href={href}
      title={`Open ${label} on Ingredients`}
      className={`group inline-flex max-w-[11rem] items-center gap-1.5 rounded-md border border-warm-line bg-white no-underline transition-colors hover:border-ink-300 ${
        compact ? "py-0.5 pl-0.5 pr-1.5" : "py-1 pl-1 pr-2"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className={`relative shrink-0 overflow-hidden rounded bg-ink-900 ${
          compact ? "h-6 w-5" : "h-8 w-6"
        }`}
      >
        {media ? (
          item?.mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media} alt="" className="h-full w-full object-cover" />
          ) : (
            <video
              src={media}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          )
        ) : (
          <span className="flex h-full items-center justify-center text-[8px] text-ink-400">
            —
          </span>
        )}
      </span>
      <span className="min-w-0 truncate font-mono text-[10px] text-ink-800 group-hover:text-ember-600">
        {label}
      </span>
    </a>
  );
}

function variantLabel(cell: MatrixCell): string {
  if (!cellNeedsVariantGen(cell)) return "assemble";
  if (cell.sizeAssets?.some((a) => a.status === "failed" && !a.genPath)) {
    return "failed";
  }
  if (cellHasVariantMedia(cell)) return "ready";
  return "needs gen";
}

function mediaBadge(cell: MatrixCell): string | null {
  if (cellHasGen(cell)) return "had gen";
  if (cell.previewPath || cell.sizeAssets?.some((a) => a.previewPath)) {
    return "preview";
  }
  return null;
}

function SortTh({
  label,
  sub,
  active,
  dir,
  onClick,
}: {
  label: string;
  sub?: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex flex-col items-start text-left transition-colors ${
          active ? "text-ink-900" : "hover:text-ink-900"
        }`}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <span className="font-mono text-[10px] normal-case tracking-normal opacity-80">
            {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </span>
        {sub ? (
          <span className="font-mono normal-case tracking-normal text-[10px] opacity-70">
            {sub}
          </span>
        ) : null}
      </button>
    </th>
  );
}

export default function MatrixPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [planTotal, setPlanTotal] = useState(0);
  const [libById, setLibById] = useState<Map<string, LibraryItem>>(new Map());
  const [sortKey, setSortKey] = useState<SortKey>("cell");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<
    "preview" | "render" | "variants" | "rebuild" | "sizes" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQueued, setLastQueued] = useState<number | null>(null);
  const [packPreview, setPackPreview] = useState<Awaited<
    ReturnType<typeof api.promptPack>
  > | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  /** Live fill-missing jobs keyed by cellId:sizeId — in-matrix progress, no redirect. */
  const [sizeFills, setSizeFills] = useState<Record<string, SizeFillTrack>>({});
  const sizeFillsRef = useRef(sizeFills);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    sizeFillsRef.current = sizeFills;
  }, [sizeFills]);

  useEffect(() => {
    void Promise.all([
      api.getCampaign(id),
      api.assetPlan(id),
      api.campaignIngredients(id),
      api.jobs(id),
    ]).then(([c, plan, ing, jobs]) => {
      setCampaign(c);
      setPlanTotal(plan.total);
      setLibById(new Map(ing.items.map((i) => [i.id, i])));
      // Resume in-matrix progress for any live missing-size / plates jobs
      const live = jobs.filter(
        (j) =>
          (j.status === "queued" || j.status === "running") &&
          j.cellId &&
          j.sizeId &&
          (j.stage === "plates" || j.message.toLowerCase().includes("comfy")),
      );
      if (!live.length) return;
      const byKey = new Map<string, Job[]>();
      for (const j of live) {
        const k = sizeSlotKey(j.cellId!, j.sizeId!);
        const list = byKey.get(k) ?? [];
        list.push(j);
        byKey.set(k, list);
      }
      const next: Record<string, SizeFillTrack> = {};
      for (const [k, list] of byKey) {
        const t = trackFromJobs(list);
        if (t) next[k] = t;
      }
      setSizeFills(next);
    });
  }, [id]);

  const sizeFillKeys = Object.keys(sizeFills).join(",");
  useEffect(() => {
    if (!sizeFillKeys) return;
    const tick = window.setInterval(() => setNowTick(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void (async () => {
        const snapshot = sizeFillsRef.current;
        const keys = Object.keys(snapshot);
        if (!keys.length) return;
        const next = { ...snapshot };
        let changed = false;
        let anyLive = false;
        for (const key of keys) {
          const track = snapshot[key]!;
          const jobs: Job[] = [];
          for (const jobId of track.jobIds) {
            try {
              jobs.push(await api.getJob(jobId));
            } catch {
              /* keep prior */
            }
          }
          if (!jobs.length) continue;
          const updated = trackFromJobs(jobs);
          if (!updated) continue;
          changed = true;
          const terminal =
            updated.status === "done" ||
            updated.status === "failed" ||
            updated.status === "cancelled";
          if (terminal) {
            delete next[key];
          } else {
            next[key] = updated;
            anyLive = true;
          }
        }
        if (changed) setSizeFills(next);
        if (!anyLive && changed) {
          try {
            const [c, plan] = await Promise.all([
              api.getCampaign(id),
              api.assetPlan(id),
            ]);
            setCampaign(c);
            setPlanTotal(plan.total);
          } catch {
            /* ignore */
          }
        }
      })();
    }, 2000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [sizeFillKeys, id]);

  function rememberFillJobs(jobs: Job[]) {
    if (!jobs.length) return;
    setSizeFills((prev) => {
      const next = { ...prev };
      const byKey = new Map<string, Job[]>();
      for (const j of jobs) {
        if (!j.cellId || !j.sizeId) continue;
        const k = sizeSlotKey(j.cellId, j.sizeId);
        const list = byKey.get(k) ?? [];
        list.push(j);
        byKey.set(k, list);
      }
      for (const [k, list] of byKey) {
        const t = trackFromJobs(list);
        if (t) next[k] = t;
      }
      return next;
    });
  }

  const sizes: OutputSize[] = useMemo(() => {
    if (!campaign) return [];
    return campaign.outputSizes?.length
      ? campaign.outputSizes
      : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);
  }, [campaign]);

  /** Columns = axes that appear on live cells (activations), even when not fanning. */
  const activeAxes = useMemo(() => {
    if (!campaign) return [] as AxisKey[];
    return AXIS_ORDER.filter((axis) =>
      campaign.matrix.cells.some((c) => cellAxisIds(c, axis).length > 0),
    );
  }, [campaign]);

  const axisPlateIds = useMemo(() => {
    const map = new Map<AxisKey, string[]>();
    if (!campaign) return map;
    for (const axis of activeAxes) {
      const ids = new Set<string>();
      for (const cell of campaign.matrix.cells) {
        for (const pid of cellAxisIds(cell, axis)) ids.add(pid);
      }
      map.set(axis, [...ids]);
    }
    return map;
  }, [campaign, activeAxes]);

  const sortedCells = useMemo(() => {
    if (!campaign) return [];
    const rows = [...campaign.matrix.cells];
    const mul = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = cellSortValue(a, sortKey).toLocaleLowerCase();
      const bv = cellSortValue(b, sortKey).toLocaleLowerCase();
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return a.cellId.localeCompare(b.cellId);
    });
    return rows;
  }, [campaign, sortKey, sortDir]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const eligibleCells = sortedCells;
  const allVisibleSelected =
    eligibleCells.length > 0 &&
    eligibleCells.every((c) => selected.has(c.cellId));
  const someVisibleSelected =
    eligibleCells.some((c) => selected.has(c.cellId)) && !allVisibleSelected;
  const assetCount = selectedIds.length * sizes.length;

  const needsGenCells = useMemo(
    () =>
      campaign?.matrix.cells.filter((c) => cellNeedsVariantGen(c)) ?? [],
    [campaign],
  );
  const selectedNeedsGen = useMemo(
    () =>
      selectedIds.filter((cid) => {
        const cell = campaign?.matrix.cells.find((c) => c.cellId === cid);
        return cell && cellNeedsVariantGen(cell);
      }),
    [campaign, selectedIds],
  );
  const missingVariantCount = useMemo(
    () => needsGenCells.filter((c) => !cellHasVariantMedia(c)).length,
    [needsGenCells],
  );
  /** Activated ready copy plates — Remotion appends these at assemble (not Comfy). */
  const activeCopyPlates = useMemo(() => {
    if (!campaign) return [] as LibraryItem[];
    const active = new Set(campaign.ingredientSet?.activeIds ?? []);
    const allActive = active.size === 0;
    return [...libById.values()].filter(
      (i) =>
        i.kind === "copy" &&
        isPlateReady(i) &&
        (allActive || active.has(i.id)),
    );
  }, [campaign, libById]);
  const copyFan = Math.max(1, activeCopyPlates.length);
  const assembleJobCount = selectedIds.length * sizes.length * copyFan;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function toggleRow(cellId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const c of eligibleCells) next.delete(c.cellId);
      } else {
        for (const c of eligibleCells) next.add(c.cellId);
      }
      return next;
    });
  }

  /** Toggle plate on/off for this row’s Comfy prompt only. */
  async function toggleCellPlate(cellId: string, plateId: string) {
    const cell = campaign?.matrix.cells.find((c) => c.cellId === cellId);
    if (!cell) return;
    const omit = new Set(cell.genOmitIds ?? []);
    if (omit.has(plateId)) omit.delete(plateId);
    else omit.add(plateId);
    setBusy("rebuild");
    setError(null);
    try {
      const next = await api.patchCell(id, cellId, {
        genOmitIds: [...omit],
      });
      setCampaign(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function deactivatePlate(plateId: string) {
    if (!campaign?.ingredientSet) return;
    const activeIds = (campaign.ingredientSet.activeIds ?? []).filter(
      (x) => x !== plateId,
    );
    setBusy("rebuild");
    setError(null);
    try {
      const nextSet = { ...campaign.ingredientSet, activeIds };
      await api.putCampaignIngredients(id, nextSet);
      const rebuilt = await api.buildSparse(id);
      setCampaign(rebuilt);
      const plan = await api.assetPlan(id);
      setPlanTotal(plan.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runVariants(forceRegen = false) {
    const ids = selectedNeedsGen.length
      ? selectedNeedsGen
      : needsGenCells.map((c) => c.cellId);
    if (!ids.length) {
      setError(
        "No cells need Comfy variants. Activate hands, attire, background, or prop on Ingredients, then Build from activations — one cell is enough.",
      );
      return;
    }
    setBusy("variants");
    setError(null);
    setLastQueued(null);
    try {
      const res = await api.generateVariants(id, ids, { forceRegen });
      setLastQueued(res.jobs.length);
      const c = await api.getCampaign(id);
      setCampaign(c);
      window.location.href = `/campaigns/${id}/queue`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runStage(stage: "preview" | "render") {
    if (!selectedIds.length) return;
    setBusy(stage);
    setError(null);
    setLastQueued(null);
    try {
      // Assemble uses library talent/hands + cell genPath when present
      const opts = { skipComfy: true };
      const res =
        stage === "preview"
          ? await api.preview(id, selectedIds, opts)
          : await api.render(id, selectedIds, opts);
      setLastQueued(res.jobs.length);
      const c = await api.getCampaign(id);
      setCampaign(c);
      window.location.href = `/campaigns/${id}/queue`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Comfy each missing aspect, then Remotion assemble — stay on Matrix; Queue still lists jobs. */
  async function fillMissingSizes() {
    const cellIds = selectedIds.length
      ? selectedIds
      : eligibleCells.map((c) => c.cellId);
    if (!cellIds.length) {
      setError("No eligible cells to fill sizes for.");
      return;
    }
    setBusy("sizes");
    setError(null);
    setLastQueued(null);
    try {
      const res = await api.generateMissingSizes(id, cellIds);
      setLastQueued(res.jobs.length);
      rememberFillJobs(res.jobs);
      const c = await api.getCampaign(id);
      setCampaign(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** One cell × size — replaces ! / — with in-cell progress. */
  async function fillOneSizeSlot(cell: MatrixCell, size: OutputSize) {
    const key = sizeSlotKey(cell.cellId, size.id);
    if (sizeFills[key]) return;
    const asset = cell.sizeAssets?.find((a) => a.sizeId === size.id);
    setError(null);
    setSizeFills((prev) => ({
      ...prev,
      [key]: {
        jobIds: [],
        startedAt: Date.now(),
        etaSeconds: estimateQueueJobSeconds({
          stage: "plates",
          includesComfy: true,
        }),
        progress: 0.02,
        message: "Queueing…",
        status: "queued",
      },
    }));
    try {
      const res = await api.generateMissingSizes(id, [cell.cellId], {
        sizeIds: [size.id],
        forceRegen: asset?.status === "failed" && Boolean(asset.genPath?.trim()),
      });
      setLastQueued(res.jobs.length);
      if (!res.jobs.length) {
        setSizeFills((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }
      rememberFillJobs(res.jobs);
    } catch (e) {
      setSizeFills((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const missingPlateIds = useMemo(() => {
    if (!campaign) return [] as string[];
    const ids = new Set<string>();
    for (const cell of campaign.matrix.cells) {
      for (const lid of [cell.talentTakeId, cell.handsId].filter(Boolean)) {
        const item = libById.get(lid);
        if (!item || !isPlateReady(item)) ids.add(lid);
      }
    }
    return [...ids].sort();
  }, [campaign, libById]);

  const missingSizeSlots = useMemo(() => {
    if (!campaign) return 0;
    let n = 0;
    const cells = selectedIds.length
      ? campaign.matrix.cells.filter((c) => selectedIds.includes(c.cellId))
      : eligibleCells;
    for (const cell of cells) {
      for (const s of sizes) {
        if (sizeSlotNeedsFill(cell, s)) n += 1;
      }
    }
    return n;
  }, [campaign, sizes, selectedIds, eligibleCells]);

  if (!campaign) return <p className="text-sm">Loading…</p>;

  const over = campaign.matrix.cells.length > campaign.matrix.cap;
  const gateOn = campaign.ingredientSet?.requireReadyMedia !== false;

  return (
    <div>
      <StepNav campaignId={id} current="matrix" />
      <h1 className="font-display text-4xl tracking-tight text-ink-900">
        Matrix / variants
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-700">
        <strong>1 of each kind = 1 variant</strong> (talent + hands + attire → one
        cell). Activate <strong>2+ of the same kind</strong> (e.g. two attires) to
        fan that axis. Rebuild reuses matching combos’ Comfy media; dropped combos
        go to the archive below. Copy plates append at Remotion assemble
        ({activeCopyPlates.length
          ? `${activeCopyPlates.length} active`
          : "none → cell default lines"}
        ).{" "}
        <a href={`/campaigns/${id}/ingredients`} className="underline">
          Edit activations
        </a>
        . {campaign.matrix.cells.length} cells · {needsGenCells.length} need gen ·{" "}
        {sizes.length} size{sizes.length === 1 ? "" : "s"} ·{" "}
        <strong>{planTotal || campaign.matrix.cells.length * sizes.length}</strong>{" "}
        visual outputs · model{" "}
        <span className="font-mono">{campaign.modelProfileId}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {sizes.map((s) => (
          <span
            key={s.id}
            className="rounded bg-ink-100 px-2 py-1 font-mono text-[11px] text-ink-800"
          >
            {s.aspect} {s.width}×{s.height}
          </span>
        ))}
        <a href={`/campaigns/${id}/settings`} className="text-xs underline text-ink-700">
          Edit sizes
        </a>
      </div>

      {missingPlateIds.length ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {gateOn ? "Assemble blocked — " : "Warning — "}
          {missingPlateIds.length} talent/hands plate
          {missingPlateIds.length === 1 ? "" : "s"} not ready:{" "}
          <span className="font-mono text-xs">{missingPlateIds.slice(0, 8).join(", ")}</span>
          {missingPlateIds.length > 8 ? "…" : ""}.{" "}
          <a href={`/campaigns/${id}/ingredients`} className="underline">
            Fix on Ingredients
          </a>
        </div>
      ) : null}

      {missingVariantCount > 0 ? (
        <div className="mt-4 rounded-lg border border-ink-200 bg-paper-50 px-3 py-2 text-sm text-ink-800">
          {missingVariantCount} variant
          {missingVariantCount === 1 ? "" : "s"} still need Comfy media before
          hands/attire/BG/prop blends appear in assemble. Generate variants first (or
          assemble will use library talent/hands plates as-is).
        </div>
      ) : null}

      {over ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          Large batches are hard to review — trim or split.
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm text-ink-900"
          onClick={async () => {
            setError(null);
            try {
              const c = await api.buildSparse(id);
              setCampaign(c);
              setSelected(new Set());
              const plan = await api.assetPlan(id);
              setPlanTotal(plan.total);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Build from activations
        </button>
        <button
          type="button"
          disabled={packBusy}
          className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm text-ink-900 disabled:opacity-40"
          onClick={async () => {
            setPackBusy(true);
            setPackError(null);
            try {
              let c = campaign;
              if (!c.matrix.cells.length) {
                c = await api.buildSparse(id);
                setCampaign(c);
              }
              const cellId = c.matrix.cells[0]?.cellId;
              if (!cellId) {
                setPackError("Build the matrix first (no cells).");
                return;
              }
              setPackPreview(await api.promptPack(id, cellId));
            } catch (e) {
              setPackError(e instanceof Error ? e.message : String(e));
            } finally {
              setPackBusy(false);
            }
          }}
        >
          {packBusy ? "Loading…" : "Preview model prompt"}
        </button>
        <button
          type="button"
          disabled={busy !== null || needsGenCells.length === 0}
          title={
            needsGenCells.length === 0
              ? "No hands / attire / background / prop on these cells. Activate plates on Ingredients, then Build from activations."
              : selectedNeedsGen.length
                ? `Generate Comfy video for ${selectedNeedsGen.length} selected cell(s)`
                : `Generate Comfy video for ${needsGenCells.length} cell(s)`
          }
          className="rounded-md bg-ember-500 px-4 py-2 text-sm text-white disabled:opacity-40"
          onClick={() => void runVariants(false)}
        >
          {busy === "variants"
            ? "Queueing…"
            : selectedNeedsGen.length
              ? `Generate variants (${selectedNeedsGen.length})`
              : `Generate variants${needsGenCells.length ? ` (${needsGenCells.length})` : ""}`}
        </button>
        <button
          type="button"
          disabled={busy !== null || needsGenCells.length === 0}
          title={
            needsGenCells.length === 0
              ? "No hands / attire / background / prop on these cells yet"
              : "Force re-run Comfy even if variant media exists"
          }
          className="rounded-md border border-ink-200 bg-white px-3 py-2 text-xs text-ink-800 disabled:opacity-40"
          onClick={() => void runVariants(true)}
        >
          Re-generate
        </button>
        <button
          type="button"
          disabled={busy !== null || missingSizeSlots === 0}
          title={
            missingSizeSlots === 0
              ? "All aspects already have their own Comfy media"
              : "Comfy each missing aspect (correct framing), then Remotion assemble"
          }
          className={`rounded-md px-4 py-2 text-sm disabled:opacity-40 ${
            missingSizeSlots > 0
              ? "border border-ember-600 bg-ember-500 text-white"
              : "border border-ink-200 bg-white text-ink-500"
          }`}
          onClick={() => void fillMissingSizes()}
        >
          {busy === "sizes"
            ? "Queueing…"
            : Object.keys(sizeFills).length
              ? `Filling sizes… (${Object.keys(sizeFills).length})`
              : missingSizeSlots > 0
                ? `Fill missing sizes (${missingSizeSlots})`
                : "Fill missing sizes"}
        </button>
        <button
          type="button"
          disabled={!selectedIds.length || busy !== null}
          title={
            activeCopyPlates.length
              ? `Remotion × ${activeCopyPlates.length} copy plate(s) on each selected variant`
              : "Remotion assemble using each cell’s default copy lines"
          }
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          onClick={() => void runStage("preview")}
        >
          {busy === "preview"
            ? "Queueing…"
            : `Assemble preview${selectedIds.length ? ` (${assembleJobCount})` : ""}`}
        </button>
        <button
          type="button"
          disabled={!selectedIds.length || busy !== null}
          title={
            activeCopyPlates.length
              ? `Final Remotion × ${activeCopyPlates.length} copy plate(s)`
              : "Final Remotion using cell default copy"
          }
          className="rounded-md border border-ink-900 bg-white px-4 py-2 text-sm text-ink-900 disabled:opacity-40"
          onClick={() => void runStage("render")}
        >
          {busy === "render"
            ? "Queueing…"
            : `Final build${selectedIds.length ? ` (${assembleJobCount})` : ""}`}
        </button>
        <a
          href={
            selectedIds.length
              ? `/campaigns/${id}/preview?cells=${encodeURIComponent(selectedIds.join(","))}`
              : `/campaigns/${id}/preview`
          }
          className={`rounded-md border border-ink-200 bg-white px-4 py-2 text-sm text-ink-900 ${
            !selectedIds.length ? "opacity-60" : ""
          }`}
        >
          {selectedIds.length
            ? `Open preview bay (${selectedIds.length})`
            : "Preview bay (all)"}
        </a>
        {selectedIds.length ? (
          <button
            type="button"
            className="text-xs underline text-ink-700"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        ) : (
          <span className="text-xs text-ink-600">
            Select rows → generate variants / assemble
          </span>
        )}
      </div>

      {lastQueued != null ? (
        <p className="mt-2 text-xs text-ink-700">
          Queued {lastQueued} job{lastQueued === 1 ? "" : "s"} — progress on this
          page; also listed under{" "}
          <a href={`/campaigns/${id}/queue`} className="underline">
            Queue
          </a>
          .
        </p>
      ) : null}

      {packError ? (
        <p className="mt-3 text-sm text-red-700">{packError}</p>
      ) : null}
      {packPreview ? (
        <div className="mt-4 rounded-xl border border-ink-200 bg-white/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg">Model prompt preview</h2>
            <button
              type="button"
              className="text-xs underline text-ink-700"
              onClick={() => setPackPreview(null)}
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1 font-mono text-xs text-ink-700">
            {packPreview.workflowId} · {packPreview.knob} · {packPreview.format}
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-700">Positive</div>
              <p className="mt-1 whitespace-pre-wrap rounded bg-ink-50 p-3">
                {packPreview.positive}
              </p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-ink-700">Negative</div>
              <p className="mt-1 whitespace-pre-wrap rounded bg-ink-50 p-3">
                {packPreview.negative}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeAxes.length ? (
        <p className="mt-4 text-[11px] text-ink-600">
          Uncheck a plate on a row to drop it from that cell’s Comfy prompt
          only. Header × deactivates the plate campaign-wide and rebuilds.
        </p>
      ) : (
        <p className="mt-4 text-[11px] text-ink-600">
          No plate activations on these cells yet — pin hands / attire /
          background / prop on Ingredients, then Build from rail.
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-ink-200 text-xs uppercase tracking-wider text-ink-700">
            <tr>
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all eligible rows"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                />
              </th>
              <SortTh
                label="Cell"
                active={sortKey === "cell"}
                dir={sortDir}
                onClick={() => toggleSort("cell")}
              />
              {activeAxes.map((axis) => (
                <th key={axis} className="min-w-[9rem] px-2 py-2 align-top">
                  <button
                    type="button"
                    onClick={() => toggleSort(axis)}
                    className={`mb-1.5 inline-flex items-center gap-1 text-left ${
                      sortKey === axis ? "text-ink-900" : "hover:text-ink-900"
                    }`}
                  >
                    <span className="capitalize">{axis}</span>
                    <span className="font-mono text-[10px] normal-case tracking-normal opacity-80">
                      {sortKey === axis ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                  <div className="flex flex-col gap-1 normal-case tracking-normal">
                    {(axisPlateIds.get(axis) ?? []).map((pid) => (
                      <div key={pid} className="flex items-center gap-1">
                        <PlateThumbLink
                          itemId={pid}
                          libById={libById}
                          campaignId={id}
                          compact
                        />
                        <button
                          type="button"
                          className="shrink-0 px-0.5 text-[11px] text-ink-400 hover:text-red-700"
                          title="Deactivate plate and rebuild matrix"
                          disabled={busy !== null}
                          onClick={() => void deactivatePlate(pid)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </th>
              ))}
              <SortTh
                label="Variant"
                active={sortKey === "variant"}
                dir={sortDir}
                onClick={() => toggleSort("variant")}
              />
              {sizes.map((s) => (
                <SortTh
                  key={s.id}
                  label={s.aspect}
                  sub={`${s.width}×${s.height}`}
                  active={sortKey === `size:${s.id}`}
                  dir={sortDir}
                  onClick={() => toggleSort(`size:${s.id}`)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedCells.map((c) => {
              const on = selected.has(c.cellId);
              const v = variantLabel(c);
              return (
                <tr
                  key={c.cellId}
                  className={`border-b border-ink-100 ${
                    on ? "bg-ember-500/5" : ""
                  }`}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.cellId}`}
                      checked={on}
                      onChange={() => toggleRow(c.cellId)}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => toggleRow(c.cellId)}
                    >
                      {c.cellId}
                    </button>
                    {mediaBadge(c) ? (
                      <div className="mt-0.5">
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-900">
                          {mediaBadge(c)}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  {activeAxes.map((axis) => {
                    const ids = cellAxisIds(c, axis);
                    return (
                      <td key={axis} className="px-2 py-1.5">
                        <div className="flex flex-col gap-1">
                          {ids.length ? (
                            ids.map((pid) => {
                              const included = !cellOmitsPlate(c, pid);
                              return (
                                <div
                                  key={pid}
                                  className={`flex items-center gap-1 ${
                                    included ? "" : "opacity-40"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="shrink-0"
                                    checked={included}
                                    title={
                                      included
                                        ? "Include in this cell’s Comfy prompt"
                                        : "Omitted from this cell’s Comfy prompt"
                                    }
                                    aria-label={`${included ? "Include" : "Omit"} ${pid} for ${c.cellId}`}
                                    disabled={busy !== null}
                                    onChange={() =>
                                      void toggleCellPlate(c.cellId, pid)
                                    }
                                  />
                                  <PlateThumbLink
                                    itemId={pid}
                                    libById={libById}
                                    campaignId={id}
                                    compact
                                  />
                                </div>
                              );
                            })
                          ) : (
                            <span className="text-[10px] text-ink-400">—</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 font-mono text-[11px]">
                    <span
                      className={
                        v === "ready"
                          ? "text-emerald-800"
                          : v === "failed"
                            ? "text-red-700"
                            : v === "needs gen"
                              ? "text-amber-800"
                              : "text-ink-600"
                      }
                    >
                      {v}
                    </span>
                  </td>
                  {sizes.map((s) => {
                    const asset = c.sizeAssets?.find((a) => a.sizeId === s.id);
                    const cut = asset?.outputPath
                      ? "final"
                      : asset?.previewPath
                        ? "preview"
                        : asset?.genPath
                          ? "gen"
                          : "—";
                    const fillKey = sizeSlotKey(c.cellId, s.id);
                    const fill = sizeFills[fillKey];
                    const needsFill = sizeSlotNeedsFill(c, s);
                    const remainSec = fill
                      ? remainingEstimateSeconds(
                          fill.startedAt,
                          fill.etaSeconds,
                          nowTick,
                        )
                      : 0;
                    const barPct = fill
                      ? Math.min(
                          96,
                          Math.max(
                            8,
                            Math.round(
                              (fill.progress > 0.01
                                ? fill.progress
                                : (nowTick - fill.startedAt) /
                                  1000 /
                                  Math.max(fill.etaSeconds, 1)) * 100,
                            ),
                          ),
                        )
                      : 0;
                    return (
                      <td
                        key={s.id}
                        className="px-2 py-2 font-mono text-[11px] text-ink-800"
                      >
                        {fill ? (
                          <div className="min-w-[6.5rem]">
                            <div className="flex items-center gap-1 text-[10px] text-amber-950">
                              <span className="attatta-spinner" aria-hidden />
                              <span>~{formatDurationShort(remainSec)}</span>
                              <button
                                type="button"
                                className="ml-auto text-[9px] uppercase tracking-wide text-red-700 hover:underline"
                                title="Stop this size fill"
                                onClick={() => {
                                  void Promise.all(
                                    fill.jobIds.map((jid) =>
                                      api.cancelJob(jid).catch(() => null),
                                    ),
                                  ).then(() => {
                                    setSizeFills((prev) => {
                                      const n = { ...prev };
                                      delete n[fillKey];
                                      return n;
                                    });
                                  });
                                }}
                              >
                                Stop
                              </button>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-amber-100">
                              <div
                                className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <p className="mt-0.5 max-w-[8rem] truncate text-[9px] text-amber-900/80">
                              {fill.message || "Generating…"}
                            </p>
                          </div>
                        ) : needsFill ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span
                              className={
                                asset?.status === "failed"
                                  ? "text-red-700"
                                  : "text-ink-500"
                              }
                            >
                              {cut}
                              {asset?.status === "failed" ? " !" : ""}
                            </span>
                            <button
                              type="button"
                              disabled={busy !== null}
                              className="rounded border border-ember-500/50 bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-medium text-ember-900 hover:bg-ember-500/25 disabled:opacity-40"
                              title={`Comfy-generate ${s.aspect} for this cell (stays on Matrix; also listed in Queue)`}
                              onClick={() => void fillOneSizeSlot(c, s)}
                            >
                              Fill {s.aspect}
                            </button>
                          </div>
                        ) : (
                          cut
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(campaign.matrix.retired?.length ?? 0) > 0 ? (
        <details className="mt-8 rounded-xl border border-warm-line bg-warm-paper/80 p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-900">
            Archived variants from earlier builds ({campaign.matrix.retired!.length})
          </summary>
          <p className="mt-2 text-xs text-ink-600">
            Combos that no longer match current activations. Still selectable in
            Preview bay. Re-activate the same plates and Rebuild to revive a
            matching combo into the live matrix (media preserved).
          </p>
          <ul className="mt-3 space-y-2 text-xs text-ink-800">
            {campaign.matrix.retired!.slice(0, 12).map((c) => {
              const hasGen = c.sizeAssets?.some((a) => a.genPath);
              const archRef = makeArchiveRef(archiveIdOf(c));
              const previewHref = `/campaigns/${id}/preview?archive=${encodeURIComponent(archiveIdOf(c))}`;
              return (
                <li
                  key={archRef}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono"
                >
                  <span>{c.cellId}</span>
                  <span className="text-ink-500">
                    {[
                      c.handsId && `hands:${c.handsId}`,
                      c.attireId && `attire:${c.attireId}`,
                      c.backgroundId && `bg:${c.backgroundId}`,
                      ...(c.propIds || []).map((p) => `prop:${p}`),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "talent-only"}
                  </span>
                  <span className={hasGen ? "text-emerald-800" : "text-ink-400"}>
                    {hasGen ? "had gen" : "no gen"}
                  </span>
                  <span className="text-ink-400">
                    {c.retiredAt?.slice(0, 19).replace("T", " ")}
                  </span>
                  <a
                    href={previewHref}
                    className="text-ember-600 underline-offset-2 hover:underline"
                  >
                    Open in preview
                  </a>
                </li>
              );
            })}
          </ul>
          {(campaign.matrix.retired?.length ?? 0) > 12 ? (
            <p className="mt-2 text-[11px] text-ink-500">
              Showing 12 of {campaign.matrix.retired!.length} (cap 40).{" "}
              <a href={`/campaigns/${id}/preview`} className="underline">
                Open full archive in preview
              </a>
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
