import { NextResponse, type NextRequest } from "next/server";
import {
  SITE_AUTH_COOKIE,
  isValidSiteAuthCookie,
  siteAuthEnabled,
} from "./lib/siteAuth";

export async function middleware(req: NextRequest) {
  if (!siteAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/logout") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SITE_AUTH_COOKIE)?.value;
  if (await isValidSiteAuthCookie(cookie)) {
    return NextResponse.next();
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  if (pathname !== "/") {
    login.searchParams.set("next", pathname);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
