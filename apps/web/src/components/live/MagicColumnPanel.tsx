"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Campaign,
  ImportSession,
  LibraryItem,
  MagicChecklistItem,
  MagicVariantPlanRow,
  OutputSize,
} from "@attatta/shared";
import { isRecentLibraryItem } from "@attatta/shared";
import { api } from "@/lib/api";
import { LiveMagicSizeCoverage } from "@/components/live/LiveMagicSizeCoverage";
import { LiveThumb, cellMediaPath } from "@/components/live/LiveThumb";
import { cellComboLabel } from "@/components/live/liveMatrixUtils";

type MagicPlan = {
  gapsFilled: MagicChecklistItem[];
  variants: MagicVariantPlanRow[];
  canContinue: boolean;
  reasons: string[];
  warnings: string[];
  workflowSource: string;
};

type Props = {
  campaignId: string;
  campaign: Campaign | null;
  briefDraft: string;
  onBriefChange: (v: string) => void;
  busy: string | null;
  onPrepare: () => Promise<void>;
  /** Called after import commit so parent can refresh campaign. */
  onImported?: () => Promise<void>;
  /** Surfaced when prepare readiness / import review changes (for chat offers). */
  onReadinessChange?: (state: {
    ready: boolean;
    variantCount: number;
    detail: string;
    importReview: boolean;
    importId: string | null;
  }) => void;
  /** Bump when jobs/matrix change so size coverage refreshes. */
  coverageToken?: number;
};

