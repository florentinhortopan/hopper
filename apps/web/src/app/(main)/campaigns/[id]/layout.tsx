"use client";

import { useParams } from "next/navigation";
import { CampaignThemeRoot } from "@/components/campaign/CampaignThemeRoot";

export default function CampaignIdLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <>{children}</>;
  return <CampaignThemeRoot campaignId={id}>{children}</CampaignThemeRoot>;
}
