"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  estimatePlateGenSeconds,
  isPlateReady,
  type Campaign,
  type CampaignIngredientSet,
  type LibraryItem,
  type LibraryKind,
  type TalentContract,
} from "@attatta/shared";
import {
  PlateCard,
  type PlateDensity,
  type PlateGenProgress,
  type PlateOutputMode,
} from "@/components/PlateCard";
import { StepNav } from "@/components/StepNav";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { DesignerPublishBanner } from "@/components/DesignerPublishBanner";
import { api } from "@/lib/api";

type Row = LibraryItem & { active: boolean; hidden?: boolean };

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

const VIEW_KEY = "attatta.ingredientPlates.view";

function readStoredView(): PlateDensity {
  if (typeof window === "undefined") return "small";
  const v = window.localStorage.getItem(VIEW_KEY);
  if (v === "row" || v === "small" || v === "big") return v;
  return "small";
}

function layoutClass(density: PlateDensity): string {
  if (density === "row") return "mt-5 flex flex-col gap-2";
  if (density === "small") {
    return "mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
  }
  return "mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3";
}

export default function CampaignIngredientsPage() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [set, setSet] = useState<CampaignIngredientSet | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contract, setContract] = useState<TalentContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<LibraryKind | "all">("all");
  const [showContract, setShowContract] = useState(false);
  const [view, setView] = useState<PlateDensity>("small");
  const [outputMode, setOutputMode] = useState<PlateOutputMode>("video");
  const [mediaRev, setMediaRev] = useState<Record<string, number>>({});
  const [genById, setGenById] = useState<Record<string, PlateGenProgress & { jobId: string }>>(
    {},
  );
  const [fromMagic, setFromMagic] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [copyDraft, setCopyDraft] = useState({
    label: "",
    setup: "",
    punchline: "",
    endcard: "",
    cta: "Learn more",
  });
  const [addingCopy, setAddingCopy] = useState(false);
  const genByIdRef = useRef(genById);
  const rowsRef = useRef<Row[]>([]);

  function bumpMedia(itemId: string) {
    setMediaRev((prev) => ({ ...prev, [itemId]: Date.now() }));
  }

  useEffect(() => {
    setView(readStoredView());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("kind");
    if (kind && (KINDS as string[]).includes(kind)) {
      setFilter(kind as LibraryKind);
    }
    setFromMagic(params.get("from") === "magic");
  }, []);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    genByIdRef.current = genById;
  }, [genById]);

  const generatingIds = useMemo(
    () =>
      rows
        .filter((r) => r.status === "generating" || genById[r.id])
        .map((r) => r.id)
        .join(","),
    [rows, genById],
  );

  useEffect(() => {
    if (!generatingIds) return;
    const t = window.setInterval(() => {
      void (async () => {
        try {
          const data = await api.campaignIngredients(id, {
            includeArchived: showArchived,
          });
          setRows(data.items);
          setSet(data.ingredientSet);
        } catch {
          /* ignore transient */
        }
        const snapshot = genByIdRef.current;
        const next = { ...snapshot };
        let changed = false;
        for (const [itemId, g] of Object.entries(snapshot)) {
          try {
            const job = await api.getJob(g.jobId);
            next[itemId] = {
              ...g,
              progress: job.progress,
              message: job.message,
            };
            changed = true;
            if (
              job.status === "done" ||
              job.status === "failed" ||
              job.status === "cancelled"
            ) {
              delete next[itemId];
              bumpMedia(itemId);
            }
          } catch {
            /* keep estimate */
          }
        }
        if (changed) setGenById(next);
      })();
    }, 2500);
    return () => window.clearInterval(t);
  }, [generatingIds, id, showArchived]);

  function changeView(next: PlateDensity) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  async function refresh(includeArchived = showArchived) {
    try {
      const [data, camp] = await Promise.all([
        api.campaignIngredients(id, { includeArchived }),
        api.getCampaign(id),
      ]);
      setRows(data.items);
      setSet(data.ingredientSet);
      setContract(data.contract);
      setCampaign(camp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh(showArchived);
  }, [id, showArchived]);

  async function softRemove(item: Row) {
    if (!set) return;
    const hidden = new Set(set.hiddenIds ?? []);
    const restoring = hidden.has(item.id) || Boolean(item.hidden);
    if (!restoring) {
      if (
        !confirm(
          "Remove this plate from this campaign only? It stays in the library and other campaigns.",
        )
      )
        return;
      hidden.add(item.id);
    } else {
      hidden.delete(item.id);
    }
    const nextHidden = [...hidden];
    const activeIds = rows
      .filter((r) => r.active && r.id !== item.id)
      .map((r) => r.id)
      .filter((id) => !hidden.has(id));
    // When restoring, leave activation off until the operator opts in again
    setBusyId(item.id);
    try {
      const camp = await api.putCampaignIngredients(id, {
        ...set,
        activeIds,
        hiddenIds: nextHidden,
        requireReadyMedia: set.requireReadyMedia,
      });
      if (camp.ingredientSet) setSet(camp.ingredientSet);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  // Deep link from Matrix plate thumbs: /ingredients#plate-<id>
  useEffect(() => {
    if (!rows.length) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const m = /^#plate-(.+)$/.exec(hash);
    if (!m) return;
    const el = document.getElementById(`plate-${m[1]}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-ember-500", "ring-offset-2");
    const t = window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-ember-500", "ring-offset-2");
    }, 2200);
    return () => window.clearTimeout(t);
  }, [rows, id]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.kind === filter)),
    [rows, filter],
  );

  const activeRows = useMemo(() => rows.filter((r) => r.active), [rows]);
  const readyActive = useMemo(
    () => activeRows.filter((r) => isPlateReady(r)).length,
    [activeRows],
  );
  const readyPct = activeRows.length
    ? Math.round((readyActive / activeRows.length) * 100)
    : 0;

  function toggle(itemId: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === itemId ? { ...r, active: !r.active } : r)),
    );
  }

  /** Talent + active/pinned secondaries (BG/attire/prop). Hands/motion only if already pinned. */
  function activateMinimalKit() {
    const pick = (kind: LibraryKind, preferId?: string | null) => {
      if (preferId) {
        const hit = rows.find((r) => r.id === preferId && r.kind === kind);
        if (hit) return hit.id;
      }
      const ready = rows.find((r) => r.kind === kind && isPlateReady(r));
      if (ready) return ready.id;
      return rows.find((r) => r.kind === kind)?.id ?? null;
    };
    const talentId =
      pick("talent", set?.contractTalentId) ||
      pick("talent", campaign?.rail?.hero?.talentTakeId);
    // Optional — keep only if rail already pins them (don't force a product kit)
    const handsId = campaign?.rail?.hero?.handsId
      ? pick("hands", campaign.rail.hero.handsId)
      : null;
    const motionId = campaign?.rail?.hero?.motionToken
      ? pick("motion", campaign.rail.hero.motionToken)
      : null;
    const keep = new Set(
      rows
        .filter(
          (r) =>
            r.active &&
            (r.kind === "background" ||
              r.kind === "attire" ||
              r.kind === "prop" ||
              r.kind === "theme" ||
              r.kind === "copy" ||
              r.kind === "talent"),
        )
        .map((r) => r.id),
    );
    // Also keep rail-pinned secondaries even if currently inactive
    for (const id of [
      campaign?.rail?.hero?.backgroundId,
      campaign?.rail?.hero?.attireId,
      ...(campaign?.rail?.hero?.propIds ?? []),
      ...(campaign?.rail?.allowedBackgroundIds ?? []),
      ...(campaign?.rail?.allowedAttireIds ?? []),
      ...(campaign?.rail?.allowedPropIds ?? []),
    ]) {
      if (id) keep.add(id);
    }
    // Prefer all backgrounds when none pinned yet (BG-only campaigns)
    if (![...keep].some((id) => rows.find((r) => r.id === id)?.kind === "background")) {
      for (const r of rows.filter((x) => x.kind === "background")) keep.add(r.id);
    }
    setRows((prev) =>
      prev.map((r) => {
        const essential =
          r.id === talentId || r.id === handsId || r.id === motionId || keep.has(r.id);
        return { ...r, active: essential };
      }),
    );
    if (set && talentId) {
      setSet({ ...set, contractTalentId: talentId });
    }
  }

  async function save() {
    if (!set) return;
    setSaving(true);
    try {
      const activeIds = rows
        .filter((r) => r.active && !r.hidden)
        .map((r) => r.id);
      const camp = await api.putCampaignIngredients(id, {
        ...set,
        activeIds,
        hiddenIds: set.hiddenIds ?? [],
        requireReadyMedia: set.requireReadyMedia,
      });
      if (camp.ingredientSet) setSet(camp.ingredientSet);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addCopyPlate() {
    if (!campaign || !set) return;
    const label = copyDraft.label.trim() || copyDraft.setup.trim() || "Campaign copy";
    if (!copyDraft.setup.trim() && !copyDraft.punchline.trim()) {
      setError("Add at least a setup or punchline for the copy plate");
      return;
    }
    setAddingCopy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("libraryId", campaign.libraryId || "default");
      form.set("kind", "copy");
      form.set("label", label);
      form.set("tags", "magic,operator");
      form.set("promptHint", copyDraft.setup || label);
      form.set(
        "copy",
        JSON.stringify({
          setup: copyDraft.setup || label,
          punchline: copyDraft.punchline,
          endcard: copyDraft.endcard,
          cta: copyDraft.cta || "Learn more",
        }),
      );
      const item = await api.createLibraryItem(form);
      const nextActive = [
        ...new Set([
          ...rows.filter((r) => r.active && !r.hidden).map((r) => r.id),
          item.id,
        ]),
      ];
      const nextHidden = (set.hiddenIds ?? []).filter((hid) => hid !== item.id);
      const camp = await api.putCampaignIngredients(id, {
        ...set,
        activeIds: nextActive,
        hiddenIds: nextHidden,
        requireReadyMedia: set.requireReadyMedia,
      });
      if (camp.ingredientSet) setSet(camp.ingredientSet);
      setCopyDraft({
        label: "",
        setup: "",
        punchline: "",
        endcard: "",
        cta: "Learn more",
      });
      setFilter("copy");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingCopy(false);
    }
  }

  function resolveSourceTalentId(itemId: string): string | null {
    const item = rows.find((r) => r.id === itemId);
    const fromContract = set?.contractTalentId;
    const fromHero = campaign?.rail?.hero?.talentTakeId;
    const fromItem = item?.sourceTalentId;
    const fromActive = activeRows.find((r) => r.kind === "talent")?.id;
    return fromContract || fromHero || fromItem || fromActive || null;
  }

  function draftHints(
    itemId: string,
    next: {
      promptHint: string;
      negativeHint: string;
      tags: string[];
      copy?: {
        setup: string;
        punchline: string;
        endcard: string;
        cta: string;
      };
    },
  ) {
    setRows((prev) => {
      const updated = prev.map((r) =>
        r.id === itemId
          ? {
              ...r,
              promptHint: next.promptHint,
              negativeHint: next.negativeHint,
              tags: next.tags,
              ...(next.copy ? { copy: next.copy } : {}),
            }
          : r,
      );
      rowsRef.current = updated;
      return updated;
    });
  }

  async function saveHints(
    itemId: string,
    next: {
      promptHint: string;
      negativeHint: string;
      tags: string[];
      copy?: {
        setup: string;
        punchline: string;
        endcard: string;
        cta: string;
      };
    },
  ) {
    draftHints(itemId, next);
    if (next.copy) {
      setRows((prev) => {
        const updated = prev.map((r) =>
          r.id === itemId ? { ...r, copy: next.copy, promptHint: next.promptHint } : r,
        );
        rowsRef.current = updated;
        return updated;
      });
    }
    await api.patchLibraryItem(itemId, {
      promptHint: next.promptHint,
      negativeHint: next.negativeHint,
      tags: next.tags,
      ...(next.copy ? { copy: next.copy } : {}),
    });
  }

  async function changeKind(itemId: string, nextKind: LibraryKind) {
    setBusyId(itemId);
    setError(null);
    const prev = rowsRef.current.find((r) => r.id === itemId);
    if (prev) {
      setRows((rows) =>
        rows.map((r) => (r.id === itemId ? { ...r, kind: nextKind } : r)),
      );
    }
    try {
      const updated = await api.patchLibraryItem(itemId, { kind: nextKind });
      if (updated.kind !== nextKind) {
        throw new Error(
          `Recategorize failed: still ${updated.kind} on server (wanted ${nextKind})`,
        );
      }
      await refresh();
      if (filter !== "all" && filter !== nextKind) setFilter(nextKind);
    } catch (e) {
      if (prev) {
        setRows((rows) =>
          rows.map((r) => (r.id === itemId ? prev : r)),
        );
      }
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusyId(null);
    }
  }

  async function generate(itemId: string, mode: PlateOutputMode) {
    setBusyId(itemId);
    setRows((prev) =>
      prev.map((r) =>
        r.id === itemId ? { ...r, status: "generating" as const } : r,
      ),
    );
    try {
      // Ensure latest local prompt is on disk before Comfy reads the ingredient
      const row = rowsRef.current.find((r) => r.id === itemId);
      if (row) {
        await api.patchLibraryItem(itemId, {
          promptHint: row.promptHint || "",
          negativeHint: row.negativeHint || "",
        });
      }
      const res = await api.generateLibraryItem(itemId, {
        campaignId: id,
        modelProfileId: campaign?.modelProfileId,
        sourceTalentId: resolveSourceTalentId(itemId),
        outputMode: mode,
      });
      setGenById((prev) => ({
        ...prev,
        [itemId]: {
          jobId: res.job.id,
          startedAt: Date.now(),
          outputMode: res.outputMode,
          etaSeconds:
            res.etaSeconds ||
            estimatePlateGenSeconds(res.item.kind, res.outputMode),
          progress: res.job.progress,
          message: res.job.message,
        },
      }));
      setRows((prev) =>
        prev.map((r) =>
          r.id === itemId ? { ...r, ...res.item, active: r.active } : r,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function upload(itemId: string, file: File) {
    setBusyId(itemId);
    try {
      await api.uploadLibraryMedia(itemId, file);
      bumpMedia(itemId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!set || !contract) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-56 rounded bg-warm-line" />
        <div className="h-24 rounded-2xl bg-warm-line/60" />
      </div>
    );
  }

  return (
    <div>
      <StepNav campaignId={id} current="ingredients" />

      <DesignerPublishBanner
        className="mb-4"
        campaignId={id}
        libraryId={campaign?.libraryId}
        onPublish={() => void refresh()}
      />

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-ink-900">
            Ingredient plates
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-700">
            Activate what this batch may use. <strong>2+ of a visual kind</strong> fans that
            axis on Matrix. Copy plates append messaging at Remotion assemble (not Comfy).
            Hands / motion optional. Then{" "}
            <a className="underline" href={`/campaigns/${id}/matrix`}>
              Build from activations
            </a>
            .
          </p>
          {campaign?.libraryId ? (
            <p className="mt-2 text-xs text-ink-600">
              Library pack{" "}
              <span className="font-mono text-ink-800">{campaign.libraryId}</span>
              {" · "}
              <a className="underline" href={`/campaigns/${id}/settings`}>
                Change in settings
              </a>
            </p>
          ) : null}
        </div>
        <a
          href="/library"
          className="text-xs font-medium uppercase tracking-[0.12em] text-ink-700 no-underline hover:text-ember-500"
        >
          Open library →
        </a>
      </header>

      {fromMagic ? (
        <div className="mt-4 rounded-xl border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ember-950">
          Editing from Magic — add or activate plates here,{" "}
          <strong>Save activation</strong>, then return via{" "}
          <a
            className="font-medium underline"
            href={`/?magic=${encodeURIComponent(id)}`}
          >
            ← Magic flow
          </a>{" "}
          and Re-check.
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {filter === "copy" ? (
        <section className="mt-6 rounded-2xl border border-warm-line bg-warm-paper p-5 shadow-surface">
          <h2 className="font-display text-xl text-ink-900">Add copy plate</h2>
          <p className="mt-1 text-xs text-ink-600">
            Creates a messaging plate, activates it for this campaign, then Save
            (already activated). Return to Magic and Re-check to refresh the
            checklist.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              Label
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5"
                value={copyDraft.label}
                onChange={(e) =>
                  setCopyDraft((d) => ({ ...d, label: e.target.value }))
                }
                placeholder="Offer A"
              />
            </label>
            <label className="block text-xs">
              CTA
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5"
                value={copyDraft.cta}
                onChange={(e) =>
                  setCopyDraft((d) => ({ ...d, cta: e.target.value }))
                }
              />
            </label>
            <label className="block text-xs sm:col-span-2">
              Setup
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5"
                value={copyDraft.setup}
                onChange={(e) =>
                  setCopyDraft((d) => ({ ...d, setup: e.target.value }))
                }
                placeholder="Opening line"
              />
            </label>
            <label className="block text-xs sm:col-span-2">
              Punchline
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5"
                value={copyDraft.punchline}
                onChange={(e) =>
                  setCopyDraft((d) => ({ ...d, punchline: e.target.value }))
                }
              />
            </label>
            <label className="block text-xs sm:col-span-2">
              End card
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5"
                value={copyDraft.endcard}
                onChange={(e) =>
                  setCopyDraft((d) => ({ ...d, endcard: e.target.value }))
                }
              />
            </label>
          </div>
          <button
            type="button"
            disabled={addingCopy}
            onClick={() => void addCopyPlate()}
            className="mt-4 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-warm-paper disabled:opacity-40"
          >
            {addingCopy ? "Adding…" : "Add & activate copy"}
          </button>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-warm-line bg-warm-paper p-5 shadow-surface">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-600">
              Readiness
            </p>
            <p className="mt-1 font-display text-2xl text-ink-900">
              {readyActive}/{activeRows.length || 0} plates ready
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => activateMinimalKit()}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-900"
              title="Talent + backgrounds (and any pinned attire/props). Hands/motion only if already on the rail."
            >
              Activate minimal kit
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-warm-paper disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save activation"}
            </button>
            <a
              href={`/campaigns/${id}/matrix`}
              className="rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-medium text-white no-underline hover:bg-ember-600"
            >
              Continue to Matrix
            </a>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-warm-line">
          <div
            className="h-full rounded-full bg-ember-500 transition-all"
            style={{ width: `${readyPct}%` }}
          />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink-800">
          <input
            type="checkbox"
            checked={set.requireReadyMedia}
            onChange={(e) => setSet({ ...set, requireReadyMedia: e.target.checked })}
          />
          Require ready plates before assemble
        </label>
        <button
          type="button"
          className="mt-3 text-xs text-ink-600 underline"
          onClick={() => setShowContract((v) => !v)}
        >
          {showContract ? "Hide" : "Show"} talent contract
        </button>
        {showContract ? (
          <ul className="mt-3 grid gap-1 text-xs text-ink-700 sm:grid-cols-2">
            <li>Owner: <span className="font-mono">{set.contractTalentId || "—"}</span></li>
            <li>Face locked: {contract.face_locked ? "yes" : "no"}</li>
            <li>Allow attire: {contract.allow_attire ? "yes" : "no"}</li>
            <li>Allow background: {contract.allow_background ? "yes" : "no"}</li>
            <li>Allow props: {contract.allow_props_on_talent ? "yes" : "no"}</li>
            <li>Allow hands: {contract.allow_hands_variants ? "yes" : "no"}</li>
          </ul>
        ) : null}
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.12em] ${
              filter === "all"
                ? "bg-ink-900 text-warm-paper"
                : "border border-warm-line bg-warm-paper text-ink-700"
            }`}
          >
            All
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.12em] ${
                filter === k
                  ? "bg-ink-900 text-warm-paper"
                  : "border border-warm-line bg-warm-paper text-ink-700"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-full border border-warm-line bg-warm-paper p-0.5"
            role="group"
            aria-label="Generate as image or video"
          >
            <button
              type="button"
              onClick={() => setOutputMode("image")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                outputMode === "image"
                  ? "bg-ink-900 text-warm-paper"
                  : "text-ink-700 hover:text-ink-900"
              }`}
            >
              Image
            </button>
            <button
              type="button"
              onClick={() => setOutputMode("video")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                outputMode === "video"
                  ? "bg-ink-900 text-warm-paper"
                  : "text-ink-700 hover:text-ink-900"
              }`}
            >
              Video
            </button>
          </div>
          <ViewModeToggle value={view} onChange={changeView} />
          <label className="flex items-center gap-2 text-xs text-ink-700">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show removed
          </label>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-500">
        Each card picks Still or Video before Generate (toolbar sets the default). Copy
        plates are messaging only — use the kind dropdown, not Comfy. Video attire/hands
        often takes a few minutes; the badge shows a rough ETA. Primary size{" "}
        {campaign?.outputSizes?.[0]
          ? `${campaign.outputSizes[0].width}×${campaign.outputSizes[0].height}`
          : "from settings"}
        ; other sizes scale at assemble.
      </p>

      <div className={layoutClass(view)}>
        {visible.map((item) => {
          const blocked =
            (item.kind === "attire" && !contract.allow_attire) ||
            (item.kind === "background" && !contract.allow_background) ||
            (item.kind === "prop" && !contract.allow_props_on_talent);

          return (
            <div key={item.id} id={`plate-${item.id}`} className="scroll-mt-24 rounded-xl">
              <PlateCard
                item={item}
                density={view}
                active={item.active}
                blocked={blocked}
                showActivate
                busy={busyId === item.id}
                defaultOutputMode={outputMode}
                genProgress={genById[item.id] ?? null}
                onToggleActive={() => toggle(item.id)}
                onGenerate={(mode) => void generate(item.id, mode)}
                generateDisabled={blocked}
                onUploadFile={(file) => void upload(item.id, file)}
                onDraftHints={(next) => draftHints(item.id, next)}
                onSaveHints={(next) => saveHints(item.id, next)}
                onChangeKind={(nextKind) => void changeKind(item.id, nextKind)}
                isArchived={Boolean(item.hidden)}
                archiveAction="remove"
                onArchive={() => void softRemove(item)}
                mediaRev={mediaRev[item.id]}
              />
            </div>
          );
        })}
      </div>
      {!visible.length ? (
        <p className="mt-8 text-sm text-ink-700">
          No ingredients in this filter.{" "}
          <a href="/library" className="underline">
            Add plates in Library
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
