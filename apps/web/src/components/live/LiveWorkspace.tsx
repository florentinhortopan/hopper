"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Campaign,
  Job,
  LiveColumnId,
  LiveConnection,
  LiveConnectionId,
  ReviewEntry,
} from "@attatta/shared";
import { connectionIdForColumn } from "@attatta/shared";
import { CeltraPreviewPanel } from "@/components/live/CeltraPreviewPanel";
import { ColumnComposer } from "@/components/live/ColumnComposer";
import { ColumnConnectionChip } from "@/components/live/ColumnConnectionChip";
import {
  EventFeed,
  eventVisibleInColumn,
  useCampaignEventStream,
} from "@/components/live/EventFeed";
import {
  LiveChatPromptBar,
  type LiveChatPrompt,
} from "@/components/live/LiveChatPromptBar";
import { LiveHopperMatrix } from "@/components/live/LiveHopperMatrix";
import { LiveQueuePreview } from "@/components/live/LiveQueuePreview";
import { missingSizeSlotCount } from "@/components/live/liveMatrixUtils";
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
  const [queueTick, setQueueTick] = useState(0);
  const [briefDraft, setBriefDraft] = useState("");
  const [magicReady, setMagicReady] = useState<{
    ready: boolean;
    variantCount: number;
    detail: string;
    importReview: boolean;
    importId: string | null;
  } | null>(null);
  const [chatPrompts, setChatPrompts] = useState<LiveChatPrompt[]>([]);
  const offeredKeysRef = useRef(new Set<string>());
  const [activityOpen, setActivityOpen] = useState<
    Partial<Record<LiveColumnId, boolean>>
  >({});
  const [connections, setConnections] = useState<
    Partial<Record<LiveConnectionId, LiveConnection>>
  >({});

  const magicScrollRef = useRef<HTMLDivElement>(null);
  const hopperScrollRef = useRef<HTMLDivElement>(null);
  const celtraScrollRef = useRef<HTMLDivElement>(null);

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

  const bumpColumnRefresh = useCallback(() => {
    setCeltraTick((n) => n + 1);
    setQueueTick((n) => n + 1);
    void refresh().catch(() => undefined);
  }, [refresh]);

  const jobsTerminalSigRef = useRef<string>("");
  const handleJobsChange = useCallback(
    (jobs: Job[]) => {
      const terminal = jobs
        .filter(
          (j) =>
            j.status === "done" ||
            j.status === "failed" ||
            j.status === "cancelled",
        )
        .map((j) => `${j.id}:${j.status}`)
        .sort()
        .join(",");
      if (terminal === jobsTerminalSigRef.current) return;
      jobsTerminalSigRef.current = terminal;
      if (terminal) bumpColumnRefresh();
    },
    [bumpColumnRefresh],
  );

  // While plates are generating, poll campaign so Hopper/Celtra update even if SSE drops.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void api
        .jobs(campaignId)
        .then((jobs) => {
          if (cancelled) return;
          const active = jobs.some(
            (j) => j.status === "queued" || j.status === "running",
          );
          if (!active) return;
          setCeltraTick((n) => n + 1);
          setQueueTick((n) => n + 1);
          void refresh().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    const t = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [campaignId, refresh]);

  const refreshConnections = useCallback(async () => {
    try {
      const res = await api.liveConnections(campaignId);
      const map: Partial<Record<LiveConnectionId, LiveConnection>> = {};
      for (const c of res.connections) map[c.id] = c;
      setConnections(map);
    } catch {
      /* non-fatal */
    }
  }, [campaignId]);

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    void api.liveLlmStatus()
      .then((s) => setLlmOn(s.configured))
      .catch(() => setLlmOn(false));
    void api.liveOpen(campaignId).catch(() => undefined);
    offeredKeysRef.current = new Set();
    setChatPrompts([]);
    void refreshConnections();
    const t = window.setInterval(() => void refreshConnections(), 15000);
    return () => window.clearInterval(t);
  }, [campaignId, refresh, refreshConnections]);

  useEffect(() => {
    const relevant = events[0];
    if (!relevant) return;
    if (
      relevant.type === "review_decision" ||
      relevant.type === "job_update" ||
      relevant.type === "celtra_package" ||
      relevant.type === "celtra_preview" ||
      relevant.type === "magic_generate" ||
      relevant.type === "magic_prepare" ||
      relevant.type === "comfy_publish"
    ) {
      const t = window.setTimeout(() => {
        bumpColumnRefresh();
      }, 350);
      return () => window.clearTimeout(t);
    }
  }, [events, bumpColumnRefresh]);

  const offerChatPrompt = useCallback(
    (input: {
      column: LiveColumnId;
      key: string;
      summary: string;
      detail: string;
      primaryLabel: string;
    }) => {
      if (offeredKeysRef.current.has(input.key)) return;
      offeredKeysRef.current.add(input.key);
      const prompt: LiveChatPrompt = {
        id: input.key,
        column: input.column,
        key: input.key,
        summary: input.summary,
        detail: input.detail,
        primaryLabel: input.primaryLabel,
        status: "open",
        at: Date.now(),
      };
      setChatPrompts((prev) => {
        const sameFamily = input.key.split(":")[0] || "";
        const cleared =
          sameFamily === "generate" || sameFamily === "import"
            ? prev.map((p) =>
                p.status === "open" && p.key.startsWith(`${sameFamily}:`)
                  ? { ...p, status: "dismissed" as const }
                  : p,
              )
            : prev;
        return [...cleared.filter((p) => p.key !== input.key), prompt];
      });
    },
    [],
  );

  const closeChatPrompt = useCallback((key: string, status: "acted" | "dismissed") => {
    setChatPrompts((prev) =>
      prev.map((p) => (p.key === key ? { ...p, status } : p)),
    );
  }, []);

  // Magic: import ready → confirm & prepare
  useEffect(() => {
    if (!magicReady?.importReview || !magicReady.importId) return;
    offerChatPrompt({
      column: "magic",
      key: `import:${magicReady.importId}`,
      summary: "Package classified — confirm import?",
      detail: "Commit plates into the library and run prepare.",
      primaryLabel: "Confirm import & prepare",
    });
  }, [magicReady?.importReview, magicReady?.importId, offerChatPrompt]);

  // Magic: prepare ready → generate (once per prepare epoch; not after generate)
  useEffect(() => {
    if (!magicReady?.ready || !campaign) return;
    const prepareEv = events.find((e) => e.type === "magic_prepare");
    const prepareAt = prepareEv?.at || "";
    const generatedAfter = events.some(
      (e) =>
        e.type === "magic_generate" &&
        (!prepareAt || e.at >= prepareAt),
    );
    if (generatedAfter) return;
    const sizes = campaign.outputSizes || [];
    const missing = missingSizeSlotCount(campaign.matrix.cells, sizes);
    const sizeLabel = sizes.map((s) => s.aspect).join(", ") || "none";
    const key = `generate:${prepareEv?.id || `v${magicReady.variantCount}`}`;
    offerChatPrompt({
      column: "magic",
      key,
      summary: "Checks look good — generate plates?",
      detail:
        missing > 0
          ? `${magicReady.detail}. Settings sizes (${sizeLabel}): ${missing} plate×size slot(s) still empty.`
          : magicReady.detail,
      primaryLabel:
        missing > 0 ? "Generate missing sizes" : "Generate",
    });
  }, [magicReady, events, offerChatPrompt, campaign]);

  // After jobs settle, nudge if Settings sizes still incomplete
  useEffect(() => {
    const latest = events[0];
    if (latest?.type !== "job_update" && latest?.type !== "magic_generate") {
      return;
    }
    if (!campaign?.matrix.cells.length || !campaign.outputSizes?.length) return;
    const status = String(latest.payload?.status || "");
    if (
      latest.type === "job_update" &&
      status !== "done" &&
      status !== "failed" &&
      status !== "cancelled"
    ) {
      return;
    }
    const missing = missingSizeSlotCount(
      campaign.matrix.cells,
      campaign.outputSizes,
    );
    if (missing <= 0) return;
    const sizeKey = campaign.outputSizes.map((s) => s.id).join(",");
    offerChatPrompt({
      column: "magic",
      key: `fill-sizes:${sizeKey}:${missing}`,
      summary: `${missing} Settings size slot(s) still missing`,
      detail: `Active sizes: ${campaign.outputSizes.map((s) => s.aspect).join(", ")}. Generate remaining plates to match Settings.`,
      primaryLabel: "Generate missing sizes",
    });
  }, [events, campaign, offerChatPrompt]);

  // After generate event → close open generate prompts
  useEffect(() => {
    const latest = events[0];
    if (latest?.type !== "magic_generate") return;
    setChatPrompts((prev) =>
      prev.map((p) =>
        p.column === "magic" &&
        p.key.startsWith("generate:") &&
        p.status === "open"
          ? { ...p, status: "acted" }
          : p,
      ),
    );
  }, [events]);

  // Hopper: plates finished → review
  useEffect(() => {
    const latest = events[0];
    if (latest?.type !== "job_update") return;
    const status = String(latest.payload?.status || "");
    if (status !== "done" && status !== "failed" && status !== "cancelled") {
      return;
    }
    let cancelled = false;
    void api.jobs(campaignId).then((jobs) => {
      if (cancelled) return;
      const active = jobs.filter(
        (j) => j.status === "queued" || j.status === "running",
      );
      const done = jobs.filter((j) => j.status === "done");
      if (active.length || !done.length) return;
      offerChatPrompt({
        column: "hopper",
        key: `review-batch:${done.map((j) => j.id).slice(0, 8).join(",")}`,
        summary: "Plates ready — review in Hopper?",
        detail: `${done.length} done. Keep or kill variants, then Celtra can package.`,
        primaryLabel: "Open Hopper",
      });
      offerChatPrompt({
        column: "magic",
        key: `gen-done:${done.map((j) => j.id).slice(0, 8).join(",")}`,
        summary: "Generation finished",
        detail: "Review Keep/Kill in Hopper when you’re ready.",
        primaryLabel: "Open Hopper",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [events, campaignId, offerChatPrompt]);

  // Celtra: packable rows → package
  useEffect(() => {
    let cancelled = false;
    void api
      .celtraPreview(campaignId)
      .then((p) => {
        if (cancelled || !p.packableCount) return;
        offerChatPrompt({
          column: "celtra",
          key: `package:${campaignId}:${p.packableCount}:${p.approvedCount}`,
          summary: "Packable rows ready — build Celtra zip?",
          detail: `${p.packableCount} kept + plated row(s).`,
          primaryLabel: "Package zip",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId, celtraTick, offerChatPrompt]);

  // Close package prompts after package event
  useEffect(() => {
    if (events[0]?.type !== "celtra_package") return;
    setChatPrompts((prev) =>
      prev.map((p) =>
        p.key.startsWith("package:") && p.status === "open"
          ? { ...p, status: "acted" }
          : p,
      ),
    );
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

  function scrollRefFor(id: LiveColumnId) {
    if (id === "magic") return magicScrollRef;
    if (id === "hopper") return hopperScrollRef;
    return celtraScrollRef;
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
      setQueueTick((n) => n + 1);
      setChatPrompts((prev) =>
        prev.map((p) =>
          (p.key.startsWith("generate:") || p.key.startsWith("fill-sizes:")) &&
          p.status === "open"
            ? { ...p, status: "acted" }
            : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runConfirmImport(importId: string) {
    if (!campaign) return;
    setBusy("prepare");
    setError(null);
    try {
      const session = await api.getImportSession(importId);
      if (session.status === "review") {
        await api.patchImportRows(
          importId,
          session.rows.map((r) => ({ id: r.id, status: "accepted" as const })),
        );
        await api.commitImport(importId);
      }
      await api.magicPrepare(campaignId, {
        brief: {
          ...campaign.brief,
          prompt: briefDraft.trim() || campaign.brief.prompt || "New offer",
        },
        importId,
      });
      closeChatPrompt(`import:${importId}`, "acted");
      await refresh();
      setCeltraTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPackage() {
    setBusy("package");
    setError(null);
    try {
      const result = await api.package(campaignId);
      const { triggerApiDownload } = await import("@/lib/download");
      await triggerApiDownload(result.downloadUrl, result.fileName);
      setCeltraTick((n) => n + 1);
      setChatPrompts((prev) =>
        prev.map((p) =>
          p.key.startsWith("package:") && p.status === "open"
            ? { ...p, status: "acted" }
            : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function focusColumn(id: LiveColumnId) {
    setCols((prev) => ({
      ...prev,
      [id]: { ...prev[id], open: true },
    }));
  }

  async function handleChatAct(prompt: LiveChatPrompt) {
    if (prompt.key.startsWith("import:")) {
      const importId = prompt.key.slice("import:".length);
      await runConfirmImport(importId);
      return;
    }
    if (prompt.key.startsWith("generate:") || prompt.key.startsWith("fill-sizes:")) {
      await runGenerate();
      return;
    }
    if (prompt.key.startsWith("package:")) {
      await runPackage();
      return;
    }
    if (
      prompt.key.startsWith("review-batch:") ||
      prompt.key.startsWith("gen-done:")
    ) {
      focusColumn("hopper");
      closeChatPrompt(prompt.key, "acted");
      return;
    }
    closeChatPrompt(prompt.key, "acted");
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
          const scrollRef = scrollRefFor(id);
          const activityCount = events.filter((e) =>
            eventVisibleInColumn(e, id),
          ).length;
          const showActivity = Boolean(activityOpen[id]);
          return (
            <section
              key={id}
              className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200 bg-warm-paper/90"
              style={{ flex: state.flex * (openCount === 1 ? 1.2 : 1) }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-200 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">{label}</h2>
                  <ColumnConnectionChip
                    connectionId={connectionIdForColumn(id)}
                    connection={
                      connections[connectionIdForColumn(id)] ?? null
                    }
                    campaignId={campaignId}
                    onResynced={(next) => {
                      setConnections((prev) => ({
                        ...prev,
                        [next.id]: next,
                      }));
                      if (next.id === "celtra") {
                        setCeltraTick((n) => n + 1);
                      }
                      if (next.id === "hopper" || next.id === "comfy") {
                        setQueueTick((n) => n + 1);
                        void refresh().catch(() => undefined);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`rounded border px-2 py-0.5 text-[10px] ${
                      showActivity
                        ? "border-ink-900 bg-ink-900 text-white"
                        : "border-ink-200 bg-white text-ink-600"
                    }`}
                    onClick={() =>
                      setActivityOpen((prev) => ({
                        ...prev,
                        [id]: !prev[id],
                      }))
                    }
                    title="Show column activity log"
                  >
                    Activity
                    {activityCount > 0 ? ` · ${activityCount}` : ""}
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-ink-500 underline"
                    onClick={() => toggleCol(id)}
                  >
                    Collapse
                  </button>
                </div>
              </div>

              {showActivity ? (
                <div className="absolute inset-x-0 top-10 z-20 flex max-h-[min(22rem,50%)] flex-col border-b border-ink-200 bg-warm-paper shadow-lg">
                  <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-3 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
                      Activity
                    </span>
                    <button
                      type="button"
                      className="text-[10px] text-ink-500 underline"
                      onClick={() =>
                        setActivityOpen((prev) => ({ ...prev, [id]: false }))
                      }
                    >
                      Close
                    </button>
                  </div>
                  <EventFeed
                    campaignId={campaignId}
                    column={id}
                    events={events}
                    hasMore={hasMore}
                    onLoadOlder={loadOlder}
                  />
                </div>
              ) : null}

              {/* One scroller for the whole column body */}
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {id === "magic" ? (
                  <MagicColumnPanel
                    campaignId={campaignId}
                    campaign={campaign}
                    briefDraft={briefDraft}
                    onBriefChange={setBriefDraft}
                    busy={busy}
                    onPrepare={runPrepare}
                    onReadinessChange={setMagicReady}
                    coverageToken={queueTick + celtraTick}
                    onImported={async () => {
                      await refresh();
                      setCeltraTick((n) => n + 1);
                    }}
                  />
                ) : null}

                {id === "hopper" ? (
                  <LiveHopperMatrix
                    campaignId={campaignId}
                    cells={cells}
                    sizes={campaign?.outputSizes || []}
                    reviews={reviews}
                    refreshToken={queueTick}
                    onChanged={async () => {
                      await refresh();
                      setCeltraTick((n) => n + 1);
                    }}
                  />
                ) : null}

                {id === "celtra" ? (
                  <CeltraPreviewPanel
                    campaignId={campaignId}
                    refreshToken={celtraTick}
                  />
                ) : null}

                {id === "magic" ? (
                  <LiveQueuePreview
                    campaignId={campaignId}
                    refreshToken={queueTick}
                    onJobsChange={handleJobsChange}
                  />
                ) : null}
              </div>

              <div className="shrink-0">
                <LiveChatPromptBar
                  column={id}
                  prompts={chatPrompts}
                  disabled={busy !== null}
                  busyLabel={
                    busy === "generate"
                      ? "Generating…"
                      : busy === "prepare"
                        ? "Preparing…"
                        : busy === "package"
                          ? "Packaging…"
                          : null
                  }
                  onAct={handleChatAct}
                  onDismiss={(p) => closeChatPrompt(p.key, "dismissed")}
                />
                <ColumnComposer
                  column={id}
                  llmOn={llmOn}
                  disabled={busy !== null}
                  onSubmit={(t) => handleComposer(id, t)}
                />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
