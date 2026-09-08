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
import { cuid as cuidForLog, fail, json, nowIso } from "./util";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSessionCookie,
  ensureUserRow,
  resolveActor,
} from "./auth";
import { registerSubjectRoutes } from "./api/subjects";
import { registerFeedRoutes } from "./api/feeds";
import { registerShareRoutes } from "./api/share";
import { registerFactRoutes } from "./api/facts";
import { registerWizardRoutes } from "./api/wizards";
import { registerVaultRoutes } from "./api/vault";
import { registerFinanceRoutes } from "./api/finance";
import { registerAiRoutes } from "./api/ai";
import { registerMcpRoutes } from "./api/mcp";
import { registerResearchRoutes } from "./api/research";
import { registerWhapiRoutes } from "./api/whapi";
import { registerIntegrationRoutes } from "./api/integrations";
import { ingestWhapiPayloads } from "./api/whapi";

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

// API modules (C2) — one file per domain under src/worker/api/
registerSubjectRoutes(route);
registerFeedRoutes(route);
registerShareRoutes(route);
registerFactRoutes(route);
registerWizardRoutes(route);
registerVaultRoutes(route);
registerFinanceRoutes(route);
registerAiRoutes(route);
registerMcpRoutes(route);
registerResearchRoutes(route);
registerWhapiRoutes(route);
registerIntegrationRoutes(route);

// ---------------------------------------------------------------------------
// C4 — scheduled alert digest: evaluates every enabled alert rule against the
// live D1 data and records the computed state as an alert_event. Rule kinds:
//   no-checkin  — no WhatsApp inbound in the last N hours     → alert
//   call-spike  — more than N inbound messages in M minutes   → alert/warning
//   stale-data  — no new care posts in the last N days        → warning
// The digest never throws: one malformed rule must not fail the cron run.
// ---------------------------------------------------------------------------

function parseJsonObject(raw: unknown): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(String(raw ?? "{}"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function runAlertDigest(env: Env): Promise<number> {
  const rules = await env.DB.prepare("SELECT * FROM alert_rules WHERE enabled = 1")
    .all<{ id: string; subject_id: string; kind: string; config: string }>();
  let evaluated = 0;
  for (const rule of rules.results ?? []) {
    const cfg = parseJsonObject(rule.config);
    const now = Date.now();
    let state = "ok";
    const detail: Record<string, unknown> = {};
    try {
      if (rule.kind === "no-checkin") {
        const hours = Number(cfg.hours ?? 12);
        const since = new Date(now - hours * 3_600_000).toISOString();
        const r = await env.DB
          .prepare("SELECT COUNT(*) AS n FROM inbound_messages WHERE source = 'whatsapp' AND ts >= ?")
          .bind(since)
          .first<{ n: number }>();
        detail.hours = hours;
        detail.inbound = r?.n ?? 0;
        if ((r?.n ?? 0) === 0) state = "alert";
      } else if (rule.kind === "call-spike") {
        const minutes = Number(cfg.minutes ?? 30);
        const threshold = Number(cfg.threshold ?? 20);
        const since = new Date(now - minutes * 60_000).toISOString();
        const r = await env.DB
          .prepare("SELECT COUNT(*) AS n FROM inbound_messages WHERE ts >= ?")
          .bind(since)
          .first<{ n: number }>();
        detail.minutes = minutes;
        detail.threshold = threshold;
        detail.inbound = r?.n ?? 0;
        if ((r?.n ?? 0) > threshold) state = "alert";
        else if ((r?.n ?? 0) * 2 > threshold) state = "warning";
      } else if (rule.kind === "stale-data") {
        const days = Number(cfg.days ?? 14);
        const since = new Date(now - days * 86_400_000).toISOString();
        const r = await env.DB
          .prepare("SELECT COUNT(*) AS n FROM posts WHERE created_at >= ?")
          .bind(since)
          .first<{ n: number }>();
        detail.days = days;
        detail.newPosts = r?.n ?? 0;
        if ((r?.n ?? 0) === 0) state = "warning";
      }
    } catch (e) {
      detail.error = e instanceof Error ? e.message : String(e);
    }
    await env.DB.prepare(
      "INSERT INTO alert_events (id, rule_id, subject_id, state, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(cuidForLog(), rule.id, rule.subject_id ?? "", state, JSON.stringify(detail), nowIso())
      .run();
    await env.DB
      .prepare("UPDATE alert_rules SET last_state = ?, last_run_at = ?, updated_at = ? WHERE id = ?")
      .bind(state, nowIso(), nowIso(), rule.id)
      .run();
    evaluated++;
  }
  return evaluated;
}

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

  // C4 — alert digest twice daily (08:00 / 20:00 UTC): evaluates alert_rules
  // against live data and records alert_events. Never throws.
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await runAlertDigest(env);
    } catch (e) {
      console.error("[scheduled] alert digest failed:", e instanceof Error ? e.message : e);
    }
  },

  // C4 — inbound care email → inbound_messages (source 'email').
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const raw = await new Response(message.raw).text();
      await env.DB.prepare(
        `INSERT INTO inbound_messages
         (id, source, group_id, group_name, sender, subject, body, msg_id, ts, processed, created_at)
         VALUES (?, 'email', '', ?, ?, ?, ?, ?, ?, 0, ?)`
      )
        .bind(
          cuidForLog(),
          message.to,
          message.from,
          message.to,
          raw.slice(0, 4000),
          `email-${Date.now()}`,
          nowIso(),
          nowIso()
        )
        .run();
    } catch (e) {
      console.error("[email] ingest failed:", e instanceof Error ? e.message : e);
    }
  },

  // C4 — WhatsApp webhook batches: ingest each payload into inbound_messages
  // (deduped by the UNIQUE (source, msg_id) index). A failed message retries
  // the whole batch with a delay; successful batches ack automatically.
  async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body as Record<string, unknown> | null;
        await ingestWhapiPayloads(env, body && typeof body === "object" ? body : {});
      } catch (e) {
        console.error("[queue] ingest failed, retrying batch:", e instanceof Error ? e.message : e);
        batch.retryAll({ delaySeconds: 30 });
        return;
      }
    }
  },
} satisfies ExportedHandler<Env>;
