"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LiveConnection,
  LiveConnectionId,
  LiveConnectionState,
} from "@attatta/shared";
import { api } from "@/lib/api";

function dotClass(state: LiveConnectionState) {
  if (state === "ok") return "bg-emerald-500";
  if (state === "simulated") return "bg-sky-500";
  if (state === "degraded") return "bg-amber-500";
  return "bg-red-500";
}

function stateLabel(state: LiveConnectionState) {
  if (state === "ok") return "Connected";
  if (state === "simulated") return "Simulated";
  if (state === "degraded") return "Degraded";
  return "Down";
}

type Props = {
  connectionId: LiveConnectionId;
  connection: LiveConnection | null;
  campaignId: string;
  onResynced?: (next: LiveConnection) => void;
};

export function ColumnConnectionChip({
  connectionId,
  connection,
  campaignId,
  onResynced,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = connection?.label || connectionId;
  const state = connection?.state || "down";

  async function resync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.liveConnectionResync(connectionId, campaignId);
      setMessage(result.message);
      onResynced?.(result.connection);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/90 px-2 py-0.5 text-[10px] text-ink-700 hover:border-ink-400"
        title={`${label}: ${stateLabel(state)} — tap to resync`}
        onClick={() => {
          setOpen((v) => !v);
          setMessage(null);
          setError(null);
        }}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(state)}`}
          aria-hidden
        />
        <span className="font-medium">{label}</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-ink-200 bg-warm-paper p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${dotClass(state)}`}
              aria-hidden
            />
            <p className="text-xs font-medium text-ink-900">
              {label} · {stateLabel(state)}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-ink-600">
            {connection?.detail || "Checking…"}
          </p>
          {connection?.endpoint ? (
            <p className="mt-1 truncate font-mono text-[10px] text-ink-400">
              {connection.endpoint}
            </p>
          ) : null}
          {connection?.notes?.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[10px] text-ink-500">
              {connection.notes.slice(0, 4).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {connection?.lastSyncedAt ? (
            <p className="mt-2 text-[10px] text-ink-400">
              Last resync{" "}
              {new Date(connection.lastSyncedAt).toLocaleTimeString()}
            </p>
          ) : null}
          {message ? (
            <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-900">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[10px] text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 w-full rounded-md bg-ink-900 px-2 py-1.5 text-[11px] text-white disabled:opacity-40"
            disabled={busy}
            onClick={() => void resync()}
          >
            {busy ? "Resyncing…" : "Resync with API"}
          </button>
          {connectionId === "celtra" ? (
            <p className="mt-2 text-[10px] leading-snug text-ink-500">
              Today rebuilds the local matrix preview. When Celtra API lands,
              resync will push CSV/XLS and notify the designer.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
