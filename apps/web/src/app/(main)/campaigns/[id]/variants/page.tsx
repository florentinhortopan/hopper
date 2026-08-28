"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  DEFAULT_OUTPUT_SIZE_IDS,
  cellHasGen,
  ensureSceneTag,
  formatAssemblyRecipeSummary,
  isPlateReady,
  listPreviewCells,
  normalizeAssemblyRecipe,
  type PreviewListEntry,
  resolveOutputSizes,
  type Campaign,
  type DesignTokens,
  type LibraryItem,
  type MatrixCell,
  type OutputSize,
  type ReviewEntry,
} from "@attatta/shared";
import type { PlateDensity } from "@/components/PlateCard";
import { StepNav } from "@/components/StepNav";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { api } from "@/lib/api";
import { triggerApiDownload } from "@/lib/download";

type Busy = "review" | "package" | null;

const VIEW_KEY = "attatta.variantReview.view";

function readStoredView(): PlateDensity {
  if (typeof window === "undefined") return "small";
  const v = window.localStorage.getItem(VIEW_KEY);
  if (v === "row" || v === "small" || v === "big") return v;
  return "small";
}

function assetPhase(cell: MatrixCell, sizeId: string) {
  const a = cell.sizeAssets?.find((x) => x.sizeId === sizeId);
  const hasVariant = Boolean(a?.genPath?.trim()) && a?.status !== "failed";
  const hasMaster = Boolean(a?.outputPath || a?.previewPath);
  const failed = a?.status === "failed";
  return { asset: a, hasVariant, hasMaster, hasPreview: hasMaster, failed, error: a?.error };
}

function cellMediaSrc(cell: MatrixCell, sizeId: string): string | null {
  const a = cell.sizeAssets?.find((x) => x.sizeId === sizeId) || cell.sizeAssets?.[0];
  // Prefer Comfy variant for this step; masters are reviewed on Review
  return a?.genPath || a?.outputPath || a?.previewPath || cell.outputPath || cell.previewPath || null;
}

function decisionLabel(d: ReviewEntry["decision"] | undefined): "kept" | "killed" | "pending" {
  if (d === "approved") return "kept";
  if (d === "rejected") return "killed";
  return "pending";
}

