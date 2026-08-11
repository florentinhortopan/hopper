import { NextResponse } from "next/server";
import {
  SITE_AUTH_COOKIE,
  isValidSitePassword,
  siteAuthEnabled,
  siteAuthToken,
} from "@/lib/siteAuth";

export async function POST(req: Request) {
  if (!siteAuthEnabled()) {
    return NextResponse.json({ ok: true, gated: false });
  }

  let password = "";
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      password?: string;
    } | null;
    password = String(body?.password || "");
  } else {
    const form = await req.formData().catch(() => null);
    password = String(form?.get("password") || "");
  }

  const accept = req.headers.get("accept") || "";
  const wantsHtml =
    accept.includes("text/html") || contentType.includes("form");

  if (!(await isValidSitePassword(password))) {
    if (wantsHtml) {
      const url = new URL("/login", req.url);
      url.searchParams.set("error", "1");
      return NextResponse.redirect(url, 303);
    }
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  let nextPath = "/";
  try {
    const n = new URL(req.url).searchParams.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) nextPath = n;
  } catch {
    /* ignore */
  }

  const res = contentType.includes("application/json")
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(nextPath, req.url), 303);

  res.cookies.set(SITE_AUTH_COOKIE, await siteAuthToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
