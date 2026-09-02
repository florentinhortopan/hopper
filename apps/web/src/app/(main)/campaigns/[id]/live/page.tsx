"use client";

import { useParams } from "next/navigation";
import { LiveWorkspace } from "@/components/live/LiveWorkspace";

export default function LiveWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p className="p-8 text-sm">Missing campaign id</p>;
  return <LiveWorkspace campaignId={id} />;
}
