"use client";

import { useCallback, useEffect, useState } from "react";
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

/** import = categorize assets · plan = variants checklist · run = generate/review/package */
type Phase = "import" | "plan" | "run";

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

export function MagicCampaignModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("import");
  const [name, setName] = useState("Magic campaign");
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<{ downloadUrl: string; zipPath: string } | null>(
    null,
  );
  const [showGaps, setShowGaps] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhase("import");
    setCampaign(null);
    setImportSession(null);
    setPrepare(null);
    setJobs([]);
    setReviews([]);
    setPkg(null);
    setError(null);
    setBusy(null);
    setShowGaps(false);
  }, [open]);

  const refreshReviews = useCallback(async (id: string) => {
    setReviews(await api.getReviews(id));
  }, []);

  useEffect(() => {
    if (!importSession) return;
    if (
      importSession.status !== "staging" &&
      importSession.status !== "classifying"
    ) {
      return;
    }
    const t = window.setInterval(() => {
      void api
        .getImportSession(importSession.id)
        .then(setImportSession)
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(t);
  }, [importSession?.id, importSession?.status]);

  useEffect(() => {
    if (!campaign || phase !== "run") return;
    const t = setInterval(() => {
      void api.jobs(campaign.id).then(setJobs);
      void refreshReviews(campaign.id);
      void api.getCampaign(campaign.id).then(setCampaign);
    }, 2500);
    return () => clearInterval(t);
  }, [campaign, phase, refreshReviews]);

  if (!open) return null;

  async function ensureCampaign() {
    if (campaign) return campaign;
    const c = await api.createMagicCampaign(name.trim() || "Magic campaign");
    setCampaign(c);
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
    patch: { suggestedKind?: LibraryKind; label?: string; status?: "accepted" | "rejected" },
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
    setBusy("prepare");
    setError(null);
    try {
      const c = await ensureCampaign();
      let importId = importSession?.id;

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

      const result = await api.magicPrepare(c.id, {
        brief,
        importId: importId || undefined,
        workflowUrl: workflowUrl.trim() || undefined,
      });
      setPrepare(result);
      setCampaign(result.campaign);
      if (result.canContinue) setPhase("plan");
      else setError(result.reasons.join(" · ") || "Cannot continue yet");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    if (!campaign) return;
    setBusy("generate");
    setError(null);
    try {
      setPhase("run");
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

  async function setDecision(cellId: string, decision: "approved" | "rejected") {
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
    try {
      setPkg(await api.package(campaign.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const cells = campaign?.matrix?.cells ?? [];
  const running = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  const approved = reviews.filter((r) => r.decision === "approved").length;
  const classifying =
    importSession?.status === "staging" ||
    importSession?.status === "classifying";
  const reviewRows =
    importSession?.status === "review" || importSession?.status === "done"
      ? importSession.rows
      : [];

  const phaseLabel =
    phase === "import"
      ? "1 · Import & categorize"
      : phase === "plan"
        ? "2 · Variant plan"
        : "3 · Generate & package";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-warm-paper shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 className="font-display text-2xl">Magic campaign</h2>
            <p className="mt-1 text-xs text-ink-700">{phaseLabel}</p>
          </div>
          <button
            type="button"
            className="text-sm text-ink-600 underline"
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

          {phase === "import" ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="text-ink-700">Campaign name</span>
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={Boolean(campaign)}
                />
              </label>
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
                  <p className="mt-2 text-xs text-ink-600">
                    Status: {importSession.status}
                    {importSession.message ? ` · ${importSession.message}` : ""}
                  </p>
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

              {reviewRows.length > 0 ? (
                <div className="rounded-xl border border-ink-200 bg-white p-4">
                  <h3 className="text-sm font-medium">
                    Categorized assets ({reviewRows.length})
                  </h3>
                  <p className="mt-1 text-xs text-ink-600">
                    Adjust kind/label if the classifier missed — then confirm to
                    build variants.
                  </p>
                  <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
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
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "plan" && prepare ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-ink-200 bg-white p-4 text-sm">
                <p>
                  <strong>{prepare.variants.length}</strong> variants will
                  generate from your categorized plates
                  {prepare.workflowSource !== "imported" ? (
                    <span className="text-ink-600">
                      {" "}
                      · workflow {sourceBadge(prepare.workflowSource)}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  This list is the sparse matrix built after import — not the old
                  readiness checklist. Missing copy/workflow were filled from the
                  brief where needed.
                </p>
                {campaign ? (
                  <a
                    className="mt-2 inline-block text-xs underline"
                    href={`/campaigns/${campaign.id}/settings`}
                  >
                    Advanced (full StepNav)
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

              <button
                type="button"
                className="text-xs text-ink-600 underline"
                onClick={() => setShowGaps((g) => !g)}
              >
                {showGaps ? "Hide" : "Show"} what AI/preset filled (gaps)
              </button>
              {showGaps ? (
                <ul className="space-y-1 rounded-lg border border-ink-100 bg-ink-50/50 p-3 text-xs">
                  {prepare.gapsFilled.map((item) => (
                    <li key={item.id}>
                      {item.ok ? "✓" : "○"} {item.label}{" "}
                      <span className="text-ink-500">
                        ({sourceBadge(item.source)})
                      </span>
                      — {item.detail}
                    </li>
                  ))}
                  {prepare.warnings.length ? (
                    <li className="text-amber-800">
                      {prepare.warnings.join(" · ")}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}

          {phase === "run" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-ink-200 bg-white p-4 text-sm">
                <div>
                  Jobs running: <strong>{running}</strong> · Approved:{" "}
                  <strong>{approved}</strong>
                </div>
              </div>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {cells.map((cell) => {
                  const asset = cell.sizeAssets?.find((a) => a.genPath);
                  const rev = reviews.find((r) => r.cellId === cell.cellId);
                  return (
                    <li
                      key={cell.cellId}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 bg-white px-3 py-2 text-xs"
                    >
                      <span className="font-mono">{cell.cellId}</span>
                      <span className="text-ink-500">
                        {asset?.genPath ? "plate ready" : cell.status}
                      </span>
                      <span className="text-ink-500">
                        {rev?.decision || "pending"}
                      </span>
                      <button
                        type="button"
                        className="ml-auto rounded border border-ink-200 px-2 py-0.5"
                        onClick={() => void setDecision(cell.cellId, "approved")}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className="rounded border border-ink-200 px-2 py-0.5"
                        onClick={() => void setDecision(cell.cellId, "rejected")}
                      >
                        Kill
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pkg ? (
                <a
                  className="inline-block rounded-md bg-ink-900 px-3 py-2 text-sm text-white"
                  href={`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787"}${pkg.downloadUrl}`}
                >
                  Download Celtra package
                </a>
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
              {busy === "prepare"
                ? "Building variant plan…"
                : "Confirm categories & build variant plan"}
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
                className="rounded-md border border-ink-300 px-4 py-2 text-sm disabled:opacity-40"
                disabled={busy !== null || approved < 1}
                onClick={() => void onPackage()}
              >
                {busy === "package" ? "Packaging…" : "Celtra package"}
              </button>
            </>
          ) : null}
          {busy === "import" || classifying ? (
            <span className="text-xs text-ink-600">
              {classifying ? "Classifying assets…" : "Importing…"}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
