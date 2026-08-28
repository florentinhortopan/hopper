"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  estimatePlateGenSeconds,
  isPlateReady,
  type IngredientKindDef,
  type LibraryItem,
  type LibraryKind,
} from "@attatta/shared";
import {
  PlateCard,
  type PlateDensity,
  type PlateGenProgress,
  type PlateOutputMode,
} from "@/components/PlateCard";
import {
  PlatePromptEditor,
  type PlateMetaDraft,
} from "@/components/PlatePromptEditor";
import { ActiveGenerationBar } from "@/components/ActiveGenerationBar";
import { LibraryImportPanel } from "@/components/LibraryImportPanel";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { api } from "@/lib/api";

type LibraryPackSummary = {
  id: string;
  name: string;
  version: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

/** Shared with Ingredients so view density stays in sync */
const VIEW_KEY = "attatta.ingredientPlates.view";

function canGenerateKind(kind: LibraryKind): boolean {
  return kind !== "talent" && kind !== "motion" && kind !== "copy";
}

function readStoredView(): PlateDensity {
  if (typeof window === "undefined") return "small";
  const v = window.localStorage.getItem(VIEW_KEY);
  if (v === "row" || v === "small" || v === "big") return v;
  return "small";
}

function layoutClass(density: PlateDensity): string {
  if (density === "row") return "flex flex-col gap-2";
  if (density === "small") {
    return "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";
  }
  return "grid gap-5 sm:grid-cols-2 xl:grid-cols-3";
}

export default function LibraryPage() {
  const [kinds, setKinds] = useState<IngredientKindDef[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [packs, setPacks] = useState<LibraryPackSummary[]>([]);
  const [libraryId, setLibraryId] = useState("default");
  const [newPackName, setNewPackName] = useState("");
  const [kind, setKind] = useState<LibraryKind | "all">("all");
  /** Explicit create kind — required when filter is All (no silent hands default). */
  const [addKind, setAddKind] = useState<LibraryKind>("background");
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [promptHint, setPromptHint] = useState("");
  const [negativeHint, setNegativeHint] = useState("");
  const [copySetup, setCopySetup] = useState("");
  const [copyPunchline, setCopyPunchline] = useState("");
  const [copyEndcard, setCopyEndcard] = useState("");
  const [copyCta, setCopyCta] = useState("Learn more");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<PlateOutputMode>("video");
  const [modelProfileId, setModelProfileId] = useState("sd15");
  const [modelOptions, setModelOptions] = useState<
    { id: string; label: string }[]
  >([
    { id: "sd15", label: "sd15 — SD 1.5 (still)" },
    { id: "z_image_turbo", label: "z_image_turbo" },
    { id: "sdxl", label: "sdxl" },
    { id: "flux_schnell", label: "flux_schnell" },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<PlateDensity>("small");
  const [mediaRev, setMediaRev] = useState<Record<string, number>>({});
  const [genById, setGenById] = useState<Record<string, PlateGenProgress & { jobId: string }>>(
    {},
  );
  const genByIdRef = useRef(genById);
  const itemsRef = useRef<LibraryItem[]>([]);

  useEffect(() => {
    genByIdRef.current = genById;
  }, [genById]);

  function bumpMedia(itemId: string) {
    setMediaRev((prev) => ({ ...prev, [itemId]: Date.now() }));
  }

  const createKind: LibraryKind = kind === "all" ? addKind : kind;
  const createKindDef = kinds.find((k) => k.id === createKind);
  const addCanGenerate = canGenerateKind(createKind);

  useEffect(() => {
    if (kind !== "all") setAddKind(kind);
  }, [kind]);

  useEffect(() => {
    setView(readStoredView());
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function changeView(next: PlateDensity) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  async function refresh(packId = libraryId, includeArchived = showArchived) {
    try {
      const [k, lib, models, packList] = await Promise.all([
        api.ingredientKinds(),
        api.library(undefined, packId, { includeArchived }),
        api.models().catch(() => null),
        api.listLibraryPacks().catch(() => [] as LibraryPackSummary[]),
      ]);
      setKinds(k);
      setItems(lib);
      setPacks(packList);
      if (packList.length && !packList.some((p) => p.id === packId)) {
        setLibraryId(packList[0]!.id);
      }
      if (models?.profiles) {
        const opts = Object.entries(models.profiles).map(([id, p]) => ({
          id,
          label: p.label ? `${id} — ${p.label}` : id,
        }));
        if (opts.length) setModelOptions(opts);
        if (models.defaultProfileId) {
          setModelProfileId((prev) => prev || models.defaultProfileId!);
        }
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh(libraryId, showArchived);
  }, [libraryId, showArchived]);

  const activePack = packs.find((p) => p.id === libraryId) || null;

  async function createPack() {
    const name = newPackName.trim() || "Untitled pack";
    setBusy(true);
    try {
      const pack = await api.createLibraryPack({ name });
      setNewPackName("");
      setLibraryId(pack.id);
      await refresh(pack.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function duplicatePack() {
    setBusy(true);
    try {
      const pack = await api.duplicateLibraryPack(libraryId);
      setLibraryId(pack.id);
      await refresh(pack.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Keep list + job progress in sync while plates generate (attire video can take minutes)
  const generatingIds = useMemo(
    () =>
      items
        .filter((i) => i.status === "generating" || busyId === i.id || genById[i.id])
        .map((i) => i.id)
        .join(","),
    [items, busyId, genById],
  );
  useEffect(() => {
    if (!generatingIds) return;
    const t = window.setInterval(() => {
      void (async () => {
        await refresh();
        const snapshot = genByIdRef.current;
        const entries = Object.entries(snapshot);
        if (!entries.length) return;
        const next = { ...snapshot };
        let changed = false;
        for (const [id, g] of entries) {
          try {
            const job = await api.getJob(g.jobId);
            next[id] = {
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
              delete next[id];
              bumpMedia(id);
            }
          } catch {
            /* keep local estimate */
          }
        }
        if (changed) setGenById(next);
      })();
    }, 2500);
    return () => window.clearInterval(t);
  }, [generatingIds]);

  const filtered = useMemo(
    () => (kind === "all" ? items : items.filter((i) => i.kind === kind)),
    [items, kind],
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function createItem(): Promise<LibraryItem | null> {
    if (!label.trim()) return null;
    const form = new FormData();
    form.set("libraryId", libraryId);
    form.set("kind", createKind);
    form.set("label", label.trim());
    form.set("tags", tags);
    form.set("promptHint", promptHint || label.trim());
    form.set("negativeHint", negativeHint);
    if (file) form.set("file", file);
    if (createKind === "talent") {
      form.set(
        "locks",
        JSON.stringify({
          face_locked: true,
          voice_locked: true,
          performance_locked: true,
        }),
      );
      form.set(
        "contract",
        JSON.stringify({
          face_locked: true,
          voice_locked: true,
          performance_locked: true,
          allow_attire: true,
          allow_background: true,
          allow_props_on_talent: true,
          allow_hands_variants: true,
          notes: "",
        }),
      );
    }
    if (createKind === "copy") {
      form.set(
        "copy",
        JSON.stringify({
          setup: copySetup || label.trim(),
          punchline: copyPunchline,
          endcard: copyEndcard,
          cta: copyCta || "Learn more",
        }),
      );
    }
    return api.createLibraryItem(form);
  }

  function clearAddForm() {
    setLabel("");
    setTags("");
    setPromptHint("");
    setNegativeHint("");
    setCopySetup("");
    setCopyPunchline("");
    setCopyEndcard("");
    setCopyCta("Learn more");
    setFile(null);
  }

  /** Create → list updates immediately → generate from the card (or one-shot). */
  async function addPlate(andGenerate: boolean) {
    if (!label.trim()) return;
    if (andGenerate && !addCanGenerate) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createItem();
      if (!created) return;
      clearAddForm();
      setSelectedId(created.id);
      if (kind === "all") setKind(created.kind);
      // Optimistic list insert so the card appears before refresh
      setItems((prev) => {
        if (prev.some((p) => p.id === created.id)) return prev;
        return [created, ...prev];
      });
      await refresh();

      if (andGenerate) {
        setBusyId(created.id);
        setItems((prev) =>
          prev.map((r) =>
            r.id === created.id ? { ...r, status: "generating" as const } : r,
          ),
        );
        const res = await api.generateLibraryItem(created.id, {
          outputMode,
          modelProfileId,
        });
        setGenById((prev) => ({
          ...prev,
          [created.id]: {
            jobId: res.job.id,
            startedAt: Date.now(),
            outputMode: res.outputMode,
            etaSeconds: res.etaSeconds,
            progress: res.job.progress,
            message: res.job.message,
          },
        }));
        setItems((prev) =>
          prev.map((r) => (r.id === created.id ? res.item : r)),
        );
        setBusyId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
      setBusyId(null);
    }
  }

  function draftHints(itemId: string, next: PlateMetaDraft) {
    setItems((prev) => {
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
      itemsRef.current = updated;
      return updated;
    });
  }

  async function saveHints(itemId: string, next: PlateMetaDraft) {
    draftHints(itemId, next);
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
    const prev = itemsRef.current.find((i) => i.id === itemId);
    if (prev) {
      setItems((rows) =>
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
      if (kind !== "all" && kind !== nextKind) setKind(nextKind);
    } catch (e) {
      if (prev) {
        setItems((rows) =>
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
    setError(null);
    setItems((prev) =>
      prev.map((r) =>
        r.id === itemId ? { ...r, status: "generating" as const } : r,
      ),
    );
    try {
      const row = itemsRef.current.find((r) => r.id === itemId);
      if (row) {
        await api.patchLibraryItem(itemId, {
          promptHint: row.promptHint || "",
          negativeHint: row.negativeHint || "",
        });
      }
      const res = await api.generateLibraryItem(itemId, {
        outputMode: mode,
        modelProfileId,
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
      setItems((prev) =>
        prev.map((r) => (r.id === itemId ? res.item : r)),
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

  async function remove(id: string) {
    if (
      !confirm(
        "Permanently delete this plate from the library? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      await api.deleteLibraryItem(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function archive(item: LibraryItem) {
    setBusyId(item.id);
    try {
      await api.patchLibraryItem(item.id, { archived: !item.archived });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <ActiveGenerationBar campaignId="_library" />
      <header className="mb-8">
        <h1 className="font-display text-4xl tracking-tight text-ink-900">Library plates</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-700">
          Versioned library packs — same plates as campaign Ingredients (campaigns pin a pack).
          Add a plate on the right or batch-import below. Generate from the card. Backgrounds
          are scene-only (no talent video); matrix composites talent later.
        </p>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-warm-line bg-warm-paper p-4 shadow-surface">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
              Library pack
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={libraryId}
                onChange={(e) => {
                  setSelectedId(null);
                  setLibraryId(e.target.value);
                }}
                className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
              >
                {packs.length ? (
                  packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · v{p.version}
                    </option>
                  ))
                ) : (
                  <option value="default">default · v1.0.0</option>
                )}
              </select>
              {activePack ? (
                <span className="text-xs text-ink-600">
                  id <span className="font-mono">{activePack.id}</span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder="New pack name"
              className="w-40 rounded-md border border-ink-200 px-2 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void createPack()}
              className="rounded-md border border-ink-300 bg-white px-3 py-2 text-xs font-medium"
            >
              New pack
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void duplicatePack()}
              className="rounded-md border border-ink-300 bg-white px-3 py-2 text-xs font-medium"
            >
              Duplicate as new version
            </button>
          </div>
        </div>
      </section>

      <div className="mb-6">
        <LibraryImportPanel
          libraryId={libraryId}
          onCommitted={() => void refresh(libraryId)}
          onError={(msg) => setError(msg || null)}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
                Kind
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setKind("all");
                    setSelectedId(null);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${
                    kind === "all"
                      ? "bg-ink-900 text-warm-paper"
                      : "border border-warm-line bg-warm-paper text-ink-700 hover:border-ink-300"
                  }`}
                >
                  All
                </button>
                {(kinds.length
                  ? kinds
                  : (
                      [
                        "talent",
                        "hands",
                        "motion",
                        "attire",
                        "background",
                        "prop",
                        "theme",
                        "copy",
                      ] as LibraryKind[]
                    ).map((id) => ({ id, label: id } as IngredientKindDef))
                ).map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => {
                      setKind(k.id);
                      setSelectedId(null);
                    }}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${
                      kind === k.id
                        ? "bg-ink-900 text-warm-paper"
                        : "border border-warm-line bg-warm-paper text-ink-700 hover:border-ink-300"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-warm-line pt-3">
              <p className="text-[11px] text-ink-500">
                <span className="font-medium text-ink-800">{filtered.length}</span>
                {filtered.length === 1 ? " plate" : " plates"}
                {kind !== "all" ? (
                  <span className="text-ink-400"> · {kind}</span>
                ) : null}
              </p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-ink-700">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Show archived
                </label>
                <ViewModeToggle
                  value={view}
                  onChange={changeView}
                  size="compact"
                />
              </div>
            </div>
          </div>

          <section className={layoutClass(view)}>
            {filtered.map((item) => (
              <PlateCard
                key={item.id}
                item={item}
                density={view}
                selected={selectedId === item.id}
                onSelect={() => setSelectedId(item.id)}
                busy={busyId === item.id}
                defaultOutputMode={outputMode}
                genProgress={genById[item.id] ?? null}
                onGenerate={(mode) => void generate(item.id, mode)}
                onDelete={() => void remove(item.id)}
                onArchive={() => void archive(item)}
                onUploadFile={(f) => void upload(item.id, f)}
                onDraftHints={(next) => draftHints(item.id, next)}
                onSaveHints={(next) => saveHints(item.id, next)}
                onChangeKind={(nextKind) => void changeKind(item.id, nextKind)}
                mediaRev={mediaRev[item.id]}
              />
            ))}
            {!filtered.length ? (
              <p className="col-span-full text-sm text-ink-700">
                No plates in this filter yet.
              </p>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-warm-line bg-warm-paper p-5 shadow-surface">
            <h2 className="font-display text-xl text-ink-900">
              Add {createKindDef?.label ?? createKind} plate
            </h2>
            <p className="mt-1 text-xs text-ink-600">
              {createKind === "background"
                ? "Background Video uses MiniMax with a talent MP4 as camera/POV (not the spokesperson). Image uses SD still. Pick the diffusion model below for stills."
                : createKindDef?.description ||
                  "Creates a draft in the list. Generate from the card, or use Add & generate."}
            </p>
            {addCanGenerate ? (
              <div className="mt-4">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                  Output
                </span>
                <div
                  className="mt-1.5 inline-flex w-full rounded-full border border-warm-line bg-white p-0.5"
                  role="group"
                  aria-label="Generate as image or video"
                >
                  <button
                    type="button"
                    onClick={() => setOutputMode("image")}
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
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
                    className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                      outputMode === "video"
                        ? "bg-ink-900 text-warm-paper"
                        : "text-ink-700 hover:text-ink-900"
                    }`}
                  >
                    Video
                  </button>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                    Model (Comfy profile)
                  </span>
                  <select
                    className="rounded-lg border border-warm-line px-3 py-2 text-sm"
                    value={modelProfileId}
                    onChange={(e) => setModelProfileId(e.target.value)}
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {createKind === "background"
                    ? "Video → MiniMax R2V (talent = POV). Image → SD still (model selector applies). Needs a ready talent MP4 for Video."
                    : "Video → MiniMax (needs talent MP4). Image → diffusion; model selector applies when a workflow map exists."}
                </p>
              </div>
            ) : null}
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                Kind
              </span>
              <select
                className="rounded-lg border border-warm-line px-3 py-2"
                value={createKind}
                onChange={(e) => {
                  const next = e.target.value as LibraryKind;
                  setAddKind(next);
                  if (kind !== "all") setKind(next);
                }}
              >
                {(kinds.length
                  ? kinds
                  : [
                      "talent",
                      "hands",
                      "motion",
                      "attire",
                      "background",
                      "prop",
                      "theme",
                      "copy",
                    ].map((id) => ({ id, label: id }))
                ).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                Label
              </span>
              <input
                className="rounded-lg border border-warm-line px-3 py-2"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            {createKind === "copy" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["Setup", copySetup, setCopySetup],
                    ["Punchline", copyPunchline, setCopyPunchline],
                    ["End card", copyEndcard, setCopyEndcard],
                    ["CTA", copyCta, setCopyCta],
                  ] as const
                ).map(([fieldLabel, value, setValue]) => (
                  <label key={fieldLabel} className="flex flex-col gap-1 text-sm">
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                      {fieldLabel}
                    </span>
                    <input
                      className="rounded-lg border border-warm-line px-3 py-2"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                    Plate prompt
                  </span>
                  <textarea
                    className="min-h-[72px] rounded-lg border border-warm-line px-3 py-2 text-sm"
                    placeholder={
                      createKind === "background"
                        ? "Camping lake at sunset, redwoods, breeze — empty scene, no people…"
                        : "Describe the plate for Comfy — product, framing, materials…"
                    }
                    value={promptHint}
                    onChange={(e) => setPromptHint(e.target.value)}
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-600">
                    File (optional)
                  </span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </>
            )}
            <button
              type="button"
              className="mt-3 text-xs text-ink-600 underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced" : "Tags & negative"}
            </button>
            {showAdvanced ? (
              <>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-ink-700">Tags</span>
                  <input
                    className="rounded-lg border border-warm-line px-3 py-2"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </label>
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-ink-700">Negative prompt</span>
                  <input
                    className="rounded-lg border border-warm-line px-3 py-2"
                    value={negativeHint}
                    onChange={(e) => setNegativeHint(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            <div className="mt-5 space-y-2 border-t border-warm-line pt-4">
              {addCanGenerate ? (
                <button
                  type="button"
                  disabled={busy || !label.trim()}
                  onClick={() => void addPlate(true)}
                  className="w-full rounded-lg bg-ember-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-ember-600 disabled:opacity-40"
                >
                  {busy && busyId
                    ? "Creating & generating…"
                    : busy
                      ? "Creating…"
                      : "Add & generate"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || !label.trim()}
                onClick={() => void addPlate(false)}
                className={`w-full rounded-lg px-3 py-2.5 text-sm font-medium disabled:opacity-40 ${
                  addCanGenerate
                    ? "border border-warm-line bg-white text-ink-900 hover:border-ink-300"
                    : "bg-ember-500 text-white hover:bg-ember-600"
                }`}
              >
                {busy && !busyId ? "Adding…" : "Add to list"}
              </button>
              <p className="text-[11px] leading-snug text-ink-600">
                {!label.trim()
                  ? "Enter a label to create."
                  : addCanGenerate
                    ? "Add to list → Generate on the card. Or Add & generate in one step. No second Generate panel."
                    : createKind === "copy"
                      ? "Copy plates are messaging only — activate 2+ on a campaign to fan lines."
                      : "Talent and motion stay upload-only — attach a file above."}
              </p>
            </div>
          </div>

          {selected ? (
            <div className="rounded-2xl border border-warm-line bg-warm-paper p-5 shadow-surface">
              <h2 className="font-display text-lg">{selected.label}</h2>
              <p className="mt-1 font-mono text-[11px] text-ink-600">{selected.id}</p>
              <p className="mt-2 text-[11px] text-ink-600">
                {isPlateReady(selected)
                  ? "Edit prompts below. Re-generate from the card in the list."
                  : "Draft in the list — use Generate on the card when ready."}
              </p>
              <PlatePromptEditor
                promptHint={selected.promptHint || ""}
                negativeHint={selected.negativeHint || ""}
                tags={selected.tags || []}
                disabled={busyId === selected.id}
                onDraftChange={(next) => draftHints(selected.id, next)}
                onSave={(next) => saveHints(selected.id, next)}
              />
              <div className="mt-4">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-warm-line px-3 py-1.5 text-xs"
                  onClick={() => void remove(selected.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
