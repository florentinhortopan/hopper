"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Brief,
  Campaign,
  Job,
  MagicChecklistItem,
  ReviewEntry,
} from "@attatta/shared";
import { api } from "@/lib/api";

type Step = 1 | 2;

type PrepareResult = {
  campaign: Campaign;
  checklist: MagicChecklistItem[];
  canContinue: boolean;
  reasons: string[];
  plannedCells: number;
  workflowSource: MagicChecklistItem["source"];
  warnings: string[];
};

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
  const [step, setStep] = useState<Step>(1);
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
  const [importId, setImportId] = useState<string | null>(null);
  const [prepare, setPrepare] = useState<PrepareResult | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState<{ downloadUrl: string; zipPath: string } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setCampaign(null);
    setImportId(null);
    setPrepare(null);
    setJobs([]);
    setReviews([]);
    setPkg(null);
    setError(null);
    setBusy(null);
  }, [open]);

  const refreshReviews = useCallback(async (id: string) => {
    setReviews(await api.getReviews(id));
  }, []);

  useEffect(() => {
    if (!campaign || step !== 2) return;
    const t = setInterval(() => {
      void api.jobs(campaign.id).then(setJobs);
      void refreshReviews(campaign.id);
      void api.getCampaign(campaign.id).then(setCampaign);
    }, 2500);
    return () => clearInterval(t);
  }, [campaign, step, refreshReviews]);

  if (!open) return null;

  async function ensureCampaign() {
    if (campaign) return campaign;
    const c = await api.createMagicCampaign(name.trim() || "Magic campaign");
    setCampaign(c);
    return c;
  }

  async function waitImportReady(id: string) {
    for (let i = 0; i < 90; i++) {
      const s = await api.getImportSession(id);
      if (s.status === "review" || s.status === "done") return s;
      if (s.status === "failed") {
        throw new Error(s.message || "Import failed");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Import timed out");
  }

  async function onUploadZip(file: File) {
    setBusy("import");
    setError(null);
    try {
      const c = await ensureCampaign();
      const form = new FormData();
      form.append("zip", file);
      form.append("autoClassify", "1");
      const { session } = await api.startLibraryImport(c.libraryId || "default", form);
      setImportId(session.id);
      const ready = await waitImportReady(session.id);
      if (ready.status === "review" && ready.rows.length) {
        await api.patchImportRows(
          session.id,
          ready.rows.map((r) => ({ id: r.id, status: "accepted" as const })),
        );
        await api.commitImport(session.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onPrepare() {
    setBusy("prepare");
    setError(null);
    try {
      const c = await ensureCampaign();
      const result = await api.magicPrepare(c.id, {
        brief,
        importId: importId || undefined,
        workflowUrl: workflowUrl.trim() || undefined,
      });
      setPrepare(result);
      setCampaign(result.campaign);
      if (result.canContinue) setStep(2);
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
            <p className="mt-1 text-xs text-ink-700">
              Step {step} of 2 —{" "}
              {step === 1 ? "Import package + brief" : "Generate & package"}
            </p>
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

          {step === 1 ? (
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
                  Zip of media + optional{" "}
                  <code className="font-mono">attatta.workflow.json</code> or{" "}
                  <code className="font-mono">workflow.url</code>
                </p>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="mt-3 block w-full text-xs"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUploadZip(f);
                  }}
                />
                {importId ? (
                  <p className="mt-2 text-xs text-ink-600">
                    Import ready · <span className="font-mono">{importId}</span>
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

              {prepare ? (
                <ul className="space-y-2 rounded-xl border border-ink-200 bg-white p-4 text-sm">
                  <li className="text-xs uppercase tracking-wide text-ink-500">
                    Readiness · workflow {sourceBadge(prepare.workflowSource)}
                  </li>
                  {prepare.checklist.map((item) => (
                    <li key={item.id} className="flex gap-2">
                      <span>{item.ok ? "✓" : "○"}</span>
                      <span>
                        <span className="font-medium">{item.label}</span>
                        <span className="ml-2 text-[10px] uppercase text-ink-500">
                          {sourceBadge(item.source)}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-600">
                          {item.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                  {prepare.warnings.length ? (
                    <li className="text-xs text-amber-800">
                      {prepare.warnings.join(" · ")}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-ink-200 bg-white p-4 text-sm">
                <div>
                  Planned variants:{" "}
                  <strong>{prepare?.plannedCells ?? cells.length}</strong>
                </div>
                <div className="mt-1 text-xs text-ink-600">
                  Workflow: {prepare ? sourceBadge(prepare.workflowSource) : "—"}{" "}
                  · Jobs running: {running}
                </div>
                {campaign ? (
                  <a
                    className="mt-2 inline-block text-xs underline"
                    href={`/campaigns/${campaign.id}/settings`}
                  >
                    Advanced (full StepNav)
                  </a>
                ) : null}
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
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-ink-200 px-5 py-3">
          {step === 1 ? (
            <>
              <button
                type="button"
                className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={busy !== null || !brief.prompt.trim()}
                onClick={() => void onPrepare()}
              >
                {busy === "prepare" ? "Preparing…" : "Prepare checklist"}
              </button>
              {prepare?.canContinue ? (
                <button
                  type="button"
                  className="rounded-md border border-ink-300 px-4 py-2 text-sm"
                  onClick={() => setStep(2)}
                >
                  Continue to generate →
                </button>
              ) : prepare && !prepare.canContinue ? (
                <span className="text-xs text-amber-800">
                  {prepare.reasons.join(" · ")}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className="rounded-md border border-ink-200 px-3 py-2 text-sm"
                onClick={() => setStep(1)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={busy !== null}
                onClick={() => void onGenerate()}
              >
                {busy === "generate" ? "Generating…" : "Confirm & generate"}
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
          )}
          {busy === "import" ? (
            <span className="text-xs text-ink-600">Importing…</span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
