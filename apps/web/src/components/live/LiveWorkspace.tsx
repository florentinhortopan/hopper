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
import { ColumnConnectionChip } from "@/components/live/ColumnConnectionChip";
import { ColumnStickScroll } from "@/components/live/ColumnStickScroll";
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
import { WorkspaceComposer } from "@/components/live/WorkspaceComposer";
import { routeLiveChatText } from "@/components/live/routeLiveChat";
import { api } from "@/lib/api";

type ColState = { open: boolean; flex: number };

const DEFAULT_COLS: Record<LiveColumnId, ColState> = {
  magic: { open: true, flex: 1 },
  hopper: { open: true, flex: 1.2 },
  celtra: { open: true, flex: 1 },
};

/** Witty stage copy — presentation only; column ids / logic unchanged. */
const COLUMN_STAGE: Record<
  LiveColumnId,
  { label: string; verb: string; role: string; hint: string }
> = {
  magic: {
    label: "Magic",
    verb: "Cast",
    role: "Pre-production",
    hint: "Brief → plates",
  },
  hopper: {
    label: "Hopper",
    verb: "Cull",
    role: "Refinement",
    hint: "Keep · Kill · sizes",
  },
  celtra: {
    label: "Celtra",
    verb: "Ship",
    role: "Distribution",
    hint: "Pack for Meta",
  },
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
  const [queueScrollTick, setQueueScrollTick] = useState(0);
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
  const jobsProgressSigRef = useRef<string>("");
  const handleJobsChange = useCallback(
    (jobs: Job[]) => {
      const progress = jobs
        .map(
          (j) =>
            `${j.id}:${j.status}:${Math.round((j.progress || 0) * 100)}:${j.message || ""}`,
        )
        .sort()
        .join("|");
      if (progress !== jobsProgressSigRef.current) {
        jobsProgressSigRef.current = progress;
        setQueueScrollTick((n) => n + 1);
      }
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
      setChatPrompts((prev) => {
        const family = input.key.split(":")[0] || "";
        const openSameKey = prev.find(
          (p) => p.key === input.key && p.status === "open",
        );
        // Same open prompt — refresh copy only (e.g. selected count), never stack
        if (openSameKey) {
          if (
            openSameKey.detail === input.detail &&
            openSameKey.summary === input.summary
          ) {
            return prev;
          }
          return prev.map((p) =>
            p.key === input.key && p.status === "open"
              ? {
                  ...p,
                  summary: input.summary,
                  detail: input.detail,
                  primaryLabel: input.primaryLabel,
                }
              : p,
          );
        }
        // Already offered (dismissed / acted) — do not revive
        if (offeredKeysRef.current.has(input.key)) return prev;
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
        // One open nudge per family (combos / generate / …)
        const cleared = prev.map((p) =>
          p.status === "open" &&
          p.key.startsWith(`${family}:`) &&
          p.key !== input.key
            ? { ...p, status: "dismissed" as const }
            : p,
        );
        return [...cleared.filter((p) => p.key !== input.key), prompt];
      });
    },
    [],
  );

  const closeChatPrompt = useCallback(
    (key: string, status: "acted" | "dismissed") => {
      offeredKeysRef.current.add(key);
      setChatPrompts((prev) =>
        prev.map((p) => (p.key === key ? { ...p, status } : p)),
      );
    },
    [],
  );

  const dismissAllChatPrompts = useCallback((column?: LiveColumnId) => {
    setChatPrompts((prev) =>
      prev.map((p) => {
        if (p.status !== "open") return p;
        if (column && p.column !== column) return p;
        offeredKeysRef.current.add(p.key);
        return { ...p, status: "dismissed" as const };
      }),
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

  // After prepare / matrix lands → one Hopper combo nudge (stable key = cell ids)
  const matrixCellSig = useMemo(
    () =>
      (campaign?.matrix.cells ?? [])
        .map((c) => c.cellId)
        .slice()
        .sort()
        .join(","),
    [campaign?.matrix.cells],
  );
  const matrixSelectedCount = useMemo(
    () =>
      (campaign?.matrix.cells ?? []).filter((c) => c.selectedForGen !== false)
        .length,
    [campaign?.matrix.cells],
  );

  useEffect(() => {
    if (!matrixCellSig || !campaign?.matrix.cells.length) return;
    const available = campaign.matrix.cells.length;
    // Drop leftover Hopper-column combo nudges (table is already on that column)
    setChatPrompts((prev) =>
      prev.map((p) =>
        p.column === "hopper" &&
        p.key.startsWith("combos:") &&
        p.status === "open"
          ? { ...p, status: "dismissed" as const }
          : p,
      ),
    );
    // Nudge lives on Magic — Hopper already shows the Pick combinations table
    offerChatPrompt({
      column: "magic",
      key: `combos:${matrixCellSig}`,
      summary: "Pick combinations in Hopper",
      detail: `${available} combo(s) available · ${matrixSelectedCount} selected. Check rows in Hopper; this generation list updates to match.`,
      primaryLabel: "Open Hopper",
    });
  }, [
    matrixCellSig,
    matrixSelectedCount,
    campaign?.matrix.cells.length,
    campaign,
    offerChatPrompt,
  ]);

  // Magic: ready to generate — re-offer when selection / missing work changes
  useEffect(() => {
    if (!magicReady?.ready || !campaign) return;
    const selectedCells = campaign.matrix.cells.filter(
      (c) => c.selectedForGen !== false,
    );
    if (!selectedCells.length) return;
    const sizes = campaign.outputSizes || [];
    const missing = missingSizeSlotCount(selectedCells, sizes);
    const needsPlate = selectedCells.some((c) => c.needsGen);
    if (missing <= 0 && !needsPlate) return;

    const prepareEv = events.find((e) => e.type === "magic_prepare");
    const selectionSig = selectedCells
      .map((c) => c.cellId)
      .slice()
      .sort()
      .join(",");
    const sizeLabel = sizes.map((s) => s.aspect).join(", ") || "none";
    // Include selection so new Hopper checks get a fresh Generate nudge
    const key = `generate:${prepareEv?.id || "prep"}:${selectionSig}`;
    offerChatPrompt({
      column: "magic",
      key,
      summary: `Generate ${selectedCells.length} selected combo(s)?`,
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
    if (prompt.key.startsWith("combos:")) {
      focusColumn("hopper");
      closeChatPrompt(prompt.key, "acted");
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

  const [composerRoute, setComposerRoute] = useState<{
    column: LiveColumnId;
    label: string;
  } | null>(null);

  async function handleWorkspaceChat(text: string): Promise<{
    reply: string;
    route: { column: LiveColumnId; label: string };
    replySource: "llm" | "template";
  }> {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        reply: "Say something, or try /prepare · /generate · /package.",
        route: { column: "hopper", label: "idle" },
        replySource: "template",
      };
    }

    let intent = routeLiveChatText(trimmed);
    let routeSource = "local";
    let reply =
      "Working on it…";
    let replySource: "llm" | "template" = "template";

    // Always ask the server for a reply (template if LLM off); free text also gets routing.
    try {
      const chat = await api.liveChat(campaignId, {
        text: trimmed,
        source: "workspace",
      });
      reply = chat.reply;
      replySource = chat.replySource;
      routeSource = chat.route.source;
      const remote = chat.route;
      if (remote.intent === "prepare") {
        intent = { kind: "prepare", column: "magic" };
      } else if (remote.intent === "generate") {
        intent = { kind: "generate", column: "magic" };
      } else if (remote.intent === "package") {
        intent = { kind: "package", column: "celtra" };
      } else if (
        (remote.intent === "keep" || remote.intent === "kill") &&
        remote.cellId
      ) {
        intent = {
          kind: remote.intent,
          column: "hopper",
          cellId: remote.cellId,
        };
      } else if (remote.intent === "brief") {
        intent = {
          kind: "brief",
          column: "magic",
          text: remote.text || trimmed,
        };
      } else if (remote.intent === "note") {
        intent = {
          kind: "note",
          column: remote.column,
          text: remote.text || trimmed,
        };
      } else if (trimmed.startsWith("/")) {
        // Keep local slash parse if server returned unknown
        intent = routeLiveChatText(trimmed);
      } else {
        intent = {
          kind: "unknown",
          column: remote.column,
          text: trimmed,
          hint: remote.rationale,
        };
      }
    } catch {
      /* local intent + generic reply */
      if (intent.kind === "prepare") reply = "Running Magic prepare…";
      else if (intent.kind === "generate") reply = "Queuing generate…";
      else if (intent.kind === "package") reply = "Packaging Celtra…";
      else
        reply =
          "Logged that locally. Set ATTATTA_LLM_API_KEY on the orchestrator for richer replies.";
    }

    const label =
      intent.kind === "note" || intent.kind === "brief"
        ? intent.kind
        : intent.kind === "unknown"
          ? "note"
          : intent.kind;
    const route = {
      column: intent.column,
      label: `${label} (${routeSource})`,
    };
    setComposerRoute(route);
    focusColumn(intent.column);

    try {
      if (intent.kind === "prepare") {
        await runPrepare();
      } else if (intent.kind === "generate") {
        await runGenerate();
      } else if (intent.kind === "package") {
        await runPackage();
      } else if (intent.kind === "keep" || intent.kind === "kill") {
        await api.setReview(campaignId, intent.cellId, {
          decision: intent.kind === "keep" ? "approved" : "rejected",
        });
        await refresh();
        setCeltraTick((n) => n + 1);
        await api.liveNote(campaignId, {
          column: "hopper",
          text: `/${intent.kind} ${intent.cellId}`,
          source: "workspace",
        });
      } else if (intent.kind === "brief") {
        setBriefDraft(intent.text);
        await api.liveNote(campaignId, {
          column: "magic",
          text: intent.text,
          source: "workspace",
        });
      } else if (intent.kind === "note") {
        await api.liveNote(campaignId, {
          column: intent.column,
          text: intent.text,
          source: "workspace",
        });
        if (intent.column === "magic") setBriefDraft(intent.text);
      } else {
        setError(intent.hint || "Unknown command");
        await api.liveNote(campaignId, {
          column: intent.column,
          text: trimmed,
          source: "workspace",
        });
      }
    } catch (e) {
      reply = e instanceof Error ? e.message : String(e);
      replySource = "template";
    }

    return { reply, route, replySource };
  }

  const cells = campaign?.matrix?.cells ?? [];

  return (
    <div className="ws-shell fixed inset-0 z-40 flex flex-col text-ink-900">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-900/10 bg-warm-paper/90 px-4 py-2.5 backdrop-blur-[2px]">
        <a
          href="/"
          className="font-display text-xl font-semibold tracking-tight text-ink-900 no-underline transition-colors hover:text-ember-600"
        >
          ATTATTA
        </a>
        <span className="ws-label-caps hidden sm:inline">Live workspace</span>
        <div className="hidden h-4 w-px bg-ink-900/15 sm:block" aria-hidden />
        <span
          className="max-w-[14rem] truncate font-display text-base font-semibold tracking-tight text-ink-900"
          title={campaign?.name}
        >
          {campaign?.name || "…"}
        </span>
        <span className="font-mono text-[10px] text-ink-600/80">{campaignId}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
            connected
              ? "border-emerald-800/20 bg-emerald-50 text-emerald-900"
              : "border-ink-200 bg-ink-50 text-ink-600"
          }`}
        >
          {connected ? <span className="ws-live-dot" aria-hidden /> : null}
          {connected ? "Live" : "Reconnecting"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          {(["magic", "hopper", "celtra"] as LiveColumnId[]).map((id) => {
            const stage = COLUMN_STAGE[id];
            return (
              <button
                key={id}
                type="button"
                className={`ws-chip rounded-sm border px-2.5 py-1 text-[11px] font-medium ${
                  cols[id].open
                    ? "border-ink-900 bg-ink-900 text-warm-paper"
                    : "border-ink-900/15 bg-warm-paper text-ink-600 hover:border-ink-900/40"
                }`}
                onClick={() => toggleCol(id)}
                title={`${stage.verb} · ${stage.hint}`}
              >
                <span className="font-display text-[13px] font-semibold">
                  {stage.verb}
                </span>
                <span className="ml-1 opacity-70">{stage.label}</span>
              </button>
            );
          })}
          <a
            href={`/campaigns/${campaignId}/brief`}
            className="ws-chip rounded-sm border border-ink-900/15 bg-warm-paper px-2.5 py-1 text-[11px] font-medium text-ink-700 no-underline hover:border-ink-900/40"
          >
            Advanced
          </a>
          <a
            href="/"
            className="ws-chip rounded-sm border border-transparent px-2 py-1 text-[11px] font-medium text-ember-600 no-underline hover:text-ember-700"
          >
            Exit
          </a>
        </div>
      </header>

      {error ? (
        <pre className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </pre>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-2 p-2 sm:gap-2.5 sm:p-2.5">
        {(
          [
            ["magic", COLUMN_STAGE.magic],
            ["hopper", COLUMN_STAGE.hopper],
            ["celtra", COLUMN_STAGE.celtra],
          ] as const
        ).map(([id, stage]) => {
          const state = cols[id];
          if (!state.open) {
            return (
              <button
                key={id}
                type="button"
                className="ws-col-rail flex w-11 shrink-0 flex-col items-center gap-3 rounded-sm border border-ink-900/12 bg-warm-paper py-4 text-ink-600"
                onClick={() => toggleCol(id)}
                title={`Expand ${stage.label} — ${stage.verb}`}
              >
                <span className="font-display text-sm font-semibold tracking-tight">
                  {stage.verb}
                </span>
                <span
                  className="ws-label-caps rotate-180"
                  style={{ writingMode: "vertical-rl" }}
                >
                  {stage.label}
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
              className="ws-col relative flex min-w-0 flex-col overflow-hidden rounded-sm border border-ink-900/12 bg-warm-paper/95"
              style={{ flex: state.flex * (openCount === 1 ? 1.2 : 1) }}
            >
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-ink-900/10 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="font-display text-2xl font-semibold leading-none tracking-tight text-ink-900">
                      {stage.verb}
                    </h2>
                    <span className="font-display text-sm font-medium text-ink-600">
                      {stage.label}
                    </span>
                  </div>
                  <span className="ws-title-rule mt-1.5" aria-hidden />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="ws-label-caps">{stage.role}</span>
                    <span className="text-[10px] text-ink-600/70">
                      {stage.hint}
                    </span>
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
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    className={`ws-chip rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                      showActivity
                        ? "border-ink-900 bg-ink-900 text-warm-paper"
                        : "border-ink-900/15 bg-transparent text-ink-600 hover:border-ink-900/35"
                    }`}
                    onClick={() =>
                      setActivityOpen((prev) => ({
                        ...prev,
                        [id]: !prev[id],
                      }))
                    }
                    title="Show column activity log"
                  >
                    Log
                    {activityCount > 0 ? ` · ${activityCount}` : ""}
                  </button>
                  <button
                    type="button"
                    className="ws-chip rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-ember-600 hover:text-ember-700"
                    onClick={() => toggleCol(id)}
                  >
                    Collapse
                  </button>
                </div>
              </div>

              {showActivity ? (
                <div className="absolute inset-x-0 top-[4.25rem] z-20 flex max-h-[min(22rem,50%)] flex-col border-b-2 border-ink-900 bg-warm-paper">
                  <div className="flex shrink-0 items-center justify-between border-b border-ink-900/10 px-3 py-1.5">
                    <span className="ws-label-caps">Activity</span>
                    <button
                      type="button"
                      className="text-[10px] font-medium text-ember-600 hover:text-ember-700"
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
                <ColumnStickScroll
                  scrollerRef={scrollRef}
                  anchorId={id === "magic" ? "live-queue-stick" : null}
                  contentKey={
                    id === "magic"
                      ? `m:${queueScrollTick}:${queueTick}:${events[0]?.id || ""}:${chatPrompts.filter((p) => p.column === "magic" && p.status === "open").length}`
                      : id === "hopper"
                        ? `h:${queueTick}:${reviews.length}:${cells.length}:${matrixSelectedCount}:${events[0]?.id || ""}`
                        : `c:${celtraTick}:${events[0]?.id || ""}:${reviews.length}`
                  }
                  forceKey={
                    id === "magic"
                      ? busy === "generate" || busy === "prepare"
                        ? `force-m-${busy}-${queueTick}`
                        : events.find((e) => e.type === "magic_generate")?.id ||
                          null
                      : id === "hopper"
                        ? events.find(
                            (e) =>
                              e.type === "magic_generate" ||
                              e.type === "review_decision",
                          )?.id || null
                        : events.find(
                            (e) =>
                              e.type === "celtra_package" ||
                              e.type === "celtra_preview" ||
                              e.type === "review_decision",
                          )?.id || null
                  }
                />
                {id === "magic" ? (
                  <MagicColumnPanel
                    campaignId={campaignId}
                    campaign={campaign}
                    briefDraft={briefDraft}
                    onBriefChange={setBriefDraft}
                    busy={busy}
                    onPrepare={runPrepare}
                    onGenerate={runGenerate}
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
                {/* Anchor so stick-scroll lands on the latest block */}
                <div aria-hidden className="h-px w-full shrink-0" />
              </div>

              <div className="shrink-0">
                <LiveChatPromptBar
                  column={id}
                  prompts={chatPrompts}
                  actDisabled={busy !== null}
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
                  onDismissAll={() => dismissAllChatPrompts(id)}
                />
              </div>
            </section>
          );
        })}
      </div>

      <WorkspaceComposer
        llmOn={llmOn}
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
        lastRoute={composerRoute}
        onSubmit={handleWorkspaceChat}
      />
    </div>
  );
}
