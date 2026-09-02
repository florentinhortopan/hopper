"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@attatta/shared";
import { api } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WorkspacePickerModal({ open, onClose }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("Live workspace");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void api
      .listCampaigns(false)
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  async function openCampaign(id: string) {
    onClose();
    router.push(`/campaigns/${id}/live`);
  }

  async function createNew() {
    setBusy(true);
    setError(null);
    try {
      const { campaign } = await api.ensureMagicCampaign({
        name: name.trim() || "Live workspace",
        forceNew: true,
      });
      onClose();
      router.push(`/campaigns/${campaign.id}/live`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-ink-200 bg-warm-paper shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Open live workspace"
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div>
            <h2 className="font-display text-xl text-ink-900">Workspace</h2>
            <p className="text-xs text-ink-600">
              Choose a campaign or create one for the live 3-column cockpit.
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
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-800">
              {error}
            </pre>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="text-ink-700">New campaign name</span>
              <input
                className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className="rounded-md bg-ember-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              onClick={() => void createNew()}
            >
              {busy ? "Creating…" : "Create & open"}
            </button>
          </div>
          <div>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
              Existing campaigns
            </h3>
            {loading ? (
              <p className="text-sm text-ink-600">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-ink-600">No campaigns yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-ink-100 bg-white px-3 py-2 text-left text-sm hover:border-ink-300"
                      onClick={() => void openCampaign(c.id)}
                    >
                      <span className="truncate font-medium text-ink-900">
                        {c.name}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-[10px] text-ink-500">
                        {c.id}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
