// Trevorcare — the ONE Worker.
//
// Serves every /api/* route (the Next.js static export has no server), plus
// cron (alert digests), inbound email and the WhatsApp queue consumer.
// Static pages are served by the Workers Assets layer (see wrangler.jsonc:
// run_worker_first only routes /api/* here).
//
// Auth model (per deployment spec):
//   1. Cloudflare Access fronts the portal — the Worker reads
//      Cf-Access-Authenticated-User-Email and auto-provisions the user.
//   2. Dev/self-host fallback: the legacy signed session cookie still works
//      so the existing /login flow (and local `wrangler dev`) keeps working
//      until Access is enabled.
//
// Secrets: ENGINE_SHARED_KEY / AUDIT_HMAC_KEY / WEBHOOK_SECRET auto-generate
// on first run (crypto.getRandomValues → D1 app_secrets) — nothing to paste.
// Only WHAPI_TOKEN is ever entered manually.

import {
  matchRoute,
  route,
  type Env,
  type RequestContext,
} from "./router";
import { cuid as cuidForLog, fail, json } from "./util";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSessionCookie,
  ensureUserRow,
  resolveActor,
} from "./auth";
import { registerSubjectRoutes } from "./api/subjects";

// ---------------------------------------------------------------------------

export type { Env } from "./router";

// ---------------------------------------------------------------------------
// API routes — core
// ---------------------------------------------------------------------------

route("GET", "/api", async ({ env }) => json({ ok: true, portal: env.PORTAL_NAME || "Trevorcare", version: "cf-1.0" }), { public: true });

route("GET", "/api/auth/status", async ({ req, env }) => {
  const hasAccess = Boolean(req.headers.get("Cf-Access-Authenticated-User-Email"));
  const usingFallbackPassword = !env.PORTAL_PASSWORD;
  return json({ ok: true, access: hasAccess, usingFallbackPassword });
}, { public: true });

route("POST", "/api/auth/login", async ({ req, env }) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const username = String(body.username || "").trim() || "family";
  const password = String(body.password || "");
  const secure = Boolean(body.secure);

  const expected = env.PORTAL_PASSWORD || "demo"; // parity with the legacy demo fallback
  const usingFallbackPassword = !env.PORTAL_PASSWORD;
  if (password !== expected) {
    await env.DB.prepare(
      "INSERT INTO signin_log (id, username, ok, ip, detail, ts) VALUES (?, ?, 0, ?, ?, ?)"
    ).bind(cuidForLog(), username, "", "wrong password", new Date().toISOString()).run();
    return fail("Incorrect password.", 401);
  }
  await env.DB.prepare(
    "INSERT INTO signin_log (id, username, ok, ip, detail, ts) VALUES (?, ?, 1, ?, ?, ?)"
  ).bind(cuidForLog(), username, "", "legacy session", new Date().toISOString()).run();

  const cookie = await createSessionCookie(env, username);
  const attrs = `Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return json({ ok: true, usingFallbackPassword }, 200, { "Set-Cookie": `${SESSION_COOKIE}=${cookie}; ${attrs}` });
}, { public: true });

route("POST", "/api/auth/logout", async () => {
  return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
}, { public: true });

// API modules (C2 continues here — one file per domain under src/worker/api/)
registerSubjectRoutes(route);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      // Assets layer normally handles these (run_worker_first is /api/* only);
      // reached only via direct workers.dev hits without assets bound.
      return env.ASSETS ? env.ASSETS.fetch(request) : fail("Not found", 404);
    }

    const match = matchRoute(request.method, pathname);
    if (!match) return fail(`No route for ${request.method} ${pathname}`, 404);

    const { actor, via } = await resolveActor(request, env);
    if (!match.isPublic && !actor) {
      return json(
        { ok: false, error: "Sign in to continue.", auth: "required" },
        401,
        { "WWW-Authenticate": "Session" }
      );
    }
    if (via === "access") await ensureUserRow(env, actor);

    const ctx: RequestContext = { req: request, env, url, params: match.params, actor, via };
    try {
      return await match.handler(ctx);
    } catch (e) {
      return fail(`Worker error: ${e instanceof Error ? e.message : String(e)}`, 500);
    }
  },

  // C4 — alert digest twice daily (08:00 / 20:00 UTC)
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // implemented in batch C4
  },

  // C4 — inbound care email → inbound_messages
  async email(_message: ForwardableEmailMessage, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // implemented in batch C4
  },

  // C4 — WhatsApp webhook batches → inbound_messages
  async queue(_batch: MessageBatch, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // implemented in batch C4
  },
} satisfies ExportedHandler<Env>;