function DecisionBadge({
  decision,
  compact,
}: {
  decision: "kept" | "killed" | "pending";
  compact?: boolean;
}) {
  const cls =
    decision === "kept"
      ? "bg-emerald-100 text-emerald-900 ring-emerald-200"
      : decision === "killed"
        ? "bg-red-100 text-red-900 ring-red-200"
        : "bg-ink-100 text-ink-600 ring-ink-200";
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium uppercase tracking-[0.12em] ring-1 ${cls} ${
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
      }`}
    >
      {decision === "kept" ? "Kept" : decision === "killed" ? "Killed" : "Pending"}
    </span>
  );
}

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const filterIds = useMemo(() => {
    const raw = searchParams.get("cells");
    if (!raw) return null;
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [searchParams]);

  const archiveFilter = useMemo(() => {
    const raw = searchParams.get("archive");
    if (!raw) return null;
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [searchParams]);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [tokens, setTokens] = useState<DesignTokens[]>([]);
  const [libById, setLibById] = useState<Map<string, LibraryItem>>(new Map());
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<{
    zipPath: string;
    downloadUrl: string;
    fileName?: string;
    rowCount?: number;
  } | null>(null);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [activeSizeId, setActiveSizeId] = useState<string>("");
  const [view, setView] = useState<PlateDensity>("small");

  async function refresh() {
    const [c, t, ing, r] = await Promise.all([
      api.getCampaign(id),
      api.tokens(),
      api.campaignIngredients(id),
      api.getReviews(id),
    ]);
    setCampaign(c);
    setTokens(t);
    setLibById(new Map(ing.items.map((i) => [i.id, i])));
    setReviews(r);
    const primary = c.outputSizes?.[0]?.id || "v_9x16_1080";
    setActiveSizeId((prev) => prev || primary);
    const entries = listPreviewCells(c, {
      liveFilter: filterIds,
      archiveFilter,
    });
    setActiveRef((prev) => {
      if (prev && entries.some((e) => e.ref === prev)) return prev;
      return entries[0]?.ref ?? null;
    });
  }

  useEffect(() => {
    setView(readStoredView());
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const sizes: OutputSize[] = useMemo(() => {
    if (!campaign) return [];
    return campaign.outputSizes?.length
      ? campaign.outputSizes
      : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);
  }, [campaign]);

  const visibleEntries = useMemo(() => {
    if (!campaign) return [] as PreviewListEntry[];
    return listPreviewCells(campaign, {
      liveFilter: filterIds,
      archiveFilter,
    });
  }, [campaign, filterIds, archiveFilter]);

  const liveEntries = useMemo(
    () => visibleEntries.filter((e) => !e.isArchive),
    [visibleEntries],
  );
  const archiveEntries = useMemo(
    () => visibleEntries.filter((e) => e.isArchive),
    [visibleEntries],
  );

  const reviewByCell = useMemo(() => {
    const m = new Map<string, ReviewEntry>();
    for (const r of reviews) m.set(r.cellId, r);
    return m;
  }, [reviews]);

  const activeEntry =
    visibleEntries.find((e) => e.ref === activeRef) || visibleEntries[0] || null;
  const activeCell = activeEntry?.cell ?? null;
  const activeSize = sizes.find((s) => s.id === activeSizeId) || sizes[0];
  const activeDecision = decisionLabel(
    activeEntry ? reviewByCell.get(activeEntry.ref)?.decision : undefined,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!visibleEntries.length || !activeEntry) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = visibleEntries.findIndex((e2) => e2.ref === activeEntry.ref);
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = visibleEntries[Math.min(idx + 1, visibleEntries.length - 1)];
        if (next) setActiveRef(next.ref);
      } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = visibleEntries[Math.max(idx - 1, 0)];
        if (prev) setActiveRef(prev.ref);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleEntries, activeEntry]);

  function changeView(next: PlateDensity) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  async function decide(d: "approved" | "rejected" | "pending") {
    if (!activeEntry) return;
    setBusy("review");
    setError(null);
    try {
      await api.setReview(id, activeEntry.ref, { decision: d });
      const r = await api.getReviews(id);
      setReviews(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function packageKept() {
    setBusy("package");
    setError(null);
    setPkg(null);
    try {
      const result = await api.package(id);
      setPkg(result);
      triggerApiDownload(result.downloadUrl, result.fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveSceneTag(sceneTag: string) {
    if (!activeEntry || !campaign) return;
    setBusy("review");
    setError(null);
    try {
      const updated = await api.patchCell(id, activeEntry.ref, {
        sceneTag,
      });
      setCampaign(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const recipe = campaign
    ? normalizeAssemblyRecipe(campaign.assemblyRecipe)
    : null;
  const activeSceneTag =
    activeCell && recipe ? ensureSceneTag(activeCell, recipe) : null;
  const genMissingForTag =
    Boolean(activeSceneTag) && activeCell && !cellHasGen(activeCell);

  if (!campaign) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-warm-line" />
        <div className="h-64 rounded-2xl bg-warm-line/60" />
      </div>
    );
  }

  const allVisibleRefs = visibleEntries.map((e) => e.ref);
  const totalAssets = visibleEntries.length * sizes.length;

  let variantsReady = 0;
  let failed = 0;
  for (const entry of visibleEntries) {
    for (const s of sizes) {
      const p = assetPhase(entry.cell, s.id);
      if (p.hasVariant) variantsReady += 1;
      if (p.failed) failed += 1;
    }
  }

  const missingPlateIds = (() => {
    const ids = new Set<string>();
    for (const entry of visibleEntries) {
      const cell = entry.cell;
      for (const lid of [cell.talentTakeId, cell.handsId].filter(Boolean)) {
        const item = libById.get(lid);
        if (!item || !isPlateReady(item)) ids.add(lid);
      }
    }
    return [...ids].sort();
  })();
  const gateOn = campaign.ingredientSet?.requireReadyMedia !== false;
  const filtered =
    Boolean(filterIds?.size) || Boolean(archiveFilter?.size);

  const keptCount = reviews.filter((r) => r.decision === "approved").length;
  const allEntries = listPreviewCells(campaign);
  const keptWithPlate = reviews.filter((r) => {
    if (r.decision !== "approved") return false;
    const entry = allEntries.find((e) => e.ref === r.cellId);
    return entry ? cellHasGen(entry.cell) : false;
  }).length;

  return (
    <div>
      <StepNav campaignId={id} current="variants" />

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-ink-900">
            Variant review
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-700">
            Keep generated plates, then package for Celtra. Remotion assemble on{" "}
            <a href={`/campaigns/${id}/review`} className="underline">
              Review
            </a>{" "}
            is optional preview only.
          </p>
        </div>

        <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em]">
          <li className="rounded-full border border-warm-line bg-warm-paper px-3 py-1.5 text-ink-600">
            Variants ready
            <span className="ml-1.5 font-mono normal-case tracking-normal opacity-80">
              {variantsReady}/{totalAssets}
            </span>
          </li>
          <li className="rounded-full border border-warm-line bg-warm-paper px-3 py-1.5 text-ink-600">
            Kept
            <span className="ml-1.5 font-mono normal-case tracking-normal opacity-80">
              {keptWithPlate}/{keptCount || 0}
            </span>
          </li>
          {failed ? (
            <li className="rounded-full bg-red-100 px-3 py-1.5 text-red-800">
              Failed {failed}
            </li>
          ) : null}
        </ol>
      </header>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {missingPlateIds.length ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {gateOn ? "Plates incomplete — " : "Warning — "}
          {missingPlateIds.length} ingredient plate
          {missingPlateIds.length === 1 ? "" : "s"} not ready.{" "}
          <a href={`/campaigns/${id}/ingredients`} className="underline">
            Open ingredient plates
          </a>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null || keptWithPlate < 1}
          onClick={() => void packageKept()}
          className="rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ember-600 disabled:opacity-40"
          title={
            keptWithPlate < 1
              ? "Keep at least one variant with a generated plate"
              : "Zip kept plates into a Celtra content matrix (no Remotion needed)"
          }
        >
          {busy === "package"
            ? "Packaging…"
            : `Celtra package${keptWithPlate ? ` (${keptWithPlate})` : ""}`}
        </button>
        {pkg ? (
          <button
            type="button"
            className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-warm-paper"
            onClick={() => triggerApiDownload(pkg.downloadUrl, pkg.fileName)}
          >
            Download zip{pkg.fileName ? ` (${pkg.fileName})` : ""}
          </button>
        ) : null}
        <a
          href={`/campaigns/${id}/package`}
          className="rounded-lg border border-warm-line bg-warm-paper px-4 py-2.5 text-sm font-medium text-ink-900 no-underline shadow-surface"
        >
          Package page
        </a>
        <a
          href={`/campaigns/${id}/matrix`}
          className="rounded-lg border border-warm-line bg-warm-paper px-4 py-2.5 text-sm font-medium text-ink-900 no-underline shadow-surface"
        >
          Open matrix
        </a>
        <a
          href={`/campaigns/${id}/review`}
          className="rounded-lg border border-warm-line bg-warm-paper px-4 py-2.5 text-sm font-medium text-ink-700 no-underline shadow-surface"
          title="Optional Remotion timeline preview"
        >
          Assemble (optional)
        </a>
        <div className="ml-auto flex flex-wrap gap-3 text-sm text-ink-700">
          {filtered ? (
            <a href={`/campaigns/${id}/variants`} className="underline">
              Show all
            </a>
          ) : null}
          <a href={`/campaigns/${id}/matrix`} className="underline">
            Matrix
          </a>
          <a href={`/campaigns/${id}/package`} className="underline">
            Package
          </a>
        </div>
      </div>

      {!visibleEntries.length ? (
        <p className="mt-10 text-sm text-ink-700">
          No matrix cells for variant review.{" "}
          <a href={`/campaigns/${id}/matrix`} className="underline">
            Build the matrix
          </a>
          .
        </p>
      ) : (
        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(280px,400px)_minmax(0,1fr)]">
          <VariantsRail
            campaignId={id}
            liveEntries={liveEntries}
            archiveEntries={archiveEntries}
            sizes={sizes}
            activeSizeId={activeSize?.id || ""}
            activeRef={activeEntry!.ref}
            reviewByCell={reviewByCell}
            view={view}
            onView={changeView}
            onSelect={setActiveRef}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-mono text-sm text-ink-900">
                    {activeEntry!.label}
                  </h2>
                  {activeEntry!.isArchive ? (
                    <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-700">
                      Archive
                    </span>
                  ) : cellHasGen(activeCell!) ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-900">
                      Had gen
                    </span>
                  ) : null}
                  <DecisionBadge decision={activeDecision} />
                </div>
                <p className="mt-1 truncate text-xs text-ink-600">
                  {[
                    activeCell!.backgroundId && `bg:${activeCell!.backgroundId}`,
                    activeCell!.attireId && `attire:${activeCell!.attireId}`,
                    activeCell!.handsId && `hands:${activeCell!.handsId}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || activeCell!.copy.setup}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sizes.map((s) => {
                  const p = assetPhase(activeCell!, s.id);
                  const on = s.id === activeSize?.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSizeId(s.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        on
                          ? "bg-ink-900 text-warm-paper"
                          : "border border-warm-line bg-white text-ink-800 hover:border-ink-300"
                      }`}
                      title={
                        p.hasVariant ? "Variant ready" : p.failed ? "Failed" : "No variant"
                      }
                    >
                      {s.aspect}
                      {p.hasVariant ? " ●" : ""}
                      {p.failed ? " !" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <HeroPlayer
              cell={activeCell!}
              size={activeSize}
              tokens={tokens}
              campaign={campaign}
            />

            <div className="rounded-xl border border-warm-line bg-white/80 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600">
                  Scene tag
                </h3>
                <a
                  href={`/campaigns/${id}/settings`}
                  className="text-[11px] text-ink-600 underline"
                >
                  Recipe: {formatAssemblyRecipeSummary(campaign.assemblyRecipe)}
                </a>
              </div>
              <p className="mt-1 text-xs text-ink-600">
                This variant&apos;s plate fills one Celtra frame (setup→F1,
                punchline→F2, endcard→F3) and optionally one Remotion beat.
                Package writes that plate into the matching content-matrix column.
              </p>
              <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-700">This variant fills</span>
                <select
                  className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm"
                  disabled={busy !== null || !recipe}
                  value={activeSceneTag || ""}
                  onChange={(e) => void saveSceneTag(e.target.value)}
                >
                  {(recipe?.scenes || []).map((scene) => {
                    const celtra =
                      scene.id === "setup" || scene.role === "setup"
                        ? "F1"
                        : scene.id === "punchline" || scene.role === "punchline"
                          ? "F2"
                          : scene.id === "endcard" || scene.role === "endcard"
                            ? "F3"
                            : null;
                    return (
                      <option key={scene.id} value={scene.id}>
                        {scene.label}
                        {celtra ? ` → Celtra ${celtra}` : ""}
                        {scene.role === "endcard"
                          ? " (graphic — usually skip gen)"
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              {genMissingForTag ? (
                <p className="mt-2 text-xs text-amber-800">
                  Tagged for a beat but no Comfy plate is ready — generate on
                  Matrix first.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide("approved")}
                className={`rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40 ${
                  activeDecision === "kept"
                    ? "bg-emerald-700 text-white"
                    : "bg-ink-900 text-warm-paper hover:bg-ink-800"
                }`}
              >
                Keep
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide("rejected")}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium disabled:opacity-40 ${
                  activeDecision === "killed"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-warm-line bg-white text-ink-900 hover:border-ink-300"
                }`}
              >
                Kill
              </button>
              {activeDecision !== "pending" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide("pending")}
                  className="rounded-lg border border-warm-line bg-warm-paper px-3 py-2.5 text-sm text-ink-700 disabled:opacity-40"
                >
                  Clear decision
                </button>
              ) : null}
              <a
                href={`/campaigns/${id}/package`}
                className="ml-auto text-xs font-medium uppercase tracking-[0.12em] text-ink-700 no-underline hover:text-ember-500"
              >
                Package kept →
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function VariantTile({
  entry,
  sizeId,
  active,
  decision,
  view,
  onSelect,
}: {
  entry: PreviewListEntry;
  sizeId: string;
  active: boolean;
  decision: "kept" | "killed" | "pending";
  view: PlateDensity;
  onSelect: (ref: string) => void;
}) {
  const cell = entry.cell;
  const phase = sizeId ? assetPhase(cell, sizeId) : null;
  const thumb = cellMediaSrc(cell, sizeId);
  const ring =
    decision === "kept"
      ? "ring-emerald-500"
      : decision === "killed"
        ? "ring-red-500"
        : "ring-ember-500";
  const mediaHint = phase?.hasVariant
    ? "Variant ready"
    : thumb
      ? "Media"
      : phase?.failed
        ? "Failed"
        : "No variant";

  if (view === "row") {
    return (
      <button
        type="button"
        onClick={() => onSelect(entry.ref)}
        className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
          active
            ? `border-transparent bg-white shadow-surface ring-2 ${ring}`
            : "border-warm-line bg-white/70 hover:border-ink-300"
        }`}
      >
        <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-ink-900">
          {thumb ? (
            <video
              className="h-full w-full object-cover"
              src={api.fileUrl(thumb)}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[9px] text-ink-400">
              —
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[11px] text-ink-900">
              {entry.label}
            </span>
            {entry.isArchive ? (
              <span className="text-[9px] uppercase tracking-wide text-ink-500">
                Archive
              </span>
            ) : null}
            <DecisionBadge decision={decision} compact />
          </div>
          <div className="mt-0.5 truncate text-[10px] text-ink-600">
            {cell.backgroundId || cell.attireId || cell.handsId || cell.copy.setup}
          </div>
          <div className="mt-0.5 text-[10px] text-ink-500">{mediaHint}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.ref)}
      className={`group overflow-hidden rounded-xl border text-left transition-transform ${
        active
          ? `border-transparent bg-white shadow-surface ring-2 ring-offset-2 ring-offset-warm-paper ${ring} scale-[1.01]`
          : "border-warm-line bg-white/80 opacity-90 hover:opacity-100"
      }`}
    >
      <div className="relative aspect-[9/16] overflow-hidden bg-ink-900">
        {thumb ? (
          <video
            className="h-full w-full object-cover"
            src={api.fileUrl(thumb)}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-ink-300">
            {phase?.failed ? "Failed" : "Empty"}
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          <DecisionBadge decision={decision} compact />
          {entry.isArchive ? (
            <span className="rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-warm-paper">
              Arch
            </span>
          ) : null}
        </div>
      </div>
      <div className={`bg-white ${view === "big" ? "px-2.5 py-2" : "px-1.5 py-1.5"}`}>
        <div className="truncate font-mono text-[10px] text-ink-800">{entry.label}</div>
        {view === "big" ? (
          <div className="mt-0.5 truncate text-[10px] text-ink-600">{cell.copy.setup}</div>
        ) : null}
      </div>
    </button>
  );
}

function VariantsRail({
  campaignId,
  liveEntries,
  archiveEntries,
  sizes,
  activeSizeId,
  activeRef,
  reviewByCell,
  view,
  onView,
  onSelect,
}: {
  campaignId: string;
  liveEntries: PreviewListEntry[];
  archiveEntries: PreviewListEntry[];
  sizes: OutputSize[];
  activeSizeId: string;
  activeRef: string;
  reviewByCell: Map<string, ReviewEntry>;
  view: PlateDensity;
  onView: (v: PlateDensity) => void;
  onSelect: (ref: string) => void;
}) {
  const sizeId = activeSizeId || sizes[0]?.id || "";
  const gridClass =
    view === "row"
      ? "flex flex-col gap-2"
      : view === "small"
        ? "grid grid-cols-2 gap-2 sm:grid-cols-2"
        : "grid grid-cols-1 gap-3";
  const total = liveEntries.length + archiveEntries.length;

  return (
    <aside className="flex max-h-[calc(100vh-12rem)] flex-col rounded-2xl border border-warm-line bg-warm-paper p-4 shadow-surface lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-600">
            Variants
          </p>
          <p className="mt-0.5 text-xs text-ink-600">
            {liveEntries.length} live
            {archiveEntries.length
              ? ` · ${archiveEntries.length} archive`
              : ""}{" "}
            ({total})
          </p>
        </div>
        <ViewModeToggle value={view} onChange={onView} />
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Live
          </p>
          <div className={gridClass}>
            {liveEntries.map((entry) => (
              <VariantTile
                key={entry.ref}
                entry={entry}
                sizeId={sizeId}
                active={entry.ref === activeRef}
                decision={decisionLabel(reviewByCell.get(entry.ref)?.decision)}
                view={view}
                onSelect={onSelect}
              />
            ))}
            {!liveEntries.length ? (
              <p className="text-xs text-ink-500">No live cells.</p>
            ) : null}
          </div>
        </div>
        {archiveEntries.length ? (
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
              Archive
            </p>
            <div className={gridClass}>
              {archiveEntries.map((entry) => (
                <VariantTile
                  key={entry.ref}
                  entry={entry}
                  sizeId={sizeId}
                  active={entry.ref === activeRef}
                  decision={decisionLabel(reviewByCell.get(entry.ref)?.decision)}
                  view={view}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <a
        href={`/campaigns/${campaignId}/matrix`}
        className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-ink-700 no-underline hover:text-ember-500"
      >
        View matrix →
      </a>
    </aside>
  );
}

function HeroPlayer({
  cell,
  size,
  tokens,
  campaign,
}: {
  cell: MatrixCell;
  size: OutputSize;
  tokens: DesignTokens[];
  campaign: Campaign;
}) {
  const phase = assetPhase(cell, size.id);
  const pack = tokens.find(
    (t) => t.id === (cell.designTokenPackId || campaign.designTokenPackId),
  );

  const props = useMemo(() => {
    if (!pack) return null;
    return {
      talentVideoSrc: api.libraryMediaUrl(cell.talentTakeId),
      handsVideoSrc: api.libraryMediaUrl(cell.handsId || cell.talentTakeId),
      motionToken: cell.motionToken || "none",
      copy: cell.copy,
      designTokens: pack,
      width: size.width,
      height: size.height,
      sizeId: size.id,
      aspect: size.aspect,
    };
  }, [cell, pack, size]);

  const mediaSrc = cellMediaSrc(cell, size.id);

  const aspectClass =
    size.aspect === "16:9"
      ? "aspect-video max-w-3xl"
      : size.aspect === "1:1"
        ? "aspect-square max-w-md"
        : size.aspect === "4:5"
          ? "aspect-[4/5] max-w-md"
          : "aspect-[9/16] max-w-[420px]";

  return (
    <div className="relative flex min-h-[480px] items-center justify-center overflow-hidden rounded-2xl bg-ink-900 shadow-float">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(212,93,64,0.25), transparent 70%)",
        }}
      />
      <div className={`relative w-full overflow-hidden ${aspectClass}`}>
        {mediaSrc ? (
          <video
            key={`${cell.cellId}-${size.id}-${mediaSrc}`}
            className="h-full w-full object-cover"
            src={api.fileUrl(mediaSrc)}
            controls
            muted
            playsInline
          />
        ) : props ? (
          <div className="flex h-full items-center justify-center bg-ink-800 p-2">
            <PreviewPlayer props={props} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-100">
            <span className="font-display text-xl text-warm-paper">No variant</span>
            <span className="text-ink-300">
              Generate a Comfy variant on Matrix to review it here.
            </span>
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-4 flex gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-warm-paper/80">
        <span className="rounded bg-black/40 px-2 py-1 backdrop-blur-sm">
          {phase.hasVariant ? "Variant ready" : phase.hasMaster ? "Master only" : "Empty"}
        </span>
        <span className="rounded bg-black/40 px-2 py-1 backdrop-blur-sm">
          {size.aspect}
        </span>
      </div>
    </div>
  );
}
