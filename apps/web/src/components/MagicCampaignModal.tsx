"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Brief,
  Campaign,
  ImportSession,
  Job,
  LibraryKind,
  MagicChecklistItem,
  MagicVariantPlanRow,
  ReviewEntry,
} from "@attatta/shared";
import { api } from "@/lib/api";
import { useImportEta } from "@/lib/useImportEta";
import { DesignerPublishBanner } from "@/components/DesignerPublishBanner";
import { JobProgressRow } from "@/components/JobProgressRow";
import { VariantMediaPreview } from "@/components/VariantMediaPreview";
import { triggerApiDownload } from "@/lib/download";

/** import → checking (prepare progress) → plan → run */
type Phase = "import" | "checking" | "plan" | "run";

type PrepareResult = {
  campaign: Campaign;
  gapsFilled: MagicChecklistItem[];
  variants: MagicVariantPlanRow[];
  canContinue: boolean;
  reasons: string[];
  plannedCells: number;
  workflowSource: MagicChecklistItem["source"];
  warnings: string[];
};

type CheckStatus = "pending" | "checking" | "done" | "fail";

type LiveCheckItem = {
  id: string;
  label: string;
  status: CheckStatus;
  ok?: boolean;
  source?: MagicChecklistItem["source"];
  detail?: string;
};

const KINDS: LibraryKind[] = [
  "talent",
  "hands",
  "motion",
  "attire",
  "background",
  "prop",
  "theme",
  "copy",
];

const PREPARE_STEPS: Array<{ id: string; label: string }> = [
  { id: "brief", label: "Brief" },
  { id: "workflow", label: "Workflow / recipe" },
  { id: "talent", label: "Talent take" },
  { id: "hands", label: "Hands plates" },
  { id: "background", label: "Background" },
  { id: "attire", label: "Attire" },
  { id: "prop", label: "Props" },
  { id: "motion", label: "Motion" },
  { id: "copy", label: "Copy" },
  { id: "tokens", label: "Design tokens" },
  { id: "connectors", label: "Comfy + LLM" },
  { id: "variants", label: "Variant matrix" },
];

function sourceBadge(source: MagicChecklistItem["source"]) {
  const map: Record<MagicChecklistItem["source"], string> = {
    imported: "from package",
    url: "from URL",
    ai: "AI filled",
    preset: "preset",
    missing: "missing",
  };
  return map[source] || source;
}

/** Advanced StepNav page for each checklist row. */
function advancedHref(campaignId: string, itemId: string): string {
  const map: Record<string, string> = {
    brief: `/campaigns/${campaignId}/brief`,
    workflow: `/campaigns/${campaignId}/settings`,
    talent: `/campaigns/${campaignId}/ingredients`,
    hands: `/campaigns/${campaignId}/ingredients`,
    background: `/campaigns/${campaignId}/ingredients`,
    attire: `/campaigns/${campaignId}/ingredients`,
    prop: `/campaigns/${campaignId}/ingredients`,
    motion: `/campaigns/${campaignId}/ingredients`,
    copy: `/campaigns/${campaignId}/ingredients?kind=copy&from=magic`,
    tokens: `/campaigns/${campaignId}/tokens`,
    connectors: `/campaigns/${campaignId}/settings`,
    variants: `/campaigns/${campaignId}/matrix`,
  };
  return map[itemId] || `/campaigns/${campaignId}/settings`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyChecks(): LiveCheckItem[] {
  return PREPARE_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending" as const,
  }));
}

