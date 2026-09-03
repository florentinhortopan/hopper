"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Campaign, DesignTokens } from "@attatta/shared";
import { BRAND_NAME } from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { api } from "@/lib/api";

function emptyDraft(id = "brand_custom"): DesignTokens {
  return {
    id,
    label: "New brand pack",
    colors: {
      background: "#1c1917",
      foreground: "#fafaf9",
      accent: "#ea580c",
      muted: "#44403c",
    },
    fonts: {
      display: "Georgia, serif",
      body: "system-ui, sans-serif",
    },
    endCardLayout: {
      ctaStyle: "solid",
      logoPosition: "bottom",
    },
    socialChrome: false,
    comfyStyleHints: [],
  };
}

export default function TokensPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<DesignTokens[]>([]);
  const [draft, setDraft] = useState<DesignTokens>(emptyDraft());
  const [selected, setSelected] = useState("");
  const [importFormat, setImportFormat] = useState<"json" | "css">("css");
  const [importText, setImportText] = useState("");
  const [importId, setImportId] = useState("brand_from_css");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [c, t] = await Promise.all([api.getCampaign(id), api.tokens()]);
    setCampaign(c);
    setPacks(t);
    const packId = c.designTokenPackId || t[0]?.id || "";
    setSelected(packId);
    const pack = t.find((p) => p.id === packId) || t[0];
    if (pack) setDraft({ ...pack, comfyStyleHints: pack.comfyStyleHints ?? [] });
  }

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [id]);

  const hintsText = useMemo(
    () => (draft.comfyStyleHints ?? []).join("\n"),
    [draft.comfyStyleHints],
  );

  function selectPack(pack: DesignTokens) {
    setSelected(pack.id);
    setDraft({ ...pack, comfyStyleHints: pack.comfyStyleHints ?? [] });
    setNotice(null);
  }

  function patchDraft(patch: Partial<DesignTokens>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function patchColors(patch: Partial<DesignTokens["colors"]>) {
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, ...patch },
    }));
  }

  function patchFonts(patch: Partial<DesignTokens["fonts"]>) {
    setDraft((prev) => ({
      ...prev,
      fonts: { ...prev.fonts, ...patch },
    }));
  }

  async function savePack() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.saveToken({
        ...draft,
        id: draft.id.trim() || "brand_custom",
        comfyStyleHints: (draft.comfyStyleHints ?? [])
          .map((h) => h.trim())
          .filter(Boolean),
      });
      setDraft(saved);
      setSelected(saved.id);
      setPacks(await api.tokens());
      setNotice(`Saved pack ${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAsNew() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.createToken(
        {
          ...draft,
          id: draft.id.trim() || `brand_${Date.now().toString(36)}`,
          comfyStyleHints: (draft.comfyStyleHints ?? [])
            .map((h) => h.trim())
            .filter(Boolean),
        },
        false,
      );
      setDraft(saved);
      setSelected(saved.id);
      setPacks(await api.tokens());
      setNotice(`Created pack ${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const pack = await api.importTokens({
        format: importFormat,
        text: importText,
        id: importId,
        label: draft.label,
      });
      setDraft({ ...pack, comfyStyleHints: pack.comfyStyleHints ?? [] });
      setSelected(pack.id);
      setNotice("Import preview loaded — Save pack to persist");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCampaign() {
    setBusy(true);
    setError(null);
    try {
      await api.saveToken({
        ...draft,
        comfyStyleHints: (draft.comfyStyleHints ?? [])
          .map((h) => h.trim())
          .filter(Boolean),
      });
      await api.putTokens(id, draft.id);
      window.location.href = `/campaigns/${id}/ingredients`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!campaign) return <p className="text-sm">Loading…</p>;

  return (
    <div>
      <StepNav campaignId={id} current="tokens" />
      <h1 className="font-display text-3xl">Design tokens</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-700">
        Edit brand colors and type for Remotion end cards. Comfy gets soft
        &quot;Brand look&quot; hints from this pack (not raw CSS). Import JSON or
        CSS variables from Tokens Studio / Figma exports.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600">
            Packs
          </div>
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPack(p)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
                selected === p.id
                  ? "border-ember-500 bg-white"
                  : "border-ink-200 bg-white/70"
              }`}
            >
              <span
                className="h-8 w-8 shrink-0 rounded-full border"
                style={{ background: p.colors.accent }}
              />
              <span className="min-w-0">
                <div className="truncate text-sm font-medium">{p.label}</div>
                <div className="truncate text-[11px] text-ink-600">{p.id}</div>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-ink-300 px-3 py-2 text-xs text-ink-700"
            onClick={() => {
              const d = emptyDraft(`brand_${Date.now().toString(36)}`);
              setDraft(d);
              setSelected(d.id);
            }}
          >
            + New pack
          </button>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-ink-200 bg-white/90 p-4">
            <h2 className="font-display text-lg">Edit pack</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-ink-700">
                Id
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                  value={draft.id}
                  onChange={(e) => patchDraft({ id: e.target.value })}
                />
              </label>
              <label className="text-xs text-ink-700">
                Label
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                  value={draft.label}
                  onChange={(e) => patchDraft({ label: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["background", "Background"],
                  ["foreground", "Foreground"],
                  ["accent", "Accent"],
                  ["muted", "Muted"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs text-ink-700">
                  {label}
                  <div className="mt-1 flex gap-2">
                    <input
                      type="color"
                      className="h-9 w-12 cursor-pointer rounded border border-ink-200"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(draft.colors[key])
                          ? draft.colors[key]
                          : "#000000"
                      }
                      onChange={(e) => patchColors({ [key]: e.target.value })}
                    />
                    <input
                      className="min-w-0 flex-1 rounded-md border border-ink-200 px-2 py-1.5 font-mono text-sm"
                      value={draft.colors[key]}
                      onChange={(e) => patchColors({ [key]: e.target.value })}
                    />
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-ink-700">
                Display font
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                  value={draft.fonts.display}
                  onChange={(e) => patchFonts({ display: e.target.value })}
                />
              </label>
              <label className="text-xs text-ink-700">
                Body font
                <input
                  className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                  value={draft.fonts.body}
                  onChange={(e) => patchFonts({ body: e.target.value })}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-4">
              <label className="text-xs text-ink-700">
                CTA style
                <select
                  className="mt-1 block rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                  value={draft.endCardLayout.ctaStyle}
                  onChange={(e) =>
                    patchDraft({
                      endCardLayout: {
                        ...draft.endCardLayout,
                        ctaStyle: e.target.value as "solid" | "outline",
                      },
                    })
                  }
                >
                  <option value="solid">solid</option>
                  <option value="outline">outline</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-700">
                <input
                  type="checkbox"
                  checked={draft.socialChrome}
                  onChange={(e) =>
                    patchDraft({ socialChrome: e.target.checked })
                  }
                />
                Social chrome
              </label>
            </div>

            <label className="mt-4 block text-xs text-ink-700">
              Comfy style hints (one per line; empty = auto from colors/fonts)
              <textarea
                className="mt-1 w-full rounded-md border border-ink-200 px-2 py-1.5 font-mono text-xs"
                rows={4}
                value={hintsText}
                onChange={(e) =>
                  patchDraft({
                    comfyStyleHints: e.target.value
                      .split("\n")
                      .map((l) => l.trimEnd()),
                  })
                }
                placeholder="warm terracotta accent on dark stone&#10;serif display headlines"
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void savePack()}
                className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Save pack
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveAsNew()}
                className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm disabled:opacity-40"
              >
                Save as new
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white/90 p-4">
            <h2 className="font-display text-lg">Import</h2>
            <p className="mt-1 text-xs text-ink-600">
              Paste {BRAND_NAME} token JSON or CSS with{" "}
              <code className="text-[11px]">--color-accent</code> /{" "}
              <code className="text-[11px]">--font-display</code> variables.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                className="rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                value={importFormat}
                onChange={(e) =>
                  setImportFormat(e.target.value as "json" | "css")
                }
              >
                <option value="css">CSS variables</option>
                <option value="json">{BRAND_NAME} JSON</option>
              </select>
              <input
                className="rounded-md border border-ink-200 px-2 py-1.5 text-sm"
                value={importId}
                onChange={(e) => setImportId(e.target.value)}
                placeholder="pack id"
              />
            </div>
            <textarea
              className="mt-3 w-full rounded-md border border-ink-200 px-2 py-1.5 font-mono text-xs"
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                importFormat === "css"
                  ? ":root {\n  --color-accent: #ea580c;\n  --color-background: #1c1917;\n  --font-display: Georgia, serif;\n}"
                  : '{\n  "id": "my_brand",\n  "label": "My Brand",\n  "colors": { ... }\n}'
              }
            />
            <button
              type="button"
              disabled={busy || !importText.trim()}
              onClick={() => void runImport()}
              className="mt-3 rounded-md border border-ink-200 bg-white px-4 py-2 text-sm disabled:opacity-40"
            >
              Parse import into editor
            </button>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-600">
            Live preview
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-warm-line bg-ink-900 shadow-surface">
            <PreviewPlayer
              props={{
                talentVideoSrc: "",
                handsVideoSrc: "",
                motionToken: "gesture_medium_v1",
                copy: {
                  setup: "Setup preview",
                  punchline: "Punchline preview",
                  endcard: campaign.brief.offer || "Your offer",
                  cta: campaign.brief.cta || "Learn more",
                },
                designTokens: draft,
                width: 1080,
                height: 1920,
                sizeId: "v_9x16_1080",
                aspect: "9:16",
              }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        className="mt-8 rounded-md bg-ember-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        onClick={() => void confirmCampaign()}
      >
        Save & confirm for campaign
      </button>
    </div>
  );
}
