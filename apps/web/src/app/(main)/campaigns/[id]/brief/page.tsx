"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Brief, Campaign } from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { api } from "@/lib/api";

export default function BriefPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);

  useEffect(() => {
    void api.getCampaign(id).then((c) => {
      setCampaign(c);
      setBrief(c.brief);
    });
  }, [id]);

  if (!campaign || !brief) return <p className="text-sm">Loading…</p>;

  return (
    <div>
      <StepNav campaignId={id} current="brief" />
      <h1 className="font-display text-3xl">{campaign.name}</h1>
      <p className="mt-1 text-sm text-ink-700">Brief it once — scenario, tone, offer.</p>

      <textarea
        className="mt-6 min-h-40 w-full rounded-xl border border-ink-200 bg-white p-4 text-base"
        value={brief.prompt}
        onChange={(e) => setBrief({ ...brief, prompt: e.target.value })}
        placeholder="Describe the ad…"
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["audience", "Audience"],
            ["offer", "Offer"],
            ["cta", "CTA"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm">
            <span className="text-ink-700">{label}</span>
            <input
              className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2"
              value={brief[key]}
              onChange={(e) => setBrief({ ...brief, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-ink-900 px-4 py-2 text-sm text-white"
          onClick={async () => {
            await api.putBrief(id, brief);
            window.location.href = `/campaigns/${id}/settings`;
          }}
        >
          Save & continue
        </button>
      </div>
    </div>
  );
}
