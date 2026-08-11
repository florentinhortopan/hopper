export const SITE_AUTH_COOKIE = "attatta_site_auth";

/** Shared site password from env (Vercel / .env). Empty = gate disabled. */
export function sitePassword(): string {
  return (
    process.env.SITE_PASSWORD?.trim() ||
    process.env.ATTATTA_SITE_PASSWORD?.trim() ||
    ""
  );
}

export function siteAuthEnabled(): boolean {
  return Boolean(sitePassword());
}

/** Edge + Node safe SHA-256 hex. */
export async function siteAuthToken(password = sitePassword()): Promise<string> {
  const data = new TextEncoder().encode(`attatta-site-v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function isValidSitePassword(candidate: string): Promise<boolean> {
  const expected = sitePassword();
  if (!expected) return true;
  const a = await siteAuthToken(candidate);
  const b = await siteAuthToken(expected);
  return safeEqualHex(a, b);
}

export async function isValidSiteAuthCookie(
  value: string | undefined,
): Promise<boolean> {
  if (!siteAuthEnabled()) return true;
  if (!value) return false;
  const expected = await siteAuthToken();
  return safeEqualHex(value, expected);
}
