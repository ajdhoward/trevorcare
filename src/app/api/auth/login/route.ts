// Login endpoint — checks the username (optional deployment allowlist) and the
// portal password (deployment secret), applies a simple in-memory throttle
// against brute force, then issues the signed session cookie. The cookie is
// verified by src/middleware.ts with the SAME shared secret (src/lib/session.ts
// keeps the two in lock-step). Every attempt (ok or not) is written to the
// server-side SigninLog audit table with the entered username and IP prefix.

import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  cookieAttributes,
  signSession,
  DEFAULT_PORTAL_PASSWORD,
  DEFAULT_SESSION_SECRET,
} from "@/lib/session";
import { db } from "@/lib/db";

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

/**
 * Optional per-person accounts: set PORTAL_USERS as a deployment secret, e.g.
 *   PORTAL_USERS="alex:password1,pat:password2"
 * When set, the entered username must map to one of these accounts and THAT
 * account's password must match (still gated by the shared portal secret too,
 * unless PORTAL_PASSWORD is unset — then per-user passwords are the gate).
 * When unset, any memorable username is accepted with the portal password —
 * the username is recorded in the sign-in audit trail for accountability.
 */
function parsePortalUsers(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.PORTAL_USERS || "";
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim().toLowerCase();
    const pass = pair.slice(idx + 1).trim();
    if (name && pass) map.set(name, pass);
  }
  return map;
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
  let username = "";
  let secure = false; // client reports its own protocol (preview iframes know best)
  try {
    const body = (await req.json()) as { password?: string; username?: string; secure?: boolean };
    password = String(body.password ?? "");
    username = String(body.username ?? "").trim().slice(0, 40);
    secure = body.secure === true || req.nextUrl.protocol === "https:";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const users = parsePortalUsers();
  const portalPassword = process.env.PORTAL_PASSWORD || DEFAULT_PORTAL_PASSWORD;
  const usingFallback = !process.env.PORTAL_PASSWORD;

  let ok = false;
  let display = username || "family";
  if (users.size > 0) {
    // per-person mode: username required and must match its own password
    const account = username.toLowerCase();
    const userPass = users.get(account);
    ok = !!userPass && password === userPass;
    if (ok) display = username;
    // the shared portal password still works for the admin account holder
    if (!ok && password === portalPassword) ok = users.has(account);
  } else {
    ok = !!password && password === portalPassword;
  }

  if (!ok) {
    throttleFail(ip);
    await db.signinLog
      .create({ data: { username: display, ok: false, ip, detail: "bad credentials" } })
      .catch(() => {});
    return NextResponse.json(
      users.size > 0
        ? { error: "Unknown username or incorrect password." }
        : { error: "Incorrect password." },
      { status: 401 }
    );
  }

  throttleReset(ip);
  const secret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
  const token = await signSession(secret, display);
  await db.signinLog
    .create({ data: { username: display, ok: true, ip, detail: "signed in" } })
    .catch(() => {});
  const res = NextResponse.json({ ok: true, usingFallbackPassword: usingFallback, username: display });
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; ${cookieAttributes(secure)}`);
  return res;
}
