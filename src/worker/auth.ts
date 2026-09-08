// Auth for the Trevorcare Worker.
//
// 1. Cloudflare Access (production): the portal sits behind Access email OTP;
//    the Worker trusts Cf-Access-Authenticated-User-Email and auto-provisions
//    the address into `users` with the viewer role (an admin promotes later).
// 2. Legacy session fallback (dev / pre-Access): the signed HMAC cookie the
//    original Next.js middleware issued — same cookie name, same payload —
//    so the existing /login flow and local `wrangler dev` keep working.

import type { RequestContext } from "./router";
import { b64url, cuid, getOrCreateSecret, hmac, nowIso, unb64url } from "./util";

const SESSION_COOKIE = "care_session";
const SESSION_DAYS = 30;

async function sessionSigningSecret(env: {
  DB: D1Database;
  SESSION_SECRET?: string;
}): Promise<string> {
  return getOrCreateSecret(env, "session_secret");
}

async function createSessionCookie(env: { DB: D1Database; SESSION_SECRET?: string }, username: string): Promise<string> {
  const payload = b64url(JSON.stringify({ e: Date.now() + SESSION_DAYS * 864e5, n: username }));
  const sig = await hmac(await sessionSigningSecret(env), payload);
  return `${payload}.${sig}`;
}

async function verifySession(
  env: { DB: D1Database; SESSION_SECRET?: string },
  cookieValue: string | undefined
): Promise<string | null> {
  if (!cookieValue || !cookieValue.includes(".")) return null;
  const [payload, sig] = cookieValue.split(".");
  const expected = await hmac(await sessionSigningSecret(env), payload);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(unb64url(payload)) as { e: number; n?: string };
    if (typeof parsed.e !== "number" || parsed.e < Date.now()) return null;
    return parsed.n || "family";
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > -1 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return undefined;
}

async function resolveActor(
  req: Request,
  env: { DB: D1Database; SESSION_SECRET?: string }
): Promise<{ actor: string; via: RequestContext["via"] }> {
  const accessEmail = req.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) return { actor: accessEmail, via: "access" };
  const sessionUser = await verifySession(env, readCookie(req, SESSION_COOKIE));
  if (sessionUser) return { actor: sessionUser, via: "session" };
  return { actor: "", via: "public" };
}

/** Auto-provision an Access user into `users` (viewer role; admin promotes). */
async function ensureUserRow(env: { DB: D1Database }, email: string): Promise<void> {
  if (!email) return;
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, created_at, updated_at)
     VALUES (?, ?, ?, 'viewer', ?, ?)
     ON CONFLICT(email) DO NOTHING`
  )
    .bind(cuid(), email, email.split("@")[0] ?? "", nowIso(), nowIso())
    .run();
}

export {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSessionCookie,
  verifySession,
  readCookie,
  resolveActor,
  ensureUserRow,
};
