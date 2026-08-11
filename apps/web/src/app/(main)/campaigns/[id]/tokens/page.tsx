"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Campaign, DesignTokens } from "@attatta/shared";
import { StepNav } from "@/components/StepNav";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { api } from "@/lib/api";

export default function TokensPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<DesignTokens[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    void Promise.all([api.getCampaign(id), api.tokens()]).then(([c, t]) => {
      setCampaign(c);
      setPacks(t);
      setSelected(c.designTokenPackId || t[0]?.id || "");
    });
  }, [id]);

  const pack = packs.find((p) => p.id === selected);

  if (!campaign) return <p className="text-sm">Loading…</p>;

  return (
    <div>
      <StepNav campaignId={id} current="tokens" />
      <h1 className="font-display text-3xl">Design tokens</h1>
      <p className="mt-1 text-sm text-ink-700">
        Tokens dress every variant. They don’t multiply the matrix.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left ${
                selected === p.id ? "border-ember-500 bg-white" : "border-ink-200 bg-white/70"
              }`}
            >
              <span
                className="h-10 w-10 rounded-full border"
                style={{ background: p.colors.accent }}
              />
              <span>
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-ink-700">{p.id}</div>
              </span>
            </button>
          ))}
        </div>

        {pack ? (
          <PreviewPlayer
            props={{
              talentVideoSrc: "",
              handsVideoSrc: "",
              motionToken: "gesture_medium_v1",
              copy: {
                setup: "Setup preview",
                punchline: "Punchline preview",
                endcard: campaign.brief.offer || "Your offer",
                cta: campaign.brief.cta || "Learn more",
              },
              designTokens: pack,
              width: 1080,
              height: 1920,
              sizeId: "v_9x16_1080",
              aspect: "9:16",
            }}
          />
        ) : null}
      </div>

      <button
        type="button"
        className="mt-8 rounded-md bg-ink-900 px-4 py-2 text-sm text-white"
        onClick={async () => {
          await api.putTokens(id, selected);
          window.location.href = `/campaigns/${id}/ingredients`;
        }}
      >
        Confirm pack
      </button>
    </div>
  );
}
