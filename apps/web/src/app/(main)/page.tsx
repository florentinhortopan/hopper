"use client";

import { useEffect, useState } from "react";
import type { Campaign } from "@attatta/shared";
import { MagicCampaignModal } from "@/components/MagicCampaignModal";
import { WorkspacePickerModal } from "@/components/WorkspacePickerModal";
import { api } from "@/lib/api";

export default function HomePage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("New campaign");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [magicOpen, setMagicOpen] = useState(false);
  const [magicCampaignId, setMagicCampaignId] = useState<string | null>(null);
  const [magicCreateNew, setMagicCreateNew] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  async function refresh(includeArchived = showArchived) {
    setLoading(true);
    try {
      setCampaigns(await api.listCampaigns(includeArchived));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("magic");
    if (id) {
      setMagicCampaignId(id);
      setMagicCreateNew(false);
      setMagicOpen(true);
    }
  }, []);

  async function create() {
    const c = await api.createCampaign(name);
    window.location.href = `/campaigns/${c.id}/brief`;
  }

  async function archive(c: Campaign, archived: boolean) {
    await api.patchCampaign(c.id, { archived });
    await refresh(showArchived);
  }

  async function rename(c: Campaign) {
    const next = renameValue.trim();
    if (!next) return;
    await api.patchCampaign(c.id, { name: next });
    setRenamingId(null);
    await refresh(showArchived);
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete campaign "${c.name}" and its outputs? This cannot be undone.`)) return;
    await api.deleteCampaign(c.id);
    await refresh(showArchived);
  }

  /** Home Magic button — always creates a new campaign. */
  function openMagicNew() {
    setMagicCampaignId(null);
    setMagicCreateNew(true);
    setMagicOpen(true);
  }

  /** Open Magic on an existing campaign (standard or magic). */
  function openMagicOn(campaignId: string) {
    setMagicCampaignId(campaignId);
    setMagicCreateNew(false);
    setMagicOpen(true);
  }

  function closeMagic() {
    setMagicOpen(false);
    setMagicCampaignId(null);
    setMagicCreateNew(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("magic")) {
        url.searchParams.delete("magic");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
    void refresh(showArchived);
  }

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-display text-4xl tracking-tight">Campaigns</h1>
        <p className="mt-2 max-w-xl text-ink-700">
          Each campaign owns its own brief. Creating a new batch never overwrites another — archive
          or rename to keep the list clear. Magic creates a new campaign; open Magic from any
          campaign card or StepNav to run Magic on that id.
        </p>
      </header>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          API unreachable. Start orchestrator (`pnpm dev:api`) then refresh.
          <div className="mt-1 opacity-70">{error}</div>
        </div>
      ) : null}

      <div className="mb-8 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-700">New campaign name</span>
          <input
            className="rounded-md border border-ink-200 bg-white px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void create()}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-ink-50 hover:bg-ink-800"
        >
          New batch
        </button>
        <button
          type="button"
          onClick={openMagicNew}
          className="rounded-md border border-ember-500 bg-ember-500/10 px-4 py-2 text-sm font-medium text-ember-800"
        >
          New Magic campaign
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          className="rounded-md border border-ink-900 bg-ink-900 px-4 py-2 text-sm font-medium text-white"
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => void refresh(showArchived)}
          className="rounded-md border border-ink-200 px-4 py-2 text-sm"
        >
          Refresh
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {loading ? <p className="text-sm text-ink-700">Loading…</p> : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {campaigns.map((c) => (
          <li
            key={c.id}
            className={`rounded-xl border bg-white/80 p-5 shadow-sm ${
              c.archived ? "border-ink-200/60 opacity-70" : "border-ink-200"
            }`}
          >
            {renamingId === c.id ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-ink-200 px-2 py-1 text-sm"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="text-sm text-ink-900 underline"
                  onClick={() => void rename(c)}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="text-sm text-ink-700"
                  onClick={() => setRenamingId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <a
                href={`/campaigns/${c.id}/brief`}
                className="block font-display text-xl text-ink-900 hover:text-ember-600"
              >
                {c.name}
                {c.archived ? (
                  <span className="ml-2 text-xs font-sans uppercase tracking-wider text-ink-700">
                    archived
                  </span>
                ) : null}
              </a>
            )}
            <div className="mt-2 text-xs uppercase tracking-wider text-ink-700">
              {c.mode === "magic" ? (
                <span className="mr-2 rounded bg-ember-500/15 px-1.5 py-0.5 text-ember-800">
                  Magic
                </span>
              ) : (
                <span className="mr-2 rounded border border-ink-200 px-1.5 py-0.5 text-ink-600">
                  Standard
                </span>
              )}
              {c.templateId} · {c.matrix.cells.length} cells · id {c.id}
            </div>
            <div className="mt-1 text-xs text-ink-700/70">
              Updated {new Date(c.updatedAt).toLocaleString()}
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <button
                type="button"
                className="text-ember-800 underline"
                onClick={() => openMagicOn(c.id)}
              >
                Open Magic
              </button>
              <a
                href={`/campaigns/${c.id}/live`}
                className="text-ink-900 underline"
              >
                Workspace
              </a>
              <button
                type="button"
                className="text-ink-900 underline"
                onClick={() => {
                  setRenamingId(c.id);
                  setRenameValue(c.name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="text-ink-900 underline"
                onClick={() => void archive(c, !c.archived)}
              >
                {c.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                className="text-red-800 underline"
                onClick={() => void remove(c)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!loading && campaigns.length === 0 ? (
        <p className="text-sm text-ink-700">
          No campaigns yet. Create a batch — each keeps its own brief.
        </p>
      ) : null}

      <MagicCampaignModal
        open={magicOpen}
        campaignId={magicCampaignId}
        createNew={magicCreateNew}
        defaultName={name.trim() || "Magic campaign"}
        onClose={closeMagic}
      />
      <WorkspacePickerModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
      />
    </div>
  );
}
