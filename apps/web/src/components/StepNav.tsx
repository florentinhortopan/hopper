import { useEffect, useState } from "react";
import { ActiveGenerationBar } from "@/components/ActiveGenerationBar";
import { api } from "@/lib/api";

const STEPS = [
  ["brief", "Brief"],
  ["settings", "Settings"],
  ["tokens", "Tokens"],
  ["ingredients", "Ingredients"],
  ["matrix", "Matrix / variants"],
  ["variants", "Variant review"],
  ["queue", "Queue"],
  ["review", "Review"],
  ["package", "Package"],
] as const;

export function StepNav({ campaignId, current }: { campaignId: string; current: string }) {
  const [mode, setMode] = useState<"standard" | "magic" | null>(null);

  useEffect(() => {
    void api
      .getCampaign(campaignId)
      .then((c) => setMode(c.mode === "magic" ? "magic" : "standard"))
      .catch(() => setMode("standard"));
  }, [campaignId]);

  return (
    <>
      <ActiveGenerationBar campaignId={campaignId} />
      {mode === "magic" ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded bg-ember-500/15 px-2 py-1 font-medium uppercase tracking-wide text-ember-800">
            Magic · Advanced
          </span>
          <a
            href={`/?magic=${encodeURIComponent(campaignId)}`}
            className="rounded border border-ember-500/40 bg-ember-500/10 px-2.5 py-1 font-medium text-ember-900 no-underline hover:bg-ember-500/20"
          >
            ← Magic flow
          </a>
          <span className="text-ink-600">
            Edit here, then return to the Magic popup for this campaign.
          </span>
        </div>
      ) : null}
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
    </>
  );
}
