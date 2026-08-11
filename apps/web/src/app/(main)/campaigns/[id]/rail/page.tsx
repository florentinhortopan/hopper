"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Rail step dissolved: activations on Ingredients derive the internal rail;
 * matrix build + model prompt preview live on Matrix.
 */
export default function RailRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/campaigns/${id}/matrix`);
  }, [id, router]);

  return (
    <div className="p-8 text-sm text-ink-700">
      The Rail step is gone — redirecting to Matrix. Activate plates on Ingredients;
      Build from activations on Matrix (prompt preview is there too).
    </div>
  );
}
