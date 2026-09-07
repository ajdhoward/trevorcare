// Server-side session guard for API route handlers.
// The middleware already gates every route fail-closed; this helper re-verifies
// the session inside handlers that touch stored personal data, so a middleware
// bypass or misconfiguration can never expose the vault, finance or subject
// tables. Returns the verified payload or null (respond 401 at the call site).

import { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function sessionOf(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySession(process.env.SESSION_SECRET, token);
}

export function unauthorized(detail = "Sign in to continue.") {
  return Response.json({ ok: false, error: detail }, { status: 401 });
}

/** Guard wrapper: runs the handler only with a verified session payload. */
export async function withSession(
  req: NextRequest,
  fn: (session: NonNullable<Awaited<ReturnType<typeof sessionOf>>>) => Promise<Response>
): Promise<Response> {
  const session = await sessionOf(req);
  if (!session) return unauthorized();
  try {
    return await fn(session);
  } catch (e) {
    console.error("[api]", e);
    return Response.json({ ok: false, error: "Server error — see logs." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// SSRF guard (CODE_REVIEW C4): outbound fetches (AI adapters, ICS import,
// MCP servers, research fetcher) must never target private networks.
// ---------------------------------------------------------------------------

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fe80:/i,
  /\.local$/i,
  /^metadata\./i, // cloud metadata endpoints
];

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("Private or reserved hosts are blocked");
  }
  return u;
}

/** fetch() with the SSRF guard, a timeout and a response size cap. */
export async function safeFetch(
  raw: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {}
): Promise<Response> {
  const url = assertPublicUrl(raw);
  const { timeoutMs = 15_000, maxBytes = 2_000_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal, redirect: "follow" });
    const len = Number(res.headers.get("content-length") || "0");
    if (len > maxBytes) throw new Error(`Response too large (${len} bytes)`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
