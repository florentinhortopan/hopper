"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Caps = Awaited<ReturnType<typeof api.comfyCapabilities>>;

export default function ComfyCapabilitiesPage() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void api
      .comfyCapabilities()
      .then(setCaps)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!caps) return <p className="p-10 text-sm">Loading Comfy capabilities…</p>;

  const endpoints = caps.isCloud
    ? caps.remoteEndpoints.cloud
    : caps.remoteEndpoints.local;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs uppercase tracking-wider text-ink-600">
        <a href="/" className="underline">
          ATTATTA
        </a>{" "}
        · Comfy
      </p>
      <h1 className="mt-2 font-display text-4xl">Comfy capabilities</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-700">
        Live map of what generation can do. Plates are generated on Ingredients/Library; matrix and
        preview assemble via Remotion. See also <span className="font-mono">docs/COMFY.md</span>.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Stat label="Mode" value={caps.mode} />
        <Stat label="Target" value={caps.isCloud ? "Comfy Cloud" : "Local ComfyUI"} />
        <Stat label="Base URL" value={caps.baseUrl} mono />
        <Stat
          label="Health"
          value={caps.health.ok ? "ok" : "down"}
          tone={caps.health.ok ? "good" : "bad"}
        />
        <Stat label="Default profile" value={caps.defaultModelProfile} mono />
        <Stat label="API key" value={caps.hasApiKey ? "set" : "missing"} />
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl">Pipeline flags</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {Object.entries(caps.pipeline).map(([k, v]) => (
            <li
              key={k}
              className="flex items-center justify-between rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">{k}</span>
              <span className={v ? "text-emerald-700" : "text-ink-500"}>{v ? "yes" : "no"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl">Limitations</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-800">
          {caps.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl">Workflows</h2>
        <div className="mt-3 space-y-3">
          {caps.workflows.map((w) => (
            <div key={w.workflowId} className="rounded-xl border border-ink-200 bg-white p-4">
              <div className="font-mono text-sm font-medium">{w.workflowId}</div>
              <p className="mt-1 text-xs text-ink-700">{w.description || "—"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {w.profiles.map((p) => (
                  <span
                    key={p.profileId}
                    className={`rounded px-2 py-1 font-mono text-[11px] ${
                      p.ready
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-ink-100 text-ink-600"
                    }`}
                    title={p.notes || p.patchKeys.join(", ")}
                  >
                    {p.profileId}
                    {p.ready ? " · ready" : " · incomplete"}
                    {p.patchKeys.length ? ` · [${p.patchKeys.join(", ")}]` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl">Remote endpoints in use</h2>
        <ul className="mt-3 space-y-1 font-mono text-xs text-ink-800">
          {endpoints.map((e) => (
            <li key={`${e.method}${e.path}`}>
              <span className="text-ink-500">{e.method}</span> {e.path}{" "}
              <span className="text-ink-600">— {e.purpose}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl">ATTATTA Comfy API</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {caps.attattaEndpoints.map((e) => (
            <li key={`${e.method}${e.path}`} className="rounded-lg border border-ink-100 px-3 py-2">
              <div className="font-mono text-xs">
                <span className="text-ink-500">{e.method}</span> {e.path}
              </div>
              <div className="mt-1 text-ink-700">{e.purpose}</div>
              {e.body ? (
                <div className="mt-1 font-mono text-[11px] text-ink-500">{e.body}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl">Smoke test</h2>
        <button
          type="button"
          disabled={testBusy || !caps.health.ok}
          className="mt-3 rounded-md bg-ink-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          onClick={async () => {
            setTestBusy(true);
            setTestResult(null);
            try {
              const r = await api.comfyTestGenerate();
              setTestResult(
                `OK · ${String(r.lineage?.source || "?")} · ${r.assetPath}`,
              );
            } catch (e) {
              setTestResult(e instanceof Error ? e.message : String(e));
            } finally {
              setTestBusy(false);
            }
          }}
        >
          {testBusy ? "Generating…" : "POST /comfy/test-generate"}
        </button>
        {testResult ? (
          <p className="mt-2 break-all font-mono text-xs text-ink-700">{testResult}</p>
        ) : null}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-600">{label}</div>
      <div
        className={`mt-1 text-sm ${mono ? "font-mono break-all" : ""} ${
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
