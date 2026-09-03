/**
 * Product display brand. Internal packages, env vars, and routes stay `attatta`
 * so links / callbacks / deploys keep working.
 */
export const BRAND_NAME = "SCOTTY" as const;

/** Short IP nod — Paul holds the rights; we run the engine room. */
export const BRAND_CREDIT = "Paul's name" as const;

/** Under logos / nav. */
export const BRAND_SUBLINE = "Paul's name on the IP · we're just the engineer" as const;

/** Document title / meta. */
export const BRAND_TAGLINE = "Celtra hopper · Paul's IP" as const;

/** Chat / assistant persona label. */
export const BRAND_ASSISTANT = "SCOTTY" as const;

export function brandTitle(suffix?: string): string {
  return suffix ? `${BRAND_NAME} — ${suffix}` : `${BRAND_NAME} — ${BRAND_TAGLINE}`;
}
