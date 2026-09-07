// Fail-closed portal gate — every page, asset and API call requires a valid
// signed session cookie. Exceptions (all with their own controls):
//   /login, /api/auth/*   → the gate itself
//   /share, /api/share    → time-boxed, revocable token links for advisers
//   /_next/static, favicon → build assets only (no data)
// Unauthenticated page requests are redirected to /login?next=…; API requests
// get a 401 JSON response. See docs/SECURITY.md.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, DEFAULT_SESSION_SECRET } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/share",
  "/api/share",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(secret, token);

  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in. Sign in at /login to use the portal API." },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // everything except Next.js build assets
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
