"use client";

import { useEffect, useState } from "react";
import { ActiveGenerationBar } from "@/components/ActiveGenerationBar";
import { MagicCampaignModal } from "@/components/MagicCampaignModal";
import { api } from "@/lib/api";

const STEPS = [
  ["brief", "Brief"],
  ["settings", "Settings"],
  ["tokens", "Tokens"],
  ["ingredients", "Ingredients"],
  ["matrix", "Matrix / variants"],
  ["variants", "Variant review"],
  ["queue", "Queue"],
  ["review", "Assemble"],
  ["package", "Package"],
] as const;

export function StepNav({ campaignId, current }: { campaignId: string; current: string }) {
  const [mode, setMode] = useState<"standard" | "magic" | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [magicOpen, setMagicOpen] = useState(false);

  function refreshMeta() {
    void api
      .getCampaign(campaignId)
      .then((c) => {
        setMode(c.mode === "magic" ? "magic" : "standard");
        setCampaignName(c.name);
      })
      .catch(() => setMode("standard"));
  }

  useEffect(() => {
    refreshMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  return (
    <>
      <ActiveGenerationBar campaignId={campaignId} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        {mode === "magic" ? (
          <span className="rounded bg-ember-500/15 px-2 py-1 font-medium uppercase tracking-wide text-ember-800">
            Magic enabled
          </span>
        ) : (
          <span className="rounded border border-ink-200 px-2 py-1 text-ink-600">
            Standard
          </span>
        )}
        <span className="max-w-[14rem] truncate font-medium text-ink-900" title={campaignName}>
          {campaignName || "…"}
        </span>
        <span className="font-mono text-ink-500">{campaignId}</span>
        <button
          type="button"
          className="rounded border border-ember-500/40 bg-ember-500/10 px-2.5 py-1 font-medium text-ember-900 hover:bg-ember-500/20"
          onClick={() => setMagicOpen(true)}
        >
          Magic flow
        </button>
        <a
          href={`/campaigns/${campaignId}/live`}
          className="rounded border border-ink-900 bg-ink-900 px-2.5 py-1 font-medium text-white no-underline"
        >
          Workspace
        </a>
        <span className="text-ink-600">
          Magic on this campaign · Workspace = live 3-column cockpit
        </span>
      </div>
      <ol className="mb-8 flex flex-wrap gap-2 text-[11px] font-medium uppercase tracking-[0.14em]">
        {STEPS.map(([id, label]) => {
          const active = current === id;
          return (
            <li key={id}>
              <a
                href={`/campaigns/${campaignId}/${id}`}
                className={
                  active
                    ? "rounded bg-ink-900 px-3 py-1.5 text-warm-paper no-underline"
                    : "rounded border border-warm-line px-3 py-1.5 text-ink-700 no-underline transition-colors hover:border-ink-700 hover:text-ink-900"
                }
              >
                {label}
              </a>
            </li>
          );
        })}
      </ol>
      <MagicCampaignModal
        open={magicOpen}
        campaignId={campaignId}
        onClose={() => {
          setMagicOpen(false);
          refreshMeta();
        }}
      />
    </>
  );
}
