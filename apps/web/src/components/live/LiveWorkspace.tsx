"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Campaign, LiveColumnId, ReviewEntry } from "@attatta/shared";
import { CeltraPreviewPanel } from "@/components/live/CeltraPreviewPanel";
import { ColumnComposer } from "@/components/live/ColumnComposer";
import {
  EventFeed,
  useCampaignEventStream,
} from "@/components/live/EventFeed";
import { MagicColumnPanel } from "@/components/live/MagicColumnPanel";
import { api } from "@/lib/api";

type ColState = { open: boolean; flex: number };

const DEFAULT_COLS: Record<LiveColumnId, ColState> = {
  magic: { open: true, flex: 1 },
  hopper: { open: true, flex: 1.2 },
  celtra: { open: true, flex: 1 },
};

type Props = {
  campaignId: string;
};

export function LiveWorkspace({ campaignId }: Props) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [llmOn, setLlmOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [celtraTick, setCeltraTick] = useState(0);
  const [briefDraft, setBriefDraft] = useState("");

  const {
    events,
    hasMore,
    loadOlder,
    connected,
  } = useCampaignEventStream(campaignId);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      api.getCampaign(campaignId),
      api.getReviews(campaignId),
    ]);
    setCampaign(c);
    setReviews(r);
    setBriefDraft(c.brief?.prompt || "");
  }, [campaignId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    void api.liveLlmStatus()
      .then((s) => setLlmOn(s.configured))
      .catch(() => setLlmOn(false));
    void api.liveOpen(campaignId).catch(() => undefined);
  }, [campaignId, refresh]);

  useEffect(() => {
    const relevant = events[0];
    if (!relevant) return;
    if (
      relevant.type === "review_decision" ||
      relevant.type === "job_update" ||
      relevant.type === "celtra_package" ||
      relevant.type === "magic_generate" ||
      relevant.type === "magic_prepare" ||
      relevant.type === "comfy_publish"
    ) {
      const t = window.setTimeout(() => {
        setCeltraTick((n) => n + 1);
        void refresh().catch(() => undefined);
      }, 400);
      return () => window.clearTimeout(t);
    }
  }, [events]);

  const openCount = useMemo(
    () => (Object.values(cols) as ColState[]).filter((c) => c.open).length,
    [cols],
  );

  function toggleCol(id: LiveColumnId) {
    setCols((prev) => {
      const next = { ...prev, [id]: { ...prev[id], open: !prev[id].open } };
      const opens = (Object.values(next) as ColState[]).filter((c) => c.open)
        .length;
      if (opens === 0) return prev;
      return next;
    });
  }

  async function runPrepare() {
    if (!campaign) return;
    setBusy("prepare");
    setError(null);
    try {
      await api.magicPrepare(campaignId, {
        brief: {
          ...campaign.brief,
          prompt: briefDraft.trim() || campaign.brief.prompt || "New offer",
        },
      });
      await refresh();
      setCeltraTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runGenerate() {
    setBusy("generate");
    setError(null);
    try {
      await api.magicGenerate(campaignId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleComposer(column: LiveColumnId, text: string) {
    const trimmed = text.trim();
    if (trimmed.startsWith("/")) {
      const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
      const arg = rest.join(" ").trim();
      if (column === "magic" && cmd === "prepare") {
        await runPrepare();
        return;
      }
      if (column === "magic" && cmd === "generate") {
        await runGenerate();
        return;
      }
      if (column === "hopper" && (cmd === "keep" || cmd === "kill") && arg) {
        await api.setReview(campaignId, arg, {
          decision: cmd === "keep" ? "approved" : "rejected",
        });
        await refresh();
        setCeltraTick((n) => n + 1);
        return;
      }
      if (column === "celtra" && cmd === "package") {
        const result = await api.package(campaignId);
        const { triggerApiDownload } = await import("@/lib/download");
        await triggerApiDownload(result.downloadUrl, result.fileName);
        setCeltraTick((n) => n + 1);
        return;
      }
    }
    await api.liveNote(campaignId, { column, text: trimmed });
    if (column === "magic" && !trimmed.startsWith("/")) {
      setBriefDraft(trimmed);
    }
  }

  const cells = campaign?.matrix?.cells ?? [];
  const kept = reviews.filter((r) => r.decision === "approved").length;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f3efe6] text-ink-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-warm-paper/95 px-4 py-2">
        <a href="/" className="font-display text-lg tracking-tight no-underline">
          ATTATTA
        </a>
        <span className="text-[10px] uppercase tracking-[0.16em] text-ink-500">
          Live workspace
        </span>
        <span className="max-w-[12rem] truncate text-sm font-medium" title={campaign?.name}>
          {campaign?.name || "…"}
        </span>
        <span className="font-mono text-[10px] text-ink-500">{campaignId}</span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
            connected
              ? "bg-emerald-100 text-emerald-900"
              : "bg-ink-100 text-ink-600"
          }`}
        >
          {connected ? "live" : "reconnecting"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {(["magic", "hopper", "celtra"] as LiveColumnId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`rounded border px-2 py-1 capitalize ${
                cols[id].open
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-200 bg-white text-ink-600"
              }`}
              onClick={() => toggleCol(id)}
            >
              {id}
            </button>
          ))}
          <a
            href={`/campaigns/${campaignId}/brief`}
            className="rounded border border-ink-200 bg-white px-2 py-1 no-underline"
          >
            Advanced
          </a>
          <a href="/" className="rounded border border-ink-200 bg-white px-2 py-1 no-underline">
            Exit
          </a>
        </div>
      </header>

      {error ? (
        <pre className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </pre>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-1 p-1">
        {(
          [
            ["magic", "Magic"],
            ["hopper", "Hopper"],
            ["celtra", "Celtra"],
          ] as const
        ).map(([id, label]) => {
          const state = cols[id];
          if (!state.open) {
            return (
              <button
                key={id}
                type="button"
                className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg border border-ink-200 bg-warm-paper py-3 text-[10px] uppercase tracking-wide text-ink-600"
                onClick={() => toggleCol(id)}
                title={`Expand ${label}`}
              >
                <span className="rotate-180" style={{ writingMode: "vertical-rl" }}>
                  {label}
                </span>
              </button>
            );
          }
          return (
            <section
              key={id}
              className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200 bg-warm-paper/90"
              style={{ flex: state.flex * (openCount === 1 ? 1.2 : 1) }}
            >
              <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
                <h2 className="text-sm font-medium">{label}</h2>
                <button
                  type="button"
                  className="text-[10px] text-ink-500 underline"
                  onClick={() => toggleCol(id)}
                >
                  Collapse
                </button>
              </div>

              {id === "magic" ? (
                <MagicColumnPanel
                  campaignId={campaignId}
                  campaign={campaign}
                  briefDraft={briefDraft}
                  onBriefChange={setBriefDraft}
                  busy={busy}
                  onPrepare={runPrepare}
                  onGenerate={runGenerate}
                  onImported={refresh}
                />
              ) : null}

              {id === "hopper" ? (
                <div className="border-b border-ink-100 px-3 py-2 text-xs">
                  <p className="text-ink-600">
                    {cells.length} cells · {kept} kept · deep links
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <a
                      className="underline"
                      href={`/campaigns/${campaignId}/ingredients`}
                    >
                      Ingredients
                    </a>
                    <a
                      className="underline"
                      href={`/campaigns/${campaignId}/matrix`}
                    >
                      Matrix
                    </a>
                    <a
                      className="underline"
                      href={`/campaigns/${campaignId}/variants`}
                    >
                      Variants
                    </a>
                    <a
                      className="underline"
                      href={`/campaigns/${campaignId}/review`}
                    >
                      Assemble
                    </a>
                  </div>
                  <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                    {cells.slice(0, 12).map((cell) => {
                      const rev = reviews.find((r) => r.cellId === cell.cellId);
                      return (
                        <li
                          key={cell.cellId}
                          className="flex flex-wrap items-center gap-1 rounded border border-ink-100 px-1.5 py-1"
                        >
                          <span className="font-mono text-[10px]">
                            {cell.cellId}
                          </span>
                          <span className="text-[10px] text-ink-500">
                            {rev?.decision || "pending"}
                          </span>
                          <button
                            type="button"
                            className="ml-auto rounded border px-1 text-[10px]"
                            onClick={() =>
                              void api
                                .setReview(campaignId, cell.cellId, {
                                  decision: "approved",
                                })
                                .then(() => refresh())
                                .then(() => setCeltraTick((n) => n + 1))
                            }
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            className="rounded border px-1 text-[10px]"
                            onClick={() =>
                              void api
                                .setReview(campaignId, cell.cellId, {
                                  decision: "rejected",
                                })
                                .then(() => refresh())
                            }
                          >
                            Kill
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {id === "celtra" ? (
                <CeltraPreviewPanel
                  campaignId={campaignId}
                  refreshToken={celtraTick}
                />
              ) : (
                <EventFeed
                  campaignId={campaignId}
                  column={id}
                  events={events}
                  hasMore={hasMore}
                  onLoadOlder={loadOlder}
                />
              )}

              <ColumnComposer
                column={id}
                llmOn={llmOn}
                disabled={busy !== null}
                onSubmit={(t) => handleComposer(id, t)}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
