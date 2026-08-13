"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  DEFAULT_OUTPUT_SIZE_IDS,
  cellHasGen,
  listPreviewCells,
  type PreviewListEntry,
  resolveOutputSizes,
  type Campaign,
  type ReviewEntry,
} from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [c, r] = await Promise.all([api.getCampaign(id), api.getReviews(id)]);
    setCampaign(c);
    setReviews(r);
    const entries = listPreviewCells(c);
    setActive((prev) => {
      if (prev && entries.some((e) => e.ref === prev)) return prev;
      return entries[0]?.ref ?? null;
    });
    if (!sizeId && c.outputSizes?.[0]) setSizeId(c.outputSizes[0].id);
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  const sizes = useMemo(() => {
    if (!campaign) return [];
    return campaign.outputSizes?.length
      ? campaign.outputSizes
      : resolveOutputSizes([...DEFAULT_OUTPUT_SIZE_IDS]);
  }, [campaign]);

  const entries = useMemo(
    () => (campaign ? listPreviewCells(campaign) : []),
    [campaign],
  );
  const liveEntries = entries.filter((e) => !e.isArchive);
  const archiveEntries = entries.filter((e) => e.isArchive);

  const activeEntry =
    entries.find((e) => e.ref === active) || entries[0] || null;
  const cell = activeEntry?.cell;
  const activeSize = sizes.find((s) => s.id === sizeId) || sizes[0];
  const asset = cell?.sizeAssets?.find((a) => a.sizeId === activeSize?.id);
  const decision =
    reviews.find((r) => r.cellId === activeEntry?.ref)?.decision || "pending";
  const mediaSrc =
    asset?.outputPath ||
    asset?.previewPath ||
    cell?.outputPath ||
    cell?.previewPath ||
    null;
  const variantReady = cell ? cellHasGen(cell) : false;
  const canAssemble = variantReady;

  async function decide(d: "approved" | "rejected" | "pending") {
    if (!activeEntry) return;
    await api.setReview(id, activeEntry.ref, { decision: d });
    await refresh();
  }

  async function assemble(scope: "active" | "live" | "allReady") {
    setBusy(true);
    setError(null);
    try {
      const cellIds =
        scope === "active"
          ? activeEntry
            ? [activeEntry.ref]
            : []
          : scope === "live"
            ? liveEntries.filter((e) => cellHasGen(e.cell)).map((e) => e.ref)
            : undefined;
      if (scope !== "allReady" && !cellIds?.length) {
        setError("No variants ready to assemble. Generate on Matrix first.");
        return;
      }
      await api.render(id, cellIds, { skipComfy: true });
      window.location.href = `/campaigns/${id}/queue`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) return <p className="text-sm">Loading…</p>;

  const withMedia = entries.filter(
    (e) =>
      (e.cell.sizeAssets || []).some((a) => a.outputPath || a.previewPath) ||
      e.cell.outputPath ||
      e.cell.previewPath,
  );
  const readyVariants = entries.filter((e) => cellHasGen(e.cell)).length;

  function TileGrid({ list }: { list: PreviewListEntry[] }) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((e) => {
          const d =
            reviews.find((r) => r.cellId === e.ref)?.decision || "pending";
          const primary =
            e.cell.sizeAssets?.find((a) => a.sizeId === (sizeId || sizes[0]?.id)) ||
            e.cell.sizeAssets?.[0];
          const src =
            primary?.outputPath ||
            primary?.previewPath ||
            e.cell.outputPath ||
            e.cell.previewPath;
          return (
            <button
              key={e.ref}
              type="button"
              onClick={() => setActive(e.ref)}
              className={`overflow-hidden rounded-xl border text-left shadow-surface ${
                active === e.ref
                  ? "border-ember-500 ring-2 ring-ember-500/30"
                  : "border-warm-line"
              }`}
            >
              <div className="aspect-[9/16] bg-ink-900">
                {src ? (
                  <video
                    src={api.fileUrl(src)}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-ink-50">
                    <span>Not assembled</span>
                    {cellHasGen(e.cell) ? (
                      <span className="text-[10px] text-emerald-300">Variant ready</span>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="bg-white px-2 py-2 text-[11px]">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="truncate">{e.label}</span>
                  {e.isArchive ? (
                    <span className="shrink-0 text-[9px] uppercase text-ink-500">
                      Arch
                    </span>
                  ) : null}
                </div>
                <div className="text-ink-700">
                  {d === "approved" ? "approved" : d === "rejected" ? "killed" : src ? "assembled" : "pending"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <StepNav campaignId={id} current="review" />
      <h1 className="font-display text-4xl tracking-tight text-ink-900">Review board</h1>
      <p className="mt-1 text-sm text-ink-700">
        Keep / Kill assembled masters. Assemble hi-res cuts here when variants are ready.{" "}
        {withMedia.length} with media · {readyVariants} variants ready · {liveEntries.length} live ·{" "}
        {archiveEntries.length} archive.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || readyVariants === 0}
          className="rounded-md bg-ember-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          onClick={() => void assemble("allReady")}
        >
          {busy ? "Queueing…" : `Assemble ready variants (${readyVariants})`}
        </button>
        <a
          href={`/campaigns/${id}/variants`}
          className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm text-ink-900 no-underline"
        >
          Variant review
        </a>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600">
              Live
            </p>
            <TileGrid list={liveEntries} />
          </div>
          {archiveEntries.length ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600">
                Archive
              </p>
              <TileGrid list={archiveEntries} />
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-warm-line bg-warm-paper p-5 shadow-surface">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-600">
            Decision
          </div>
          <div className="mt-2 font-mono text-sm">{activeEntry?.label || "—"}</div>
          {activeEntry?.isArchive ? (
            <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-500">
              Archive cut
            </div>
          ) : null}
          <div className="mt-1 text-sm text-ink-700">Current: {decision}</div>

          {sizes.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {sizes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSizeId(s.id)}
                  className={`rounded px-2 py-1 text-[11px] ${
                    s.id === activeSize?.id
                      ? "bg-ink-900 text-white"
                      : "border border-ink-200"
                  }`}
                >
                  {s.aspect}
                </button>
              ))}
            </div>
          ) : null}

          {cell ? (
            <dl className="mt-4 space-y-1 text-sm">
              <div>Hands: {cell.handsId}</div>
              <div>Setup: {cell.copy.setup}</div>
              <div className="text-xs text-ink-600">
                Assembled: {mediaSrc ? "yes" : "no"}
                {variantReady && !mediaSrc ? " · variant ready" : ""}
              </div>
            </dl>
          ) : null}

          {mediaSrc ? (
            <video
              key={mediaSrc}
              className="mt-4 aspect-[9/16] w-full rounded-lg bg-ink-900 object-cover"
              src={api.fileUrl(mediaSrc)}
              controls
              muted
              playsInline
            />
          ) : null}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-md bg-ember-500 px-3 py-2 text-sm font-medium text-white"
              onClick={() => void decide("approved")}
            >
              Keep
            </button>
            <button
              type="button"
              className="rounded-md border border-ink-200 px-3 py-2 text-sm"
              onClick={() => void decide("rejected")}
            >
              Kill
            </button>
            <button
              type="button"
              disabled={busy || !canAssemble}
              className="rounded-md bg-ink-900 px-3 py-2 text-sm text-white disabled:opacity-40"
              title={
                canAssemble
                  ? mediaSrc
                    ? "Re-run hi-res Remotion assemble"
                    : "Assemble hi-res master from variant"
                  : "Generate a Comfy variant first"
              }
              onClick={() => void assemble("active")}
            >
              {busy ? "Queueing…" : mediaSrc ? "Re-assemble" : "Assemble"}
            </button>
            <a
              href={`/campaigns/${id}/ingredients`}
              className="rounded-md border border-ink-200 px-3 py-2 text-center text-sm text-ink-900 no-underline"
            >
              Ingredient plates
            </a>
          </div>
          <a href={`/campaigns/${id}/package`} className="mt-6 inline-block text-sm">
            Package approved →
          </a>
        </div>
      </div>
    </div>
  );
}
