// Login endpoint — checks the portal password (deployment secret), applies a
// simple in-memory throttle against brute force, then issues the signed
// session cookie. The cookie is verified by src/middleware.ts with the SAME
// shared secret (src/lib/session.ts keeps the two in lock-step).

import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  cookieAttributes,
  signSession,
  DEFAULT_PORTAL_PASSWORD,
  DEFAULT_SESSION_SECRET,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// ---- naive throttle: 5 failures / 10 minutes per IP (demo-grade) ----------
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

function throttleCheck(ip: string): { blocked: boolean; retryAfterMin: number } {
  const now = Date.now();
  const list = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_FAILS) {
    return { blocked: true, retryAfterMin: Math.ceil((WINDOW_MS - (now - list[0])) / 60000) };
  }
  return { blocked: false, retryAfterMin: 0 };
}

function throttleFail(ip: string) {
  const now = Date.now();
  const list = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  fails.set(ip, list);
}

function throttleReset(ip: string) {
  fails.delete(ip);
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";

  const { blocked, retryAfterMin } = throttleCheck(ip);
  if (blocked) {
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in about ${retryAfterMin} minute(s).` },
      { status: 429 }
    );
  }

  let password = "";
  let secure = false; // client reports its own protocol (preview iframes know best)
  try {
    const body = (await req.json()) as { password?: string; secure?: boolean };
    password = String(body.password ?? "");
    secure = body.secure === true || req.nextUrl.protocol === "https:";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const expected = process.env.PORTAL_PASSWORD || DEFAULT_PORTAL_PASSWORD;
  const usingFallback = !process.env.PORTAL_PASSWORD;

  if (!password || password !== expected) {
    throttleFail(ip);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  throttleReset(ip);
  const secret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
  const token = await signSession(secret, "family");
  const res = NextResponse.json({ ok: true, usingFallbackPassword: usingFallback });
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieAttributes(secure)}`);
  return res;
}
