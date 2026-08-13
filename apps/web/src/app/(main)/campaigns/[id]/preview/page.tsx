"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

/** Legacy Preview bay → Variant review */
export default function PreviewRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const q = search.toString();
    router.replace(`/campaigns/${id}/variants${q ? `?${q}` : ""}`);
  }, [id, router, search]);

  return <p className="text-sm text-ink-700">Redirecting to Variant review…</p>;
}
