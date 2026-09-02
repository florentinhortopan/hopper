"use client";

import type { CampaignEvent } from "@attatta/shared";

export function EventCard({ event }: { event: CampaignEvent }) {
  const tone =
    event.type === "review_decision"
      ? "border-emerald-200 bg-emerald-50/50"
      : event.type === "job_update" &&
          String(event.payload?.status || "").includes("fail")
        ? "border-red-200 bg-red-50/40"
        : event.type === "celtra_package"
          ? "border-ember-200 bg-ember-50/40"
          : event.type === "user_note" || event.type === "user_command"
            ? "border-ink-200 bg-white"
            : "border-ink-100 bg-white";

  const time = (() => {
    try {
      return new Date(event.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return event.at;
    }
  })();

  return (
    <article
      className={`rounded-xl border px-3 py-2 text-xs shadow-sm ${tone}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-500">
          {event.type.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-ink-400">{time}</span>
      </div>
      <p className="mt-1 text-ink-900">{event.summary}</p>
    </article>
  );
}
