"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { META_RECOMMENDED_SIZE_IDS, type OutputSize } from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

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
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

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

  async function save() {
    setBusy(true);
    try {
      await api.putCampaignSizes(id, { sizeIds: selectedIds });
      await api.patchCampaign(id, { modelProfileId, libraryId });
      await refresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selected = catalog.filter((s) => selectedIds.includes(s.id));

  return (
    <div>
      <StepNav campaignId={id} current="settings" />
      <h1 className="font-display text-3xl">Campaign settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-700">
        Confirm Meta delivery sizes before matrix / queue. Each cell × size becomes an explicit
        asset. Sizes are passed into the Comfy prompt pack as aspect + pixel dimensions for{" "}
        <span className="font-mono">{modelProfileId}</span>.
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
          Live default is <span className="font-mono">sd15</span> (Stable Diffusion 1.5 fp16 on
          Comfy Cloud). Matrix generate runs this profile via Comfy, then Remotion assembles.{" "}
          <a href="/comfy" className="underline">
            Full Comfy capabilities
          </a>
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

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">Output sizes</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-700">
              Priority stack for Meta: <strong>9:16</strong> (Reels/Stories) +{" "}
              <strong>4:5</strong> (Feed) cover most inventory; add <strong>1:1</strong> for
              Advantage+ / carousel / Marketplace. <strong>16:9</strong> is in-stream only.
              Adding a size syncs matrix rows — use{" "}
              <strong>Fill missing sizes</strong> on Matrix so Comfy generates
              each new aspect (Remotion only assembles; it does not reframe).
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
                      {s.tier === "optional" ? (
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                          Optional
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-ink-700">
                      {s.placements || "Meta placements"}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-ink-700">
                      {s.aspect} · delivery {s.width}×{s.height}
                      {s.genWidth ? ` · gen ${s.genWidth}×${s.genHeight}` : ""}
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
          {selected.length} size{selected.length === 1 ? "" : "s"} confirmed
          {planTotal > 0 ? (
            <>
              {" "}
              · matrix currently plans <strong>{planTotal}</strong> assets (cells × sizes)
            </>
          ) : (
            <> · build the matrix next to expand the full list</>
          )}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {selected.map((s) => (
            <li
              key={s.id}
              className="rounded bg-white px-2 py-1 font-mono text-[11px] text-ink-800"
            >
              {s.aspect} {s.width}×{s.height}
            </li>
          ))}
        </ul>
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
