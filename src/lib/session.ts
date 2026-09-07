// Shared session module — signed, HTTP-only cookie sessions for the portal
// gate. Used by BOTH the middleware (verification) and the login/logout API
// routes (signing / clearing) so the secret can never drift apart again.
//
// Demo-grade HMAC-SHA256 over a tiny JSON payload {exp} using Web Crypto so the
// same code runs on the Edge runtime (middleware) and in Node route handlers.
// For production, rotate SESSION_SECRET as a deployment secret and consider a
// KV/D1-backed session table — see docs/SECURITY.md.

export const SESSION_COOKIE = "care_session";
export const SESSION_DAYS = 30;

export const DEFAULT_PORTAL_PASSWORD = "demo-password"; // shown on-screen while active
export const DEFAULT_SESSION_SECRET = "demo-session-secret::rotate-me";

function b64urlEncode(input: string): string {
  // JSON payload is ASCII-safe here ({e: number} + optional {n: name})
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return atob(input.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

export interface SessionPayload {
  e: number; // expiry (epoch ms)
  n?: string; // display hint (non-sensitive), optional
}

/** Sign a new session token valid for SESSION_DAYS. */
export async function signSession(secret: string, name?: string): Promise<string> {
  const payload: SessionPayload = {
    e: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    n: name ? name.slice(0, 40) : undefined,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

/** Verify a session token; returns the payload when valid, otherwise null. */
export async function verifySession(
  secret: string | undefined,
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = await hmac(secret, body);
    if (sig.length !== expected.length) return null;
    // constant-time-ish compare
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
    if (typeof payload.e !== "number" || payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes that survive both same-site tabs and embedded preview iframes.
 *  SameSite=None is only valid with Secure — plain-HTTP contexts must use Lax. */
export function cookieAttributes(secure?: boolean): string {
  const isProd = process.env.NODE_ENV === "production";
  const useSecure = secure || process.env.PORTAL_COOKIE_SECURE === "1" || isProd;
  if (useSecure) {
    return `Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; SameSite=None; Secure; Partitioned`;
  }
  return `Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `Path=/; Max-Age=0; HttpOnly; SameSite=None; Partitioned`;
}
