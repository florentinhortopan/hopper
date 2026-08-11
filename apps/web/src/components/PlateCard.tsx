"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LIBRARY_KINDS,
  estimatePlateGenSeconds,
  formatDurationShort,
  remainingEstimateSeconds,
  type LibraryItem,
  type LibraryKind,
} from "@attatta/shared";
import { api } from "@/lib/api";
import {
  PlatePromptEditor,
  type PlateMetaDraft,
} from "@/components/PlatePromptEditor";
import { isPlateReady, plateStatusLabel, plateStatusTone } from "@/lib/plateStatus";

export type PlateDensity = "row" | "small" | "big";
export type PlateOutputMode = "image" | "video";

export type PlateGenProgress = {
  /** 0–1 from job API when available */
  progress?: number;
  message?: string;
  startedAt: number;
  outputMode: PlateOutputMode;
  etaSeconds: number;
};

const KIND_LABELS: Record<LibraryKind, string> = {
  talent: "Talent",
  hands: "Hands",
  motion: "Motion",
  attire: "Attire",
  background: "Background",
  prop: "Prop",
  theme: "Theme",
  copy: "Copy",
};

type Props = {
  item: LibraryItem;
  density?: PlateDensity;
  active?: boolean;
  blocked?: boolean;
  showActivate?: boolean;
  onToggleActive?: () => void;
  /** Generate with the card’s chosen still/video mode */
  onGenerate?: (outputMode: PlateOutputMode) => void;
  generateDisabled?: boolean;
  busy?: boolean;
  /** Live job progress while status=generating */
  genProgress?: PlateGenProgress | null;
  /** Default still/video for this card (page-level preference) */
  defaultOutputMode?: PlateOutputMode;
  onDelete?: () => void;
  onUploadFile?: (file: File) => void;
  onSaveHints?: (next: PlateMetaDraft) => void | Promise<void>;
  onDraftHints?: (next: PlateMetaDraft) => void;
  /** Recategorize plate into another ingredient kind */
  onChangeKind?: (kind: LibraryKind) => void | Promise<void>;
  /** Cache-bust token so thumbs refresh after upload / re-gen */
  mediaRev?: string | number;
  selected?: boolean;
  onSelect?: () => void;
};

