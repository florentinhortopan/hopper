import { ActiveGenerationBar } from "@/components/ActiveGenerationBar";

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
  return (
    <>
      <ActiveGenerationBar campaignId={campaignId} />
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