export function MagicColumnPanel({
  campaignId,
  campaign,
  briefDraft,
  onBriefChange,
  busy,
  onPrepare,
  onImported,
  onReadinessChange,
  coverageToken = 0,
}: Props) {
  const [plan, setPlan] = useState<MagicPlan | null>(null);
  const [ingredients, setIngredients] = useState<LibraryItem[]>([]);
  const [recentOnly, setRecentOnly] = useState(false);
  const [importSession, setImportSession] = useState<ImportSession | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [sizeCatalog, setSizeCatalog] = useState<OutputSize[]>([]);
  const [sizeBusy, setSizeBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPlanAndIngredients = useCallback(async () => {
    const [p, ingRes] = await Promise.all([
      api.magicPlan(campaignId).catch(() => null),
      api.campaignIngredients(campaignId).catch(() => null),
    ]);
    if (p) {
      setPlan({
        gapsFilled: p.gapsFilled,
        variants: p.variants,
        canContinue: p.canContinue,
        reasons: p.reasons,
        warnings: p.warnings,
        workflowSource: p.workflowSource,
      });
    }
    setIngredients(ingRes?.items ?? []);
  }, [campaignId]);

  useEffect(() => {
    void loadPlanAndIngredients().catch((e) =>
      setLocalError(e instanceof Error ? e.message : String(e)),
    );
  }, [loadPlanAndIngredients]);

  useEffect(() => {
    void api
      .outputSizes()
      .then(setSizeCatalog)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!onReadinessChange) return;
    const variantCount =
      plan?.variants.length ?? campaign?.matrix.cells.length ?? 0;
    const ready = Boolean(plan?.canContinue && variantCount > 0);
    const blocked = plan && !plan.canContinue
      ? plan.reasons[0] || "Checks incomplete"
      : "";
    onReadinessChange({
      ready,
      variantCount,
      detail: ready
        ? `${variantCount} variant(s) ready to generate`
        : blocked || "Run prepare until the checklist is green",
      importReview: importSession?.status === "review",
      importId: importSession?.status === "review" ? importSession.id : null,
    });
  }, [
    plan?.canContinue,
    plan?.variants.length,
    plan?.reasons,
    campaign?.matrix.cells.length,
    importSession?.status,
    importSession?.id,
    onReadinessChange,
  ]);

  useEffect(() => {
    if (!importSession) return;
    const active =
      importSession.status === "staging" ||
      importSession.status === "classifying" ||
      importSession.status === "committing";
    if (!active) return;
    let cancelled = false;
    const t = window.setInterval(() => {
      void api
        .getImportSession(importSession.id)
        .then((next) => {
          if (!cancelled) setImportSession(next);
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [importSession?.id, importSession?.status]);

  async function onZipSelected(file: File) {
    if (!campaign) return;
    setImportBusy(true);
    setLocalError(null);
    try {
      const form = new FormData();
      form.append("zip", file);
      form.append("autoClassify", "1");
      const { session } = await api.startLibraryImport(
        campaign.libraryId || "default",
        form,
      );
      setImportSession(session);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function confirmImportAndPrepare() {
    if (!campaign) return;
    setImportBusy(true);
    setLocalError(null);
    try {
      let importId = importSession?.id;
      if (importSession && importSession.status === "review") {
        const accepted = importSession.rows.map((r) => ({
          id: r.id,
          status: "accepted" as const,
        }));
        await api.patchImportRows(importSession.id, accepted);
        await api.commitImport(importSession.id);
        const done = await api.getImportSession(importSession.id);
        setImportSession(done);
        importId = done.id;
      }
      const result = await api.magicPrepare(campaignId, {
        brief: {
          ...campaign.brief,
          prompt: briefDraft.trim() || campaign.brief.prompt || "New offer",
        },
        importId,
      });
      setPlan({
        gapsFilled: result.gapsFilled,
        variants: result.variants,
        canContinue: result.canContinue,
        reasons: result.reasons,
        warnings: result.warnings,
        workflowSource: result.workflowSource,
      });
      await onImported?.();
      await loadPlanAndIngredients();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  async function handlePrepare() {
    await onPrepare();
    await loadPlanAndIngredients();
  }

  async function toggleOutputSize(sizeId: string) {
    if (!campaign || sizeBusy) return;
    const current = (campaign.outputSizes || []).map((s) => s.id);
    const next = current.includes(sizeId)
      ? current.filter((id) => id !== sizeId)
      : [...current, sizeId];
    if (!next.length) {
      setLocalError("Keep at least one delivery size active");
      return;
    }
    setSizeBusy(true);
    setLocalError(null);
    try {
      await api.putCampaignSizes(campaignId, { sizeIds: next });
      await onImported?.();
      await loadPlanAndIngredients();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSizeBusy(false);
    }
  }

  const activeIds = new Set(campaign?.ingredientSet?.activeIds ?? []);
  const activeSizeIds = new Set(
    (campaign?.outputSizes || []).map((s) => s.id),
  );
  const sizeChoices =
    sizeCatalog.length > 0
      ? sizeCatalog
      : campaign?.outputSizes || [];
  // Match Advanced Ingredients: only campaign activeIds (not "active" legacy-all).
  const activeIngredients = ingredients.filter((i) => activeIds.has(i.id));
  const listedIngredients = recentOnly
    ? activeIngredients.filter((i) => isRecentLibraryItem(i))
    : activeIngredients;
  const byKind = listedIngredients.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] || 0) + 1;
    return acc;
  }, {});

  const reviewRows =
    importSession?.status === "review" || importSession?.status === "done"
      ? importSession.rows
      : [];
  const workflows = importSession?.detectedWorkflows ?? [];

  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      {localError ? (
        <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-800">
          {localError}
        </pre>
      ) : null}

      <label className="block">
        <span className="text-ink-600">Brief</span>
        <textarea
          className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-xs"
          rows={2}
          value={briefDraft}
          onChange={(e) => onBriefChange(e.target.value)}
        />
      </label>

      <div className="rounded-lg border border-ink-100 bg-white/70 p-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-ink-800">Delivery sizes</span>
          <span className="text-[10px] text-ink-500">
            Defaults from Settings — uncheck to skip for this campaign
          </span>
        </div>
        <ul className="mt-2 space-y-1">
          {sizeChoices.map((s) => {
            const on = activeSizeIds.has(s.id);
            return (
              <li key={s.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded border border-ink-100 px-2 py-1.5 hover:bg-ink-50/80">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={on}
                    disabled={sizeBusy || busy !== null || importBusy}
                    onChange={() => void toggleOutputSize(s.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-ink-900">
                      {s.aspect}
                      <span className="ml-1 font-normal text-ink-600">
                        {s.label}
                      </span>
                    </span>
                    <span className="block text-[10px] text-ink-500">
                      {s.width}×{s.height}
                      {s.placements ? ` · ${s.placements}` : ""}
                      {s.recommended ? " · Meta recommended" : ""}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {!activeSizeIds.size ? (
          <p className="mt-1 text-[10px] text-amber-900">
            No sizes active — pick at least one before prepare / generate.
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-ink-500">
            Generate fills missing plates for every active size (not only
            primary).
          </p>
        )}
      </div>

      <div className="rounded-lg border border-ink-100 bg-white/70 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-800">Import package</span>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onZipSelected(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-0.5 disabled:opacity-40"
            disabled={importBusy || busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            {importBusy ? "Uploading…" : "Upload zip"}
          </button>
          {importSession ? (
            <span className="text-[10px] text-ink-500">
              {importSession.status}
              {importSession.message ? ` · ${importSession.message}` : ""}
            </span>
          ) : null}
        </div>
        {workflows.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-[10px] text-ink-600">
            {workflows.slice(0, 4).map((w) => (
              <li key={w.file}>
                <span className="font-mono">{w.file}</span>
                <span> · workflow · {w.sanity?.status || w.kind}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {reviewRows.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-[10px]">
            {reviewRows.slice(0, 20).map((r) => (
              <li key={r.id} className="flex gap-2 truncate">
                <span className="font-mono text-ink-500">{r.suggestedKind}</span>
                <span className="truncate">{r.label || r.originalName}</span>
              </li>
            ))}
            {reviewRows.length > 20 ? (
              <li className="text-ink-500">+{reviewRows.length - 20} more</li>
            ) : null}
          </ul>
        ) : null}
        {importSession?.status === "review" ? (
          <button
            type="button"
            className="mt-2 rounded bg-ink-900 px-2 py-1 text-white disabled:opacity-40"
            disabled={importBusy || busy !== null}
            onClick={() => void confirmImportAndPrepare()}
          >
            Confirm import & prepare
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-ink-900 px-2 py-1 text-white disabled:opacity-40"
          disabled={busy !== null || importBusy}
          onClick={() => void handlePrepare()}
        >
          {busy === "prepare" ? "Preparing…" : "Re-check / prepare"}
        </button>
        <p className="self-center text-[10px] text-ink-500">
          Next steps appear as chat suggestions when ready.
        </p>
      </div>

      <div>
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Readiness checklist
        </h3>
        {!plan?.gapsFilled?.length ? (
          <p className="mt-1 text-[10px] text-ink-500">
            Run prepare to fill checklist (brief, workflow, talent, plates…).
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {plan.gapsFilled.map((item) => (
              <li
                key={item.id}
                className={`rounded border px-2 py-1 ${
                  item.ok
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-amber-200 bg-amber-50/40"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">
                    {item.ok ? "✓" : "○"} {item.label}
                  </span>
                  <span className="text-[10px] uppercase text-ink-500">
                    {item.source}
                  </span>
                </div>
                {item.detail ? (
                  <p className="mt-0.5 text-[10px] text-ink-600">{item.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {plan && !plan.canContinue && plan.reasons.length ? (
          <p className="mt-1 text-[10px] text-amber-900">
            Blocked: {plan.reasons.join(" · ")}
          </p>
        ) : null}
        {plan?.warnings?.length ? (
          <p className="mt-1 text-[10px] text-ink-500">
            {plan.warnings.slice(0, 2).join(" · ")}
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
            Active ingredients ({listedIngredients.length}
            {recentOnly && activeIngredients.length !== listedIngredients.length
              ? ` / ${activeIngredients.length}`
              : ""}
            )
          </h3>
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
              recentOnly
                ? "bg-ember-500 text-white"
                : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
            }`}
            title="Only plates created/updated in the last 7 days"
            onClick={() => setRecentOnly((v) => !v)}
          >
            Recent
          </button>
        </div>
        {listedIngredients.length === 0 ? (
          <p className="mt-1 text-[10px] text-ink-500">
            {recentOnly
              ? "No recent actives — turn off Recent or publish/upload new plates."
              : "None activated — import a package or activate on Ingredients."}
          </p>
        ) : (
          <>
            <p className="mt-1 text-[10px] text-ink-600">
              {Object.entries(byKind)
                .map(([k, n]) => `${n} ${k}`)
                .join(" · ")}
            </p>
            <ul className="mt-1 space-y-1">
              {listedIngredients.slice(0, 16).map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-2 rounded border border-ink-100 bg-white/60 px-1.5 py-1"
                >
                  <LiveThumb libraryItem={i} label={i.label} emptyHint="…" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-medium text-ink-900">
                      {i.label}
                    </p>
                    <p className="font-mono text-[9px] text-ink-500">{i.kind}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Variant plan ({plan?.variants.length ?? campaign?.matrix.cells.length ?? 0})
          {plan?.workflowSource ? (
            <span className="ml-1 normal-case tracking-normal text-ink-400">
              · workflow {plan.workflowSource}
            </span>
          ) : null}
        </h3>
        {(plan?.variants.length ?? 0) === 0 ? (
          <p className="mt-1 text-[10px] text-ink-500">
            Prepare builds the variant list from activations + brief.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {plan!.variants.slice(0, 12).map((v) => {
              const cell = campaign?.matrix.cells.find(
                (c) => c.cellId === v.cellId,
              );
              const media = cellMediaPath(cell);
              return (
                <li
                  key={v.cellId}
                  className="flex items-center gap-2 rounded border border-ink-100 bg-white px-2 py-1 text-[10px]"
                >
                  <LiveThumb
                    filePath={media}
                    label={v.label || v.cellId}
                    emptyHint={v.needsGen ? "gen" : "—"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-mono text-ink-500">{v.cellId}</span>
                      {v.sceneTag || cell?.sceneTag ? (
                        <span className="ml-1 text-ink-500">
                          · scene {v.sceneTag || cell?.sceneTag}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-ink-800">
                      {cell ? cellComboLabel(cell) : v.label}
                    </p>
                    {v.needsGen ? (
                      <span className="text-amber-800">Needs Comfy plate</span>
                    ) : media ? (
                      <span className="text-emerald-800">Plate ready</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {campaign ? (
        <LiveMagicSizeCoverage
          campaignId={campaignId}
          cells={campaign.matrix.cells}
          sizes={campaign.outputSizes || []}
          refreshToken={coverageToken}
        />
      ) : null}
    </div>
  );
}