function PlateMedia({
  item,
  ready,
  compact,
  mediaRev,
}: {
  item: LibraryItem;
  ready: boolean;
  compact?: boolean;
  mediaRev?: string | number;
}) {
  if (!ready) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center text-ink-300 ${
          compact ? "text-[9px]" : "text-[11px]"
        }`}
      >
        <span>Needs plate</span>
        {!compact ? <span className="opacity-70">Upload or generate</span> : null}
      </div>
    );
  }
  const rev = mediaRev ?? `${item.path}:${item.status}:${item.sourceMode}`;
  const src = api.libraryMediaUrl(item.id, rev);
  if (item.mediaType === "video") {
    return (
      <video
        key={src}
        src={src}
        className="h-full w-full object-cover"
        muted
        playsInline
        controls={!compact}
        preload="metadata"
        onMouseEnter={(e) => {
          void e.currentTarget.play().catch(() => undefined);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.pause();
          e.currentTarget.currentTime = 0;
        }}
      />
    );
  }
  if (item.mediaType === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} src={src} alt="" className="h-full w-full object-cover" />
    );
  }
  if (item.kind === "copy") {
    const c = item.copy;
    return (
      <div
        className={`flex h-full flex-col justify-center gap-1 bg-gradient-to-b from-ink-900 to-ink-800 px-2.5 text-left text-warm-paper ${
          compact ? "py-2" : "py-3"
        }`}
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-warm-paper/50">
          Copy
        </span>
        <span className={`leading-snug ${compact ? "line-clamp-3 text-[10px]" : "line-clamp-5 text-xs"}`}>
          {c?.setup || c?.punchline || item.label}
        </span>
        {c?.cta ? (
          <span className="mt-auto truncate text-[10px] text-ember-300">{c.cta}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-ink-300">
      {item.mediaType}
    </div>
  );
}

function CopyDisclosure({
  item,
  open,
  onToggle,
  density,
  busy,
  blocked,
  onSaveHints,
  onDraftHints,
}: {
  item: LibraryItem;
  open: boolean;
  onToggle: () => void;
  density: PlateDensity;
  busy?: boolean;
  blocked?: boolean;
  onSaveHints?: Props["onSaveHints"];
  onDraftHints?: Props["onDraftHints"];
}) {
  const initial = item.copy ?? {
    setup: "",
    punchline: "",
    endcard: "",
    cta: "Learn more",
  };
  const [lines, setLines] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLines(initial);
  }, [initial.setup, initial.punchline, initial.endcard, initial.cta]);

  if (!onSaveHints) return null;

  function commit(next: typeof lines) {
    const payload: PlateMetaDraft = {
      promptHint: next.setup || item.promptHint || item.label,
      negativeHint: item.negativeHint || "",
      tags: item.tags || [],
      copy: next,
    };
    onDraftHints?.(payload);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void onSaveHints?.(payload);
    }, 450);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`group flex w-full min-w-0 items-start gap-2 rounded-lg border border-transparent text-left transition-colors hover:border-warm-line hover:bg-white/60 ${
          density === "row" ? "px-1 py-0.5" : "mt-1.5 px-1.5 py-1"
        }`}
      >
        <span className="mt-0.5 shrink-0 text-ink-400" aria-hidden>
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
            Copy lines
          </span>
          <span
            className={`mt-0.5 block text-ink-700 ${
              density === "small" ? "line-clamp-2 text-[11px]" : "line-clamp-3 text-xs"
            }`}
          >
            {lines.setup || lines.punchline || (
              <span className="italic text-ink-400">No lines — click to edit</span>
            )}
          </span>
        </span>
      </button>
    );
  }

  const fields: { key: keyof typeof lines; label: string }[] = [
    { key: "setup", label: "Setup" },
    { key: "punchline", label: "Punchline" },
    { key: "endcard", label: "End card" },
    { key: "cta", label: "CTA" },
  ];

  return (
    <div
      className={`min-w-0 w-full ${density === "row" ? "" : "mt-1.5"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggle}
        className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:text-ink-900"
      >
        <span aria-hidden>▾</span>
        Collapse copy
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-0.5 text-sm">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
              {label}
            </span>
            <input
              disabled={busy || blocked}
              className="rounded-md border border-warm-line bg-white px-2 py-1.5 text-xs text-ink-900"
              value={lines[key]}
              onChange={(e) => {
                const next = { ...lines, [key]: e.target.value };
                setLines(next);
                commit(next);
              }}
              onBlur={() =>
                void onSaveHints({
                  promptHint: lines.setup || item.promptHint || item.label,
                  negativeHint: item.negativeHint || "",
                  tags: item.tags || [],
                  copy: lines,
                })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Actions({
  busy,
  generating,
  canGen,
  genLabel,
  outputMode,
  onOutputModeChange,
  onUploadFile,
  onGenerate,
  onDelete,
  compact,
  etaHint,
  metaOnly,
}: {
  busy?: boolean;
  generating?: boolean;
  canGen: boolean;
  genLabel: string;
  outputMode: PlateOutputMode;
  onOutputModeChange?: (mode: PlateOutputMode) => void;
  onUploadFile?: (file: File) => void;
  onGenerate?: (mode: PlateOutputMode) => void;
  onDelete?: () => void;
  compact?: boolean;
  etaHint?: string;
  /** talent / motion / copy — no Comfy generate */
  metaOnly?: boolean;
}) {
  const btn = compact
    ? "rounded-md px-2 py-1 text-[11px] font-medium"
    : "rounded-lg px-3 py-1.5 text-xs font-medium";
  const label =
    compact && genLabel === "Re-generate"
      ? "Re-gen"
      : compact && generating
        ? "…"
        : genLabel;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {onUploadFile ? (
        <label
          className={`cursor-pointer border border-warm-line bg-white text-ink-900 hover:border-ink-300 ${btn}`}
        >
          Upload
          <input
            type="file"
            className="hidden"
            accept="image/*,video/*"
            disabled={busy || generating}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
              e.target.value = "";
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
      ) : null}
      {onGenerate && (canGen || generating) ? (
        <>
          {onOutputModeChange && !generating ? (
            <div
              className="inline-flex rounded-full border border-warm-line bg-white p-0.5"
              role="group"
              aria-label="Still or video plate"
              onClick={(e) => e.stopPropagation()}
            >
              {(
                [
                  ["image", "Still"],
                  ["video", "Video"],
                ] as const
              ).map(([mode, text]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={busy}
                  title={
                    mode === "image"
                      ? "Generate a still image plate"
                      : "Generate a video plate via MiniMax (needs talent MP4 — for backgrounds talent is camera/POV only)"
                  }
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    outputMode === mode
                      ? "bg-ink-900 text-warm-paper"
                      : "text-ink-600 hover:text-ink-900"
                  }`}
                  onClick={() => onOutputModeChange(mode)}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy || generating || !canGen}
            title={
              generating
                ? etaHint || "Generation in progress"
                : genLabel === "Re-generate"
                  ? `Replace with a new ${outputMode === "image" ? "still" : "video"} via Comfy`
                  : `Generate a ${outputMode === "image" ? "still" : "video"} plate via Comfy`
            }
            className={`inline-flex items-center gap-1.5 bg-ember-500 text-white hover:bg-ember-600 disabled:opacity-40 ${btn}`}
            onClick={(e) => {
              e.stopPropagation();
              onGenerate?.(outputMode);
            }}
          >
            {generating ? <span className="attatta-spinner" aria-hidden /> : null}
            {label}
          </button>
        </>
      ) : onGenerate && !canGen ? (
        <span className="text-[10px] text-ink-500">
          {metaOnly ? "Edit fields" : "Upload only"}
        </span>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          disabled={busy || generating}
          title="Delete this plate from the library"
          className={`border border-warm-line bg-white text-ink-700 hover:border-red-300 hover:text-red-800 disabled:opacity-40 ${btn}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          {compact ? "Del" : "Delete"}
        </button>
      ) : null}
    </div>
  );
}

function PromptDisclosure({
  item,
  open,
  onToggle,
  density,
  busy,
  blocked,
  onSaveHints,
  onDraftHints,
}: {
  item: LibraryItem;
  open: boolean;
  onToggle: () => void;
  density: PlateDensity;
  busy?: boolean;
  blocked?: boolean;
  onSaveHints?: Props["onSaveHints"];
  onDraftHints?: Props["onDraftHints"];
}) {
  if (!onSaveHints) return null;
  const hint = item.promptHint?.trim() || "";
  const tags = item.tags || [];
  const compact = density !== "big";

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`group flex w-full min-w-0 items-start gap-2 rounded-lg border border-transparent text-left transition-colors hover:border-warm-line hover:bg-white/60 ${
          density === "row" ? "px-1 py-0.5" : "mt-1.5 px-1.5 py-1"
        }`}
      >
        <span
          className="mt-0.5 shrink-0 text-ink-400 transition-colors group-hover:text-ink-700"
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
            Prompt & tags
          </span>
          {tags.length ? (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {tags.slice(0, density === "small" ? 2 : 4).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-ink-900/[0.06] px-1.5 py-0.5 text-[10px] text-ink-700"
                >
                  {t}
                </span>
              ))}
              {tags.length > (density === "small" ? 2 : 4) ? (
                <span className="text-[10px] text-ink-400">
                  +{tags.length - (density === "small" ? 2 : 4)}
                </span>
              ) : null}
            </span>
          ) : null}
          <span
            className={`mt-0.5 block text-ink-700 ${
              density === "small"
                ? "line-clamp-1 text-[11px]"
                : "line-clamp-2 text-xs"
            }`}
          >
            {hint || (
              <span className="italic text-ink-400">
                No prompt or tags — click to edit
              </span>
            )}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={`min-w-0 w-full ${density === "row" ? "" : "mt-1.5"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggle}
        className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600 hover:text-ink-900"
      >
        <span aria-hidden>▾</span>
        Collapse details
      </button>
      <PlatePromptEditor
        promptHint={item.promptHint || ""}
        negativeHint={item.negativeHint || ""}
        tags={item.tags || []}
        disabled={busy || blocked}
        compact={compact}
        onDraftChange={onDraftHints}
        onSave={onSaveHints}
      />
    </div>
  );
}

export function PlateCard({
  item,
  density = "big",
  active,
  blocked,
  showActivate,
  onToggleActive,
  onGenerate,
  generateDisabled,
  busy,
  genProgress,
  defaultOutputMode = "video",
  onDelete,
  onUploadFile,
  onSaveHints,
  onDraftHints,
  onChangeKind,
  mediaRev,
  selected,
  onSelect,
}: Props) {
  const status = plateStatusLabel(item);
  const ready = isPlateReady(item);
  /** Progressive disclosure — collapsed in every density by default */
  const [promptOpen, setPromptOpen] = useState(false);
  const [kindBusy, setKindBusy] = useState(false);
  const [pendingKind, setPendingKind] = useState<LibraryKind | null>(null);
  const [outputMode, setOutputMode] = useState<PlateOutputMode>(defaultOutputMode);
  const [now, setNow] = useState(() => Date.now());
  const displayKind = pendingKind ?? item.kind;
  const metaOnly =
    item.kind === "talent" || item.kind === "motion" || item.kind === "copy";
  const generating = item.status === "generating" || Boolean(genProgress);
  const canGen =
    !generateDisabled &&
    !metaOnly &&
    item.status !== "generating";
  const genLabel = generating
    ? "Generating…"
    : ready
      ? "Re-generate"
      : "Generate";

  const etaTotal =
    genProgress?.etaSeconds ??
    estimatePlateGenSeconds(item.kind, genProgress?.outputMode ?? outputMode);
  const remainSec = genProgress
    ? remainingEstimateSeconds(genProgress.startedAt, etaTotal, now)
    : etaTotal;
  const elapsedSec = genProgress
    ? Math.max(0, (now - genProgress.startedAt) / 1000)
    : 0;
  const etaHint = generating
    ? `${genProgress?.outputMode === "image" || (!genProgress && outputMode === "image") ? "Still" : "Video"} · ~${formatDurationShort(remainSec)} left · ${formatDurationShort(elapsedSec)} in`
    : undefined;

  const ring =
    selected || active
      ? "ring-2 ring-ember-500 ring-offset-2 ring-offset-warm-canvas"
      : "ring-1 ring-warm-line";

  useEffect(() => {
    setOutputMode(defaultOutputMode);
  }, [defaultOutputMode, item.id]);

  useEffect(() => {
    if (pendingKind && pendingKind === item.kind) setPendingKind(null);
  }, [item.kind, pendingKind]);

  // Switching density collapses prompts so grids stay scannable
  useEffect(() => {
    setPromptOpen(false);
  }, [density]);

  useEffect(() => {
    if (!generating) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [generating]);

  const kindControl = onChangeKind ? (
    <label
      className="inline-flex min-w-0 items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="sr-only">Ingredient category</span>
      <select
        value={displayKind}
        disabled={busy || blocked || kindBusy}
        title="Move plate into another library category"
        className={`max-w-full rounded-md border border-warm-line bg-white text-ink-800 focus:border-ink-400 focus:outline-none ${
          density === "small"
            ? "py-0.5 pl-1.5 pr-6 text-[10px]"
            : "py-1 pl-2 pr-7 text-[11px]"
        }`}
        onChange={(e) => {
          const next = e.target.value as LibraryKind;
          if (next === item.kind) return;
          setPendingKind(next);
          setKindBusy(true);
          void Promise.resolve(onChangeKind(next))
            .catch(() => setPendingKind(null))
            .finally(() => {
              setKindBusy(false);
            });
        }}
      >
        {LIBRARY_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <span className="capitalize text-ink-600">{item.kind}</span>
  );

  const mediaFrame = () => {
    const box =
      density === "row"
        ? "h-[120px] w-[90px] shrink-0 sm:h-[132px] sm:w-[99px]"
        : density === "small"
          ? "aspect-[3/4] w-full"
          : "aspect-[9/16] w-full";
    const radius = density === "big" ? "rounded-xl" : "rounded-lg";
    const inner = (
      <div className={`overflow-hidden bg-ink-900 ${box} ${radius} ${ring}`}>
        <PlateMedia
          item={item}
          ready={ready}
          compact={density === "small"}
          mediaRev={mediaRev}
        />
      </div>
    );
    if (!onSelect) return inner;
    return (
      <button
        type="button"
        onClick={onSelect}
        disabled={blocked}
        className={`block p-0 text-left ${density === "row" ? "shrink-0" : "w-full"}`}
        title="Select plate"
      >
        {inner}
      </button>
    );
  };

  const activate = showActivate ? (
    <label
      className={`flex items-center gap-1.5 text-ink-800 ${
        density === "row" || density === "small" ? "text-[11px]" : "text-xs"
      }`}
    >
      <input
        type="checkbox"
        checked={Boolean(active)}
        disabled={blocked || busy}
        onChange={onToggleActive}
        onClick={(e) => e.stopPropagation()}
      />
      {density === "small" ? "On" : "Activate"}
    </label>
  ) : null;

  const statusChip = generating ? (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-medium uppercase tracking-wide text-amber-950 ${
        density === "small" ? "text-[9px]" : "text-[10px]"
      }`}
      title={etaHint}
    >
      <span className="attatta-spinner" aria-hidden />
      {density === "small"
        ? `~${formatDurationShort(remainSec)}`
        : `Gen · ~${formatDurationShort(remainSec)}`}
    </span>
  ) : (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-medium uppercase tracking-wide ${
        density === "small" ? "text-[9px]" : "text-[10px]"
      } ${plateStatusTone(status)}`}
    >
      {status}
    </span>
  );

  const promptBlock =
    item.kind === "copy" ? (
      <CopyDisclosure
        item={item}
        open={promptOpen}
        onToggle={() => setPromptOpen((v) => !v)}
        density={density}
        busy={busy}
        blocked={blocked}
        onSaveHints={onSaveHints}
        onDraftHints={onDraftHints}
      />
    ) : (
      <PromptDisclosure
        item={item}
        open={promptOpen}
        onToggle={() => setPromptOpen((v) => !v)}
        density={density}
        busy={busy}
        blocked={blocked}
        onSaveHints={onSaveHints}
        onDraftHints={onDraftHints}
      />
    );

  const actions = (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Actions
        busy={busy || kindBusy}
        generating={generating}
        canGen={canGen}
        genLabel={genLabel}
        outputMode={outputMode}
        onOutputModeChange={onGenerate && !metaOnly ? setOutputMode : undefined}
        onUploadFile={onUploadFile}
        onGenerate={onGenerate}
        onDelete={onDelete}
        compact={density !== "big"}
        etaHint={etaHint}
        metaOnly={metaOnly}
      />
      {generating ? (
        <div className="min-w-0">
          <div className="h-1 overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
              style={{
                width: `${Math.min(
                  98,
                  Math.max(
                    6,
                    Math.round(
                      ((genProgress?.progress ?? elapsedSec / Math.max(etaTotal, 1)) ||
                        0.08) * 100,
                    ),
                  ),
                )}%`,
              }}
            />
          </div>
          {density !== "small" && etaHint ? (
            <p className="mt-1 truncate text-[10px] text-amber-900/80">{etaHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  let content: ReactNode;

  if (density === "row") {
    content = (
      <div className="flex w-full min-w-0 items-stretch gap-3 sm:gap-4">
        {mediaFrame()}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-medium text-ink-900">
                  {item.label}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-600">
                  {kindControl}
                  <span className="truncate font-mono text-[10px] text-ink-400">
                    {item.id}
                  </span>
                </div>
              </div>
              {statusChip}
            </div>
            {promptBlock}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {activate}
            {blocked ? (
              <span className="text-[11px] text-red-700">Blocked by contract</span>
            ) : null}
            {actions}
          </div>
        </div>
      </div>
    );
  } else if (density === "small") {
    content = (
      <>
        {mediaFrame()}
        <div className="mt-2 flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink-900">{item.label}</div>
            <div className="mt-0.5 min-w-0 text-[10px] text-ink-600">{kindControl}</div>
          </div>
          {statusChip}
        </div>
        {promptBlock}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {activate}
          {blocked ? (
            <span className="text-[10px] text-red-700">Blocked</span>
          ) : null}
          {actions}
        </div>
      </>
    );
  } else {
    content = (
      <>
        {mediaFrame()}
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-ink-900">{item.label}</div>
            <div className="mt-0.5 font-mono text-[10px] text-ink-400">{item.id}</div>
          </div>
          {statusChip}
        </div>
        <div className="mt-1.5 text-[11px] text-ink-600">{kindControl}</div>
        {promptBlock}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {activate}
          {blocked ? (
            <span className="text-[11px] text-red-700">Blocked by contract</span>
          ) : null}
          {actions}
        </div>
      </>
    );
  }

  const shell =
    density === "row"
      ? "rounded-xl bg-warm-paper px-3 py-2.5 shadow-surface"
      : density === "small"
        ? "rounded-xl bg-warm-paper p-2 shadow-surface"
        : "rounded-2xl bg-warm-paper p-3 shadow-surface";

  return (
    <article
      className={`min-w-0 ${shell} ${blocked ? "opacity-50" : ""} ${
        selected ? "ring-1 ring-ember-500/40" : ""
      }`}
    >
      {content}
    </article>
  );
}
