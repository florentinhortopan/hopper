"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  DEFAULT_ASSEMBLY_SCENES,
  META_RECOMMENDED_SIZE_IDS,
  assemblyRecipeTotalSeconds,
  suggestAssemblySecondsFromCopy,
  type AssemblyRecipe,
  type AssemblyScene,
  type OutputSize,
} from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

function newSceneId() {
  return `scene_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [catalog, setCatalog] = useState<OutputSize[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modelProfileId, setModelProfileId] = useState("sd15");
  const [libraryId, setLibraryId] = useState("default");
  const [packs, setPacks] = useState<
    Array<{ id: string; name: string; version: string }>
  >([]);
  const [planTotal, setPlanTotal] = useState(0);
  const [recipe, setRecipe] = useState<AssemblyRecipe>({
    scenes: DEFAULT_ASSEMBLY_SCENES,
    targetDurationSeconds: null,
    copySuggestedSeconds: null,
  });
  const [copyForSuggest, setCopyForSuggest] = useState<{
    setup?: string;
    punchline?: string;
    endcard?: string;
  }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [data, campaign, packList] = await Promise.all([
      api.campaignSizes(id),
      api.getCampaign(id),
      api.listLibraryPacks().catch(() => []),
    ]);
    setCatalog(data.catalog);
    setSelectedIds(data.selected.map((s) => s.id));
    setModelProfileId(data.modelProfileId);
    setPlanTotal(data.plan.total);
    setLibraryId(campaign.libraryId || "default");
    setPacks(packList);
    const r = campaign.assemblyRecipe ?? {
      scenes: DEFAULT_ASSEMBLY_SCENES,
      targetDurationSeconds: null,
      copySuggestedSeconds: null,
    };
    setRecipe({
      scenes: r.scenes?.length ? r.scenes : DEFAULT_ASSEMBLY_SCENES,
      targetDurationSeconds: r.targetDurationSeconds ?? null,
      copySuggestedSeconds: r.copySuggestedSeconds ?? null,
    });
    const cellCopy = campaign.matrix?.cells?.[0]?.copy;
    setCopyForSuggest({
      setup: cellCopy?.setup || campaign.brief?.prompt || undefined,
      punchline: cellCopy?.punchline || campaign.brief?.offer || undefined,
      endcard: cellCopy?.endcard || campaign.brief?.cta || undefined,
    });
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const sampleCopySuggestion = useMemo(
    () => suggestAssemblySecondsFromCopy(copyForSuggest),
    [copyForSuggest],
  );

  function toggle(sizeId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(sizeId)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== sizeId);
      }
      return [...prev, sizeId];
    });
  }

  function applyMetaRecommended() {
    setSelectedIds([...META_RECOMMENDED_SIZE_IDS]);
  }

  function updateScene(idx: number, patch: Partial<AssemblyScene>) {
    setRecipe((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  }

  function moveScene(idx: number, dir: -1 | 1) {
    setRecipe((prev) => {
      const next = [...prev.scenes];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...prev, scenes: next };
    });
  }

  function addScene() {
    setRecipe((prev) => ({
      ...prev,
      scenes: [
        ...prev.scenes,
        {
          id: newSceneId(),
          label: "Custom beat",
          role: "custom",
          durationSeconds: 3,
        },
      ],
    }));
  }

  function removeScene(idx: number) {
    setRecipe((prev) => {
      if (prev.scenes.length <= 1) return prev;
      return { ...prev, scenes: prev.scenes.filter((_, i) => i !== idx) };
    });
  }

  function applyCopySuggestion() {
    const suggested = sampleCopySuggestion;
    setRecipe((prev) => ({
      ...prev,
      copySuggestedSeconds: suggested,
      targetDurationSeconds: suggested,
    }));
  }

  async function save() {
    setBusy(true);
    try {
      await api.putCampaignSizes(id, { sizeIds: selectedIds });
      await api.patchCampaign(id, {
        modelProfileId,
        libraryId,
        assemblyRecipe: recipe,
      });
      await refresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selected = catalog.filter((s) => selectedIds.includes(s.id));
  const totalSec = assemblyRecipeTotalSeconds(recipe);

  return (
    <div>
      <StepNav campaignId={id} current="settings" />
      <h1 className="font-display text-3xl">Campaign settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-700">
        Confirm Meta delivery sizes and the Remotion assemble recipe before matrix / queue.
        One recipe applies to all sizes; Review → Assemble uses it for scene timing.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border border-ink-200 bg-white/90 p-4">
        <h2 className="font-display text-lg">Library pack</h2>
        <p className="mt-1 text-xs text-ink-700">
          Ingredients and matrix resolve plates only from this pack.{" "}
          <a href="/library" className="underline">
            Manage packs / import
          </a>
        </p>
        <select
          className="mt-3 rounded-md border border-ink-200 px-3 py-2 text-sm"
          value={libraryId}
          onChange={(e) => setLibraryId(e.target.value)}
        >
          {(packs.length
            ? packs
            : [{ id: "default", name: "default", version: "1.0.0" }]
          ).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · v{p.version}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 rounded-xl border border-ink-200 bg-white/90 p-4">
        <h2 className="font-display text-lg">Diffusion model</h2>
        <p className="mt-1 text-xs text-ink-700">
          Matrix generate runs this profile via Comfy; Remotion assembles masters on Review.
        </p>
        <select
          className="mt-3 rounded-md border border-ink-200 px-3 py-2 text-sm"
          value={modelProfileId}
          onChange={(e) => setModelProfileId(e.target.value)}
        >
          <option value="sd15">sd15 — SD 1.5 (free, live)</option>
          <option value="z_image_turbo">z_image_turbo — Z-Image-Turbo</option>
          <option value="sdxl">sdxl — SDXL 1.0</option>
          <option value="flux_schnell">flux_schnell — FLUX.1 Schnell</option>
        </select>
      </div>

      <div className="mt-6 rounded-xl border border-ink-200 bg-white/90 p-4">
        <h2 className="font-display text-lg">Assembly recipe</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-700">
          Scene list drives Remotion beats for every size on Review → Assemble.
          On Variant review, tag each variant with the single recipe beat its plate fills.
          Comfy only generates plates — this recipe is not sent to Comfy.
          Copy can suggest a total duration; applying it pre-fills the target (you can still edit).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-700">
            Target duration (seconds)
            <input
              type="number"
              min={4}
              max={60}
              className="mt-1 block w-28 rounded-md border border-ink-200 px-2 py-1.5 text-sm"
              value={recipe.targetDurationSeconds ?? ""}
              placeholder={String(totalSec)}
              onChange={(e) => {
                const v = e.target.value.trim();
                setRecipe((prev) => ({
                  ...prev,
                  targetDurationSeconds: v ? Number(v) : null,
                }));
              }}
            />
          </label>
          <button
            type="button"
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-xs"
            onClick={() => applyCopySuggestion()}
          >
            Apply copy suggestion (~{sampleCopySuggestion}s)
          </button>
          {recipe.copySuggestedSeconds ? (
            <span className="text-xs text-ink-600">
              Last suggestion: {recipe.copySuggestedSeconds}s
            </span>
          ) : null}
          <span className="text-xs text-ink-600">Effective total: {totalSec}s</span>
        </div>

        <ul className="mt-4 space-y-2">
          {recipe.scenes.map((scene, idx) => (
            <li
              key={scene.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2"
            >
              <input
                className="min-w-[8rem] flex-1 rounded border border-ink-200 px-2 py-1 text-sm"
                value={scene.label}
                onChange={(e) => updateScene(idx, { label: e.target.value })}
              />
              <select
                className="rounded border border-ink-200 px-2 py-1 text-xs"
                value={scene.role}
                onChange={(e) =>
                  updateScene(idx, {
                    role: e.target.value as AssemblyScene["role"],
                  })
                }
              >
                <option value="setup">setup</option>
                <option value="punchline">punchline</option>
                <option value="endcard">endcard</option>
                <option value="custom">custom</option>
              </select>
              <label className="text-xs text-ink-700">
                sec
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className="ml-1 w-16 rounded border border-ink-200 px-1 py-1"
                  value={scene.durationSeconds}
                  onChange={(e) =>
                    updateScene(idx, { durationSeconds: Number(e.target.value) || 1 })
                  }
                />
              </label>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => moveScene(idx, -1)}
              >
                Up
              </button>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => moveScene(idx, 1)}
              >
                Down
              </button>
              <button
                type="button"
                className="text-xs text-red-700 underline"
                onClick={() => removeScene(idx)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 rounded-md border border-ink-200 bg-white px-3 py-2 text-xs"
          onClick={() => addScene()}
        >
          Add scene
        </button>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Output sizes</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-700">
              Priority stack for Meta: <strong>9:16</strong> + <strong>4:5</strong>. Adding a
              size syncs matrix rows — use <strong>Fill missing sizes</strong> on Matrix so Comfy
              generates each aspect.
            </p>
          </div>
          <button
            type="button"
            onClick={applyMetaRecommended}
            className="rounded-md border border-ink-300 bg-white px-3 py-2 text-xs font-medium text-ink-800"
          >
            Apply Meta recommended (9:16 · 4:5 · 1:1)
          </button>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {catalog.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <li key={s.id}>
                <label
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
                    on ? "border-ember-500 bg-white" : "border-ink-200 bg-white/70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(s.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg">{s.label}</span>
                      {s.recommended ? (
                        <span className="rounded bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ember-700">
                          Recommended
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-ink-700">
                      {s.aspect} · {s.width}×{s.height}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50/80 p-4 text-sm">
        <div className="text-xs uppercase tracking-wider text-ink-700">Asset plan</div>
        <p className="mt-2">
          {selected.length} size{selected.length === 1 ? "" : "s"} · recipe {totalSec}s
          {planTotal > 0 ? (
            <>
              {" "}
              · matrix plans <strong>{planTotal}</strong> assets
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Save settings
        </button>
        <a
          href={`/campaigns/${id}/ingredients`}
          className="rounded-md border border-ink-200 px-4 py-2 text-sm"
        >
          Continue to ingredients
        </a>
      </div>
    </div>
  );
}