export function MagicCampaignModal({
  open,
  onClose,
  campaignId: attachCampaignId = null,
  createNew = false,
  defaultName = "Magic campaign",
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Attach Magic to this existing campaign (standard or magic).
   * Used from StepNav / Open Magic / `?magic=`.
   */
  campaignId?: string | null;
  /** Home “Magic campaign” button: always mint a new campaign. */
  createNew?: boolean;
  defaultName?: string;
}) {
  const [phase, setPhase] = useState<Phase>("import");
  const [name, setName] = useState(defaultName);
  const [brief, setBrief] = useState<Brief>({
    prompt: "",
    audience: "",
    offer: "",
    cta: "Learn more",
    mustSay: [],
    mustNot: [],
  });
  const [workflowUrl, setWorkflowUrl] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [prepare, setPrepare] = useState<PrepareResult | null>(null);
  const [liveChecks, setLiveChecks] = useState<LiveCheckItem[]>(emptyChecks);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<{
    downloadUrl: string;
    zipPath: string;
    fileName?: string;
    rowCount?: number;
  } | null>(null);
  const [bootMeta, setBootMeta] = useState<{
    created: boolean;
    promoted: boolean;
  } | null>(null);
  const bootRef = useRef(0);

  const refreshReviews = useCallback(async (id: string) => {
    setReviews(await api.getReviews(id));
  }, []);

  useEffect(() => {
    if (!open) return;
    const boot = ++bootRef.current;
    setImportSession(null);
    setPrepare(null);
    setJobs([]);
    setReviews([]);
    setPkg(null);
    setError(null);
    setBusy("boot");
    setLiveChecks(emptyChecks());
    setBootMeta(null);
    setName(defaultName);

    void (async () => {
      try {
        const opts =
          attachCampaignId && !createNew
            ? { campaignId: attachCampaignId }
            : {
                name: defaultName.trim() || "Magic campaign",
                forceNew: true,
              };
        const { campaign: c, created, promoted } =
          await api.ensureMagicCampaign(opts);
        if (boot !== bootRef.current) return;
        setCampaign(c);
        setBootMeta({ created, promoted: Boolean(promoted) });
        setName(c.name);
        setBrief({
          prompt: c.brief.prompt || "",
          audience: c.brief.audience || "",
          offer: c.brief.offer || "",
          cta: c.brief.cta || "Learn more",
          mustSay: c.brief.mustSay || [],
          mustNot: c.brief.mustNot || [],
        });

        if (c.matrix.cells.length > 0) {
          const [plan, existingJobs, existingReviews] = await Promise.all([
            api.magicPlan(c.id),
            api.jobs(c.id),
            api.getReviews(c.id),
          ]);
          if (boot !== bootRef.current) return;
          setPrepare(plan);
          setCampaign(plan.campaign);
          setJobs(existingJobs);
          setReviews(existingReviews);
          setLiveChecks(
            plan.gapsFilled.map((item) => ({
              id: item.id,
              label: item.label,
              status: item.ok ? "done" : "fail",
              ok: item.ok,
              source: item.source,
              detail: item.detail,
            })),
          );

          const jobsLive = existingJobs.some(
            (j) => j.status === "queued" || j.status === "running",
          );
          const hasAnyJobs = existingJobs.length > 0;
          const hasPlates = plan.campaign.matrix.cells.some((cell) =>
            cell.sizeAssets?.some(
              (a) => a.genPath?.trim() && a.status !== "failed",
            ),
          );
          // Resume generate step when queue is live or generation already ran.
          setPhase(jobsLive || hasAnyJobs || hasPlates ? "run" : "plan");
        } else {
          setPhase("import");
        }
      } catch (e) {
        if (boot !== bootRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("import");
      } finally {
        if (boot === bootRef.current) setBusy(null);
      }
    })();
  }, [open, attachCampaignId, createNew, defaultName]);

  useEffect(() => {
    if (!importSession) return;
    const id = importSession.id;
    const active =
      importSession.status === "staging" ||
      importSession.status === "classifying" ||
      importSession.status === "committing";
    if (!active) return;

    let cancelled = false;
    const tick = () => {
      void api
        .getImportSession(id)
        .then((next) => {
          if (cancelled) return;
          setImportSession(next);
        })
        .catch(() => undefined);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [importSession?.id, importSession?.status]);

  useEffect(() => {
    if (!campaign?.id || phase !== "run") return;
    const campaignId = campaign.id;
    let cancelled = false;

    const tick = async () => {
      try {
        const [nextJobs, nextCampaign] = await Promise.all([
          api.jobs(campaignId),
          api.getCampaign(campaignId),
        ]);
        if (cancelled) return;
        setJobs(nextJobs);
        setCampaign(nextCampaign);
        await refreshReviews(campaignId);
      } catch {
        /* keep last known state */
      }
    };

    void tick();
    const t = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // Depend on id only — full campaign object changes every poll and would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.id, phase, refreshReviews]);

  const classifying =
    importSession?.status === "staging" ||
    importSession?.status === "classifying";
  const importEta = useImportEta(importSession);
  const reviewRows =
    importSession?.status === "review" || importSession?.status === "done"
      ? importSession.rows
      : [];

  if (!open) return null;

  async function ensureCampaign() {
    if (campaign) return campaign;
    const opts =
      attachCampaignId && !createNew
        ? { campaignId: attachCampaignId }
        : { name: name.trim() || "Magic campaign", forceNew: true };
    const { campaign: c, created, promoted } =
      await api.ensureMagicCampaign(opts);
    setCampaign(c);
    setBootMeta({ created, promoted: Boolean(promoted) });
    return c;
  }

  async function onUploadZip(file: File) {
    setBusy("import");
    setError(null);
    setPrepare(null);
    try {
      const c = await ensureCampaign();
      const form = new FormData();
      form.append("zip", file);
      form.append("autoClassify", "1");
      const { session } = await api.startLibraryImport(
        c.libraryId || "default",
        form,
      );
      setImportSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function patchRow(
    rowId: string,
    patch: {
      suggestedKind?: LibraryKind;
      label?: string;
      status?: "accepted" | "rejected";
    },
  ) {
    if (!importSession) return;
    const next = await api.patchImportRows(importSession.id, [
      { id: rowId, ...patch },
    ]);
    setImportSession(next);
  }

  async function onConfirmCategoriesAndPlan() {
    if (!importSession && !brief.prompt.trim()) {
      setError("Add a brief (and optionally an import package)");
      return;
    }
    setError(null);
    setBusy("prepare");
    setPhase("checking");
    setLiveChecks(emptyChecks());
    setPrepare(null);

    const checks = emptyChecks();
    const setCheck = (id: string, patch: Partial<LiveCheckItem>) => {
      const idx = checks.findIndex((c) => c.id === id);
      if (idx >= 0) checks[idx] = { ...checks[idx], ...patch };
      setLiveChecks(checks.map((c) => ({ ...c })));
    };

    try {
      const c = await ensureCampaign();
      let importId = importSession?.id;

      // Progressive: mark brief checking while we commit import + prepare
      setCheck("brief", { status: "checking" });

      if (importSession && importSession.status === "review") {
        const accepted = importSession.rows.map((r) => ({
          id: r.id,
          status: "accepted" as const,
          suggestedKind: r.suggestedKind,
          label: r.label,
        }));
        await api.patchImportRows(importSession.id, accepted);
        await api.commitImport(importSession.id);
        const done = await api.getImportSession(importSession.id);
        setImportSession(done);
        importId = done.id;
      }

      const preparePromise = api.magicPrepare(c.id, {
        brief,
        importId: importId || undefined,
        workflowUrl: workflowUrl.trim() || undefined,
      });

      // Walk checklist while prepare runs so the UI isn't a blank stall
      for (const step of PREPARE_STEPS) {
        setCheck(step.id, { status: "checking" });
        await sleep(280);
      }

      const result = await preparePromise;
      const byId = new Map(result.gapsFilled.map((g) => [g.id, g]));

      for (const step of PREPARE_STEPS) {
        const item = byId.get(step.id);
        if (item) {
          setCheck(step.id, {
            status: item.ok ? "done" : "fail",
            ok: item.ok,
            source: item.source,
            detail: item.detail,
            label: item.label,
          });
        } else {
          setCheck(step.id, {
            status: "done",
            ok: true,
            detail: "Checked",
          });
        }
        await sleep(90);
      }

      setPrepare(result);
      setCampaign(result.campaign);
      await sleep(350);

      if (result.canContinue) {
        setPhase("plan");
      } else {
        setError(result.reasons.join(" · ") || "Cannot continue yet");
        setPhase("checking");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLiveChecks((prev) =>
        prev.map((c) =>
          c.status === "checking" || c.status === "pending"
            ? { ...c, status: "fail", detail: "Prepare failed" }
            : c,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    if (!campaign) return;
    setBusy("generate");
    setError(null);
    setPkg(null);
    setJobs([]);
    setPhase("run");
    try {
      const result = await api.magicGenerate(campaign.id);
      setJobs(result.jobs);
      setCampaign(result.campaign);
      await refreshReviews(campaign.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onStopJobs() {
    if (!campaign) return;
    setBusy("stop");
    try {
      await api.cancelCampaignJobs(campaign.id);
      setJobs(await api.jobs(campaign.id));
      setCampaign(await api.getCampaign(campaign.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function setDecision(
    cellId: string,
    decision: "approved" | "rejected",
  ) {
    if (!campaign) return;
    await api.setReview(campaign.id, cellId, {
      decision,
      reasonTags: [],
      notes: "",
    });
    await refreshReviews(campaign.id);
  }

  async function onPackage() {
    if (!campaign) return;
    setBusy("package");
    setError(null);
    setPkg(null);
    try {
      const result = await api.package(campaign.id);
      setPkg(result);
      await triggerApiDownload(result.downloadUrl, result.fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveCampaignName() {
    if (!campaign) return;
    const next = name.trim();
    if (!next || next === campaign.name) return;
    const updated = await api.patchCampaign(campaign.id, { name: next });
    setCampaign(updated);
  }

  const cells = campaign?.matrix?.cells ?? [];
  const running = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const doneJobs = jobs.filter((j) => j.status === "done").length;
  const platesReady = cells.filter((c) =>
    c.sizeAssets?.some((a) => a.genPath?.trim() && a.status !== "failed"),
  ).length;
  const approved = reviews.filter((r) => r.decision === "approved").length;
  const genPct =
    cells.length > 0
      ? Math.round((platesReady / cells.length) * 100)
      : running
        ? Math.round((doneJobs / Math.max(jobs.length, 1)) * 100)
        : 0;

  function jobsForCell(cellId: string) {
    return jobs.filter(
      (j) =>
        j.cellId === cellId ||
        (j.cellId != null && j.cellId.startsWith(`${cellId}:`)),
    );
  }

  const phaseLabel =
    phase === "import"
      ? "1 · Import & categorize"
      : phase === "checking"
        ? "2 · Checking readiness"
        : phase === "plan"
          ? "3 · Variant plan"
          : "4 · Generate & package";

  const checklistForDisplay: LiveCheckItem[] =
    phase === "checking"
      ? liveChecks
      : prepare
        ? prepare.gapsFilled.map((item) => ({
            id: item.id,
            label: item.label,
            status: (item.ok ? "done" : "fail") as CheckStatus,
            ok: item.ok,
            source: item.source,
            detail: item.detail,
          }))
        : liveChecks;

  function statusGlyph(status: CheckStatus) {
    if (status === "checking") return "…";
    if (status === "done") return "✓";
    if (status === "fail") return "!";
    return "○";
  }

  const bootLabel = bootMeta?.created
    ? "New campaign"
    : bootMeta?.promoted
      ? "Magic enabled on this campaign"
      : "This campaign";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-warm-paper shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ember-800">
              Magic flow · {phaseLabel}
            </p>
            <h2 className="mt-1 truncate font-display text-2xl">
              {campaign?.name || name || "Magic campaign"}
            </h2>
            {campaign ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
                <span className="rounded bg-ember-500/15 px-1.5 py-0.5 text-ember-900">
                  {bootLabel}
                </span>
                <span className="font-mono">id {campaign.id}</span>
                <a
                  className="underline"
                  href={`/campaigns/${campaign.id}/brief`}
                >
                  Open Advanced
                </a>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 text-sm text-ink-600 underline"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <pre className="mb-4 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-800">
              {error}
            </pre>
          ) : null}

          {campaign ? (
            <DesignerPublishBanner
              className="mb-4"
              campaignId={campaign.id}
              libraryId={campaign.libraryId}
            />
          ) : null}

          {busy === "boot" ? (
            <p className="text-sm text-ink-600">Opening Magic for this campaign…</p>
          ) : null}

          {phase === "import" && busy !== "boot" ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="text-ink-700">Campaign name</span>
                <div className="mt-1 flex gap-2">
                  <input
                    className="w-full rounded-md border border-ink-200 px-3 py-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void saveCampaignName()}
                  />
                </div>
              </label>
              {bootMeta?.promoted ? (
                <p className="text-xs text-ink-600">
                  This was a standard campaign — Magic is now enabled on it so
                  Advanced and this popup stay on the same id.
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="text-ink-700">Brief (required)</span>
                <textarea
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
                  rows={3}
                  value={brief.prompt}
                  onChange={(e) =>
                    setBrief((b) => ({ ...b, prompt: e.target.value }))
                  }
                  placeholder="What is this campaign selling / saying?"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  Offer
                  <input
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5"
                    value={brief.offer}
                    onChange={(e) =>
                      setBrief((b) => ({ ...b, offer: e.target.value }))
                    }
                  />
                </label>
                <label className="block text-xs">
                  CTA
                  <input
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5"
                    value={brief.cta}
                    onChange={(e) =>
                      setBrief((b) => ({ ...b, cta: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="rounded-xl border border-ink-200 bg-white/80 p-4">
                <h3 className="text-sm font-medium">Import package</h3>
                <p className="mt-1 text-xs text-ink-600">
                  Same as Library import: zip is staged, then each file is
                  classified (talent / hands / …). Fix kinds below, then build
                  the variant plan.
                </p>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="mt-3 block w-full text-xs"
                  disabled={busy !== null || classifying}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUploadZip(f);
                  }}
                />
                {importSession ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-ink-600">
                      Status: {importSession.status}
                      {importSession.message ? ` · ${importSession.message}` : ""}
                    </p>
                    {importEta.active ? (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full bg-ember-500 transition-all duration-500"
                            style={{
                              width: `${Math.max(4, importEta.progressPct)}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-ink-600">{importEta.summary}</p>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <label className="block text-sm">
                <span className="text-ink-700">
                  Workflow URL (optional HTTPS)
                </span>
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 font-mono text-xs"
                  value={workflowUrl}
                  onChange={(e) => setWorkflowUrl(e.target.value)}
                  placeholder="https://…/attatta.workflow.json"
                />
              </label>

              {importSession?.detectedWorkflows?.length ||
              reviewRows.length > 0 ? (
                <div className="rounded-xl border border-ink-200 bg-white p-4">
                  <h3 className="text-sm font-medium">
                    Recognized assets (
                    {(importSession?.detectedWorkflows?.length || 0) +
                      reviewRows.length}
                    )
                  </h3>
                  <p className="mt-1 text-xs text-ink-600">
                    Media plates get ingredient kinds. Valid Comfy/SCOTTY
                    workflow JSON shows as{" "}
                    <span className="font-medium">workflow</span> with a sanity
                    check — not as talent/prop/etc.
                  </p>
                  <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {(importSession?.detectedWorkflows || [])
                      .filter(
                        (w) =>
                          w.kind === "comfy_api" ||
                          w.kind === "comfy_ui" ||
                          w.kind === "attatta" ||
                          w.kind === "url" ||
                          w.kind === "unknown_json",
                      )
                      .map((w) => {
                        const sanity = w.sanity;
                        const tone =
                          sanity?.status === "ok"
                            ? "bg-emerald-100 text-emerald-900"
                            : sanity?.status === "warn"
                              ? "bg-amber-100 text-amber-950"
                              : sanity?.status === "fail"
                                ? "bg-red-100 text-red-900"
                                : "bg-ink-900/5 text-ink-600";
                        return (
                          <li
                            key={`wf-${w.file}`}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 px-2 py-1.5 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono">
                              {w.file}
                            </span>
                            <span className="rounded border border-ink-200 bg-ink-50 px-2 py-0.5 font-medium uppercase tracking-wide text-[10px] text-ink-700">
                              workflow
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                              title={sanity?.issues?.join("\n") || w.detail}
                            >
                              {sanity?.status === "ok"
                                ? "sanity ok"
                                : sanity?.status === "warn"
                                  ? "sanity warn"
                                  : sanity?.status === "fail"
                                    ? "sanity fail"
                                    : w.kind}
                              {sanity?.nodeCount
                                ? ` · ${sanity.nodeCount}n`
                                : ""}
                            </span>
                            <span className="w-28 truncate text-ink-600">
                              {w.label || w.kind}
                            </span>
                          </li>
                        );
                      })}
                    {reviewRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 px-2 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {row.originalName}
                        </span>
                        <select
                          className="rounded border border-ink-200 px-1 py-0.5"
                          value={row.suggestedKind}
                          disabled={importSession?.status === "done"}
                          onChange={(e) =>
                            void patchRow(row.id, {
                              suggestedKind: e.target.value as LibraryKind,
                            })
                          }
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <input
                          className="w-28 rounded border border-ink-200 px-1 py-0.5"
                          value={row.label}
                          disabled={importSession?.status === "done"}
                          onChange={(e) =>
                            void patchRow(row.id, { label: e.target.value })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                  {(importSession?.detectedWorkflows || []).some(
                    (w) => (w.sanity?.issues?.length ?? 0) > 0,
                  ) ? (
                    <details className="mt-2 text-[11px] text-ink-600">
                      <summary className="cursor-pointer">
                        Workflow sanity details
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {(importSession?.detectedWorkflows || [])
                          .filter((w) => w.sanity?.issues?.length)
                          .map((w) => (
                            <li key={`iss-${w.file}`}>
                              <span className="font-mono">{w.file}</span>
                              <ul className="ml-3 list-disc">
                                {w.sanity!.issues.map((iss) => (
                                  <li key={iss}>{iss}</li>
                                ))}
                              </ul>
                            </li>
                          ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {(phase === "checking" || phase === "plan") &&
          checklistForDisplay.length ? (
            <div className="mb-4 space-y-3">
              <div className="rounded-xl border border-ink-200 bg-white p-4">
                <h3 className="text-sm font-medium">
                  {phase === "checking"
                    ? "Checking each item…"
                    : "Readiness checklist"}
                </h3>
                <p className="mt-1 text-xs text-ink-600">
                  Open Advanced to edit any item; use ← Magic on StepNav to
                  return here.
                </p>
                <ul className="mt-3 space-y-2">
                  {checklistForDisplay.map((item) => (
                    <li
                      key={item.id}
                      className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                        item.status === "checking"
                          ? "border-ember-400/40 bg-ember-500/5"
                          : "border-ink-100 bg-ink-50/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 font-mono ${
                          item.status === "checking"
                            ? "animate-pulse text-ember-700"
                            : item.status === "fail"
                              ? "text-red-700"
                              : item.status === "done"
                                ? "text-emerald-700"
                                : "text-ink-400"
                        }`}
                        aria-hidden
                      >
                        {statusGlyph(item.status)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{item.label}</span>
                          {item.source ? (
                            <span className="text-ink-500">
                              ({sourceBadge(item.source)})
                            </span>
                          ) : null}
                          {item.status === "checking" ? (
                            <span className="text-ember-700">checking…</span>
                          ) : null}
                        </div>
                        {item.detail ? (
                          <p className="mt-0.5 text-ink-600">{item.detail}</p>
                        ) : null}
                      </div>
                      {campaign ? (
                        <a
                          className="shrink-0 text-ink-700 underline"
                          href={`${advancedHref(campaign.id, item.id)}?from=magic`}
                        >
                          Edit
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {prepare?.warnings.length ? (
                  <p className="mt-2 text-xs text-amber-800">
                    {prepare.warnings.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === "plan" && prepare ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-ink-200 bg-white p-4 text-sm">
                <p>
                  <strong>{prepare.variants.length}</strong> variants ready to
                  generate
                  {prepare.workflowSource !== "imported" ? (
                    <span className="text-ink-600">
                      {" "}
                      · workflow {sourceBadge(prepare.workflowSource)}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  Sparse matrix from categorized plates. Edit a row in Matrix if
                  needed.
                </p>
                {campaign ? (
                  <a
                    className="mt-2 inline-block text-xs underline"
                    href={`/campaigns/${campaign.id}/matrix?from=magic`}
                  >
                    Open Matrix (Advanced)
                  </a>
                ) : null}
              </div>

              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {prepare.variants.map((v) => (
                  <li
                    key={v.cellId}
                    className="rounded-lg border border-ink-100 bg-white px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{v.label}</span>
                      <span className="font-mono text-ink-500">{v.cellId}</span>
                      <span className="text-ink-500">
                        {v.needsGen ? "Comfy" : "no gen"} · {v.sceneTag || "—"}
                      </span>
                      {campaign ? (
                        <a
                          className="ml-auto underline"
                          href={`/campaigns/${campaign.id}/matrix?from=magic`}
                        >
                          Edit
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-1 text-ink-700">
                      {v.copySetup}
                      {v.copyPunchline ? ` → ${v.copyPunchline}` : ""}
                    </p>
                    {v.fillNotes.length ? (
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
                        {v.fillNotes.join(" · ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {phase === "run" ? (
            <div className="space-y-4">
              <div
                className={`rounded-xl border p-4 text-sm ${
                  running
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : platesReady > 0
                      ? "border-emerald-200 bg-emerald-50/60 text-ink-900"
                      : "border-ink-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {running ? (
                    <span className="attatta-spinner shrink-0" aria-hidden />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {busy === "generate"
                        ? "Queueing Comfy jobs…"
                        : running
                          ? `Generating plates — ${running} job${running === 1 ? "" : "s"} live`
                          : platesReady === cells.length && cells.length > 0
                            ? "All plates ready"
                            : platesReady > 0
                              ? `${platesReady}/${cells.length} plates ready`
                              : jobs.length
                                ? "Waiting for queue…"
                                : "No jobs yet"}
                    </p>
                    <p className="mt-0.5 text-xs opacity-80">
                      {platesReady}/{cells.length || "—"} plates · {doneJobs}{" "}
                      done · {failedJobs} failed · Kept {approved}
                      {approved > 0
                        ? " — package anytime (no Remotion)"
                        : " — Keep plates, then Celtra package"}
                    </p>
                  </div>
                  {running ? (
                    <button
                      type="button"
                      className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      disabled={busy !== null}
                      onClick={() => void onStopJobs()}
                    >
                      {busy === "stop" ? "Stopping…" : "Stop all"}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      running ? "bg-amber-500" : "bg-ember-500"
                    }`}
                    style={{
                      width: `${Math.max(running ? 6 : 0, genPct)}%`,
                    }}
                  />
                </div>
                {campaign ? (
                  <a
                    className="mt-2 inline-block text-xs underline"
                    href={`/campaigns/${campaign.id}/queue?from=magic`}
                  >
                    Open Queue (Advanced)
                  </a>
                ) : null}
              </div>

              {jobs.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
                    Queue
                  </h3>
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {jobs.map((job) => (
                      <JobProgressRow
                        key={job.id}
                        job={job}
                        onCancelled={() => {
                          if (!campaign) return;
                          void api.jobs(campaign.id).then(setJobs);
                          void api.getCampaign(campaign.id).then(setCampaign);
                        }}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
                  Variants
                </h3>
                <ul className="max-h-[22rem] space-y-3 overflow-y-auto">
                  {cells.map((cell) => {
                    const asset =
                      cell.sizeAssets?.find((a) => a.genPath?.trim()) ||
                      cell.sizeAssets?.[0];
                    const cellJobs = jobsForCell(cell.cellId);
                    const activeJob = cellJobs.find(
                      (j) => j.status === "queued" || j.status === "running",
                    );
                    const latestJob = activeJob || cellJobs[0];
                    const jobResult =
                      latestJob?.status === "done"
                        ? latestJob.resultPath?.trim() || null
                        : null;
                    const mediaPath =
                      asset?.genPath?.trim() ||
                      asset?.outputPath?.trim() ||
                      asset?.previewPath?.trim() ||
                      jobResult ||
                      null;
                    const failed = asset?.status === "failed";
                    const rev = reviews.find((r) => r.cellId === cell.cellId);
                    const statusLabel = mediaPath
                      ? "OK · plate ready"
                      : failed
                        ? "failed"
                        : activeJob
                          ? `${activeJob.status}${
                              activeJob.progress > 0.01
                                ? ` ${Math.round(activeJob.progress * 100)}%`
                                : ""
                            }`
                          : latestJob?.status === "done" && !mediaPath
                            ? "done · plate missing — Generate again"
                            : latestJob?.status === "failed"
                              ? "job failed"
                              : busy === "generate"
                                ? "queueing…"
                                : cell.status || "pending";

                    return (
                      <li
                        key={cell.cellId}
                        className={`rounded-xl border p-3 text-xs ${
                          activeJob
                            ? "border-amber-300/60 bg-amber-50/40"
                            : mediaPath
                              ? "border-emerald-200/80 bg-white"
                              : "border-ink-100 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-start gap-3">
                          {mediaPath ? (
                            <VariantMediaPreview
                              key={mediaPath}
                              path={mediaPath}
                              label={cell.cellId}
                            />
                          ) : (
                            <div className="flex aspect-[9/16] h-40 w-[90px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-ink-100 px-1 text-center text-[10px] text-ink-500">
                              {activeJob ? (
                                <>
                                  <span
                                    className="attatta-spinner"
                                    aria-hidden
                                  />
                                  <span>Generating</span>
                                  {activeJob.progress > 0.01 ? (
                                    <span>
                                      {Math.round(activeJob.progress * 100)}%
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-mono font-medium">
                                {cell.cellId}
                              </span>
                              <span
                                className={
                                  mediaPath
                                    ? "text-emerald-700"
                                    : failed || latestJob?.status === "failed"
                                      ? "text-red-700"
                                      : activeJob
                                        ? "text-amber-900"
                                        : "text-ink-500"
                                }
                              >
                                {statusLabel}
                              </span>
                              <span className="text-ink-500">
                                {rev?.decision || "pending"}
                              </span>
                            </div>
                            <p className="text-ink-700">
                              {cell.copy.setup}
                              {cell.copy.punchline
                                ? ` → ${cell.copy.punchline}`
                                : ""}
                            </p>
                            {latestJob?.message ? (
                              <p className="truncate text-[10px] text-ink-500">
                                {latestJob.message}
                              </p>
                            ) : null}
                            {failed && asset?.error ? (
                              <p className="text-[10px] text-red-700">
                                {asset.error}
                              </p>
                            ) : null}
                            {activeJob ? (
                              <div className="h-1 overflow-hidden rounded-full bg-amber-100">
                                <div
                                  className="h-full bg-amber-500 transition-[width] duration-500"
                                  style={{
                                    width: `${Math.max(
                                      6,
                                      Math.round(
                                        (activeJob.progress || 0.05) * 100,
                                      ),
                                    )}%`,
                                  }}
                                />
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                className="rounded border border-ink-200 px-2 py-0.5 disabled:opacity-40"
                                disabled={!mediaPath}
                                onClick={() =>
                                  void setDecision(cell.cellId, "approved")
                                }
                              >
                                Keep
                              </button>
                              <button
                                type="button"
                                className="rounded border border-ink-200 px-2 py-0.5"
                                onClick={() =>
                                  void setDecision(cell.cellId, "rejected")
                                }
                              >
                                Kill
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {pkg ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-950">
                  <p>
                    Celtra zip ready
                    {pkg.rowCount ? ` · ${pkg.rowCount} row(s)` : ""}
                    {pkg.fileName ? (
                      <>
                        {" "}
                        · <span className="font-mono">{pkg.fileName}</span>
                      </>
                    ) : null}
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-md bg-ink-900 px-3 py-1.5 text-sm text-white"
                    onClick={() =>
                      void triggerApiDownload(pkg.downloadUrl, pkg.fileName).catch(
                        (e) =>
                          setError(
                            e instanceof Error ? e.message : String(e),
                          ),
                      )
                    }
                  >
                    Download again
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-200 px-5 py-3">
          {phase === "import" ? (
            <button
              type="button"
              className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
              disabled={
                busy !== null ||
                !brief.prompt.trim() ||
                classifying ||
                (importSession !== null &&
                  importSession.status !== "review" &&
                  importSession.status !== "done")
              }
              onClick={() => void onConfirmCategoriesAndPlan()}
            >
              Confirm categories & prepare checklist
            </button>
          ) : null}
          {phase === "checking" ? (
            <span className="text-xs text-ink-600">
              {busy === "prepare"
                ? "Preparing checklist…"
                : "Checklist incomplete — edit Advanced or go back"}
            </span>
          ) : null}
          {phase === "checking" && busy === null ? (
            <button
              type="button"
              className="rounded-md border border-ink-200 px-3 py-2 text-sm"
              onClick={() => setPhase("import")}
            >
              ← Back
            </button>
          ) : null}
          {phase === "plan" ? (
            <>
              <button
                type="button"
                className="rounded-md border border-ink-200 px-3 py-2 text-sm"
                onClick={() => setPhase("import")}
              >
                ← Back
              </button>
              <button
                type="button"
                className="rounded-md border border-ink-200 px-3 py-2 text-sm"
                disabled={busy !== null}
                onClick={() => void onConfirmCategoriesAndPlan()}
              >
                Re-check
              </button>
              <button
                type="button"
                className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={busy !== null || !prepare?.variants.length}
                onClick={() => void onGenerate()}
              >
                {busy === "generate" ? "Generating…" : "Generate"}
              </button>
            </>
          ) : null}
          {phase === "run" ? (
            <>
              <button
                type="button"
                className="rounded-md border border-ink-200 px-3 py-2 text-sm"
                onClick={() => setPhase("plan")}
              >
                ← Plan
              </button>
              <button
                type="button"
                className="rounded-md bg-ember-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                disabled={busy !== null || approved < 1}
                onClick={() => void onPackage()}
                title="Zip kept plates for Celtra — Remotion assemble not required"
              >
                {busy === "package"
                  ? "Packaging…"
                  : `Celtra package${approved ? ` (${approved})` : ""}`}
              </button>
            </>
          ) : null}
          {busy === "import" || classifying ? (
            <span className="text-xs text-ink-600">
              {importEta.active
                ? importEta.summary
                : classifying
                  ? "Classifying assets…"
                  : "Importing…"}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
