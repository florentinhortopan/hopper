"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  DEFAULT_OUTPUT_SIZE_IDS,
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

  async function decide(d: "approved" | "rejected" | "pending") {
    if (!activeEntry) return;
    await api.setReview(id, activeEntry.ref, { decision: d });
    await refresh();
  }

  if (!campaign) return <p className="text-sm">Loading…</p>;

  const withMedia = entries.filter(
    (e) =>
      (e.cell.sizeAssets || []).some((a) => a.previewPath || a.outputPath) ||
      e.cell.previewPath ||
      e.cell.outputPath,
  );

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
                <div className="text-ink-700">{d}</div>
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
        Keep / Kill assembled cuts (live + archive). {withMedia.length} with media ·{" "}
        {liveEntries.length} live · {archiveEntries.length} archive.
      </p>

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
              className="rounded-md bg-ink-900 px-3 py-2 text-sm text-white"
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
            <a
              href={`/campaigns/${id}/ingredients`}
              className="rounded-md border border-ink-200 px-3 py-2 text-center text-sm text-ink-900 no-underline"
            >
              Ingredient plates
            </a>
            <button
              type="button"
              disabled={busy || !activeEntry}
              className="rounded-md border border-ink-200 px-3 py-2 text-sm disabled:opacity-40"
              onClick={async () => {
                if (!activeEntry) return;
                setBusy(true);
                try {
                  await api.render(id, [activeEntry.ref], { skipComfy: true });
                  window.location.href = `/campaigns/${id}/queue`;
                } finally {
                  setBusy(false);
                }
              }}
            >
              Re-assemble final
            </button>
          </div>
          <a href={`/campaigns/${id}/package`} className="mt-6 inline-block text-sm">
            Package approved →
          </a>
        </div>
      </div>
    </div>
  );
}
