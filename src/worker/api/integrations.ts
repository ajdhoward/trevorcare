// PIM integrations — ported from:
//   src/app/api/integrations/route.ts                        → GET/POST /api/integrations
//   src/app/api/integrations/[id]/route.ts                   → POST/DELETE /api/integrations/:id
//   src/app/api/integrations/ics/route.ts                    → POST /api/integrations/ics
//   src/app/api/integrations/oauth/start/route.ts            → GET /api/integrations/oauth/start
//   src/app/api/integrations/oauth/callback/[provider]/route.ts
//                                                            → GET /api/integrations/oauth/callback/:provider
//
// Parity notes:
// - src/lib/pim.ts is pure TypeScript (no node/next/prisma imports) so it is
//   imported directly: PIM_PROVIDERS, parseIcs, parseVCard.
// - The token column NEVER ships to the client (original set token: undefined
//   on every response); GET list rows add hasToken, POST/DELETE rows don't
//   (exactly like the original). `config` stays a JSON-encoded STRING.
// - DELETE on a missing id mirrors Prisma P2025 → withSession catch:
//   500 { ok:false, error:"Server error — see logs." } (same for the sync
//   route's catch behaviour — Google/Microsoft syncs have NO res.ok check,
//   mirroring the original's quirk of reporting 0 calendars on HTTP errors
//   with a JSON body).
// - The OAuth callback answers with the SAME styled HTML page (window.close
//   script) as the original — not a redirect.
// - OAuth client id/secret env vars (GOOGLE_CLIENT_ID/…SECRET,
//   APPLE_CLIENT_ID/…SECRET, MICROSOFT_CLIENT_ID/…SECRET) are read off env
//   with a cast — the integrator must add them to Env/wrangler secrets for
//   oauthReady/consent-URL/token-exchange to activate.
// - Route order: the static /api/integrations/ics is registered BEFORE the
//   dynamic /api/integrations/:id (the Worker router matches in order; Next.js
//   prefers static segments).

import { route, type Handler, type RequestContext } from "../router";
import { cuid, fail, json, nowIso } from "../util";
import { PIM_PROVIDERS, parseIcs, parseVCard, type PimProviderInfo } from "../../lib/pim";

// ---------------------------------------------------------------------------
// D1 row (migrations/0001_init.sql — pim_integrations)
// ---------------------------------------------------------------------------

interface PimIntegrationRow {
  id: string;
  provider: string;
  kind: string;
  status: string;
  account: string;
  config: string;
  token: string;
  last_sync_at: string | null;
  last_result: string;
  created_at: string;
  updated_at: string;
}

/** Row → client JSON minus the token (original: { ...r, token: undefined }). */
function toIntegration(row: PimIntegrationRow): Record<string, unknown> {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    status: row.status,
    account: row.account,
    config: row.config,
    lastSyncAt: row.last_sync_at,
    lastResult: row.last_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Ported from src/lib/server/guard.ts — SSRF guard + fetch with timeout/size cap
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

function assertPublicUrl(raw: string): URL {
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

async function safeFetch(
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

/** OAuth deployment credentials live in env vars (secrets) — read via cast. */
function envVar(env: RequestContext["env"], name: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[name];
}

// ---------------------------------------------------------------------------
// GET /api/integrations — list (seeding the three providers on first call)
// ---------------------------------------------------------------------------

async function seedOnce(DB: D1Database): Promise<void> {
  const count = await DB.prepare("SELECT COUNT(*) AS n FROM pim_integrations").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  for (const p of PIM_PROVIDERS) {
    await DB.prepare(
      `INSERT INTO pim_integrations
       (id, provider, kind, status, account, config, token, last_sync_at, last_result, created_at, updated_at)
       VALUES (?, ?, 'calendar', 'disconnected', '', '{}', '', NULL, '', ?, ?)
       ON CONFLICT (provider, kind) DO NOTHING`
    )
      .bind(cuid(), p.id, nowIso(), nowIso())
      .run();
  }
}

const listIntegrations: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  await seedOnce(DB);
  const rows = await DB.prepare("SELECT * FROM pim_integrations ORDER BY created_at ASC").all<PimIntegrationRow>();
  const providers = PIM_PROVIDERS.map((p) => ({
    ...p,
    oauthReady: Boolean(envVar(ctx.env, p.envClient)) && Boolean(envVar(ctx.env, p.envSecret)),
  }));
  const integrations = (rows.results ?? []).map((r) => ({
    ...toIntegration(r),
    hasToken: Boolean(r.token),
  }));
  return json({ ok: true, providers, integrations });
};

// ---------------------------------------------------------------------------
// POST /api/integrations — connect/disconnect by account + ICS feed URL
// ---------------------------------------------------------------------------

const saveIntegration: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = String(body.provider || "");
  if (!PIM_PROVIDERS.some((p) => p.id === provider)) {
    return fail("Unknown provider.", 400);
  }
  const account = String(body.account || "").slice(0, 120);
  const feedUrl = String(body.feedUrl || "").trim();
  const status = feedUrl || account ? "connected" : "disconnected";
  const config = JSON.stringify({ feedUrl, connectedAt: new Date().toISOString() });
  const lastResult = feedUrl ? "Feed saved — run 'Sync now'." : "Saved.";

  const existing = await DB.prepare("SELECT id FROM pim_integrations WHERE provider = ? AND kind = 'calendar'")
    .bind(provider)
    .first<{ id: string }>();
  let id: string;
  if (existing) {
    id = existing.id;
    await DB.prepare(
      "UPDATE pim_integrations SET account = ?, status = ?, config = ?, last_result = ?, updated_at = ? WHERE id = ?"
    )
      .bind(account, status, config, lastResult, nowIso(), id)
      .run();
  } else {
    id = cuid();
    await DB.prepare(
      `INSERT INTO pim_integrations
       (id, provider, kind, status, account, config, token, last_sync_at, last_result, created_at, updated_at)
       VALUES (?, ?, 'calendar', ?, ?, ?, '', NULL, ?, ?, ?)`
    )
      .bind(id, provider, status, account, config, lastResult, nowIso(), nowIso())
      .run();
  }
  const row = await DB.prepare("SELECT * FROM pim_integrations WHERE id = ?").bind(id).first<PimIntegrationRow>();
  return json({ ok: true, integration: row ? toIntegration(row) : { id } });
};

// ---------------------------------------------------------------------------
// POST /api/integrations/:id — sync now (ICS feed → parsed events / OAuth pull
// when credentials exist and the connect flow exchanged a token)
// ---------------------------------------------------------------------------

const syncIntegration: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const row = await DB.prepare("SELECT * FROM pim_integrations WHERE id = ?").bind(id).first<PimIntegrationRow>();
  if (!row) return fail("Not found", 404);

  let config: { feedUrl?: string } = {};
  try {
    config = JSON.parse(row.config || "{}") as { feedUrl?: string };
  } catch {
    config = {};
  }

  if (config.feedUrl) {
    try {
      const res = await safeFetch(config.feedUrl, { timeoutMs: 12_000 });
      if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
      const text = await res.text();
      const { events, errors } = parseIcs(text);
      await DB.prepare(
        "UPDATE pim_integrations SET last_sync_at = ?, last_result = ?, status = 'connected', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), `${events.length} event(s) pulled from feed${errors.length ? ` — ${errors[0]}` : ""}`, nowIso(), id)
        .run();
      return json({ ok: true, events, errors, source: "feed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await DB.prepare(
        "UPDATE pim_integrations SET last_sync_at = ?, last_result = ?, status = 'error', updated_at = ? WHERE id = ?"
      )
        .bind(nowIso(), `Sync failed: ${msg}`, nowIso(), id)
        .run();
      return json({ ok: false, error: `Sync failed: ${msg}` }, 502);
    }
  }

  if (row.token) {
    // Native OAuth pull (works once deployment credentials exist and the
    // connect flow exchanged a token). Google Calendar list + events.
    if (row.provider === "google") {
      try {
        const res = await safeFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${row.token}` },
          timeoutMs: 12_000,
        });
        const data = (await res.json()) as { items?: Array<{ id: string; summary: string }> };
        await DB.prepare(
          "UPDATE pim_integrations SET last_sync_at = ?, last_result = ?, status = 'connected', updated_at = ? WHERE id = ?"
        )
          .bind(nowIso(), `Google: ${data.items?.length ?? 0} calendar(s) visible`, nowIso(), id)
          .run();
        return json({ ok: true, calendars: data.items ?? [], source: "google-oauth" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await DB.prepare(
          "UPDATE pim_integrations SET status = 'error', last_result = ?, updated_at = ? WHERE id = ?"
        )
          .bind(`Sync failed: ${msg}`, nowIso(), id)
          .run();
        return json({ ok: false, error: msg }, 502);
      }
    }
    if (row.provider === "microsoft") {
      try {
        const res = await safeFetch("https://graph.microsoft.com/v1.0/me/calendars", {
          headers: { Authorization: `Bearer ${row.token}` },
          timeoutMs: 12_000,
        });
        const data = (await res.json()) as { value?: Array<{ id: string; name: string }> };
        await DB.prepare(
          "UPDATE pim_integrations SET last_sync_at = ?, last_result = ?, status = 'connected', updated_at = ? WHERE id = ?"
        )
          .bind(nowIso(), `Microsoft Graph: ${data.value?.length ?? 0} calendar(s)`, nowIso(), id)
          .run();
        return json({ ok: true, calendars: data.value ?? [], source: "graph" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await DB.prepare(
          "UPDATE pim_integrations SET status = 'error', last_result = ?, updated_at = ? WHERE id = ?"
        )
          .bind(`Sync failed: ${msg}`, nowIso(), id)
          .run();
        return json({ ok: false, error: msg }, 502);
      }
    }
  }

  return json({
    ok: false,
    error:
      "Nothing to sync yet — add an iCloud/ICS feed URL, or complete the OAuth setup (see the provider card's setup notes) so the portal can exchange a token.",
  }, 400);
};

// ---------------------------------------------------------------------------
// DELETE /api/integrations/:id — disconnect
// ---------------------------------------------------------------------------

const disconnectIntegration: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  // Prisma's update throws on a missing row → the original's withSession catch
  // answered 500 "Server error — see logs." — mirrored here.
  const existing = await DB.prepare("SELECT id FROM pim_integrations WHERE id = ?").bind(id).first<{ id: string }>();
  if (!existing) return fail("Server error — see logs.", 500);
  await DB.prepare(
    "UPDATE pim_integrations SET status = 'disconnected', account = '', config = '{}', token = '', last_result = 'Disconnected.', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();
  const row = await DB.prepare("SELECT * FROM pim_integrations WHERE id = ?").bind(id).first<PimIntegrationRow>();
  return json({ ok: true, integration: row ? toIntegration(row) : { id } });
};

// ---------------------------------------------------------------------------
// POST /api/integrations/ics — ICS / vCard import (paste or upload). This is
// the works-today sync path for Google Takeout, Apple iCloud exports and
// Outlook exports.
// ---------------------------------------------------------------------------

const importIcs: Handler = async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { text?: string; format?: string };
  const text = String(body.text || "");
  if (!text.trim()) {
    return fail("Paste the .ics or .vcf contents (or use a feed URL).", 400);
  }
  const looksVcard = /BEGIN:VCARD/i.test(text.slice(0, 400));
  const format = body.format === "vcard" || looksVcard ? "vcard" : "ics";

  if (format === "vcard") {
    const contacts = parseVCard(text);
    await ctx.env.DB.prepare(
      "UPDATE pim_integrations SET last_result = ?, updated_at = ? WHERE kind = 'calendar'"
    )
      .bind(`vCard import: ${contacts.length} contact(s) parsed (client-side list)`, nowIso())
      .run();
    return json({ ok: true, format, contacts });
  }

  const { events, errors } = parseIcs(text);
  return json({ ok: true, format, events, errors });
};

// ---------------------------------------------------------------------------
// GET /api/integrations/oauth/start?provider=google — builds the provider
// consent URL from deployment credentials. If credentials are not configured,
// returns a clear setup message instead of a broken redirect.
// ---------------------------------------------------------------------------

function oauthSetupError(p: PimProviderInfo): string {
  return `${p.label}: OAuth is not configured on this deployment yet. ${p.setupNotes}`;
}

const oauthStart: Handler = async (ctx) => {
  const provider = ctx.url.searchParams.get("provider") || "";
  const p = PIM_PROVIDERS.find((x) => x.id === provider);
  if (!p) return fail("Unknown provider", 400);

  const clientId = envVar(ctx.env, p.envClient);
  const clientSecret = envVar(ctx.env, p.envSecret);
  if (!clientId || !clientSecret || !p.authEndpoint) {
    return json({ ok: false, setup: true, error: oauthSetupError(p) }, 400);
  }

  const origin = ctx.url.origin;
  const redirectUri = `${origin}/api/integrations/oauth/callback/${p.id}`;
  const url = new URL(p.authEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scopes || "");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (p.id === "microsoft") url.searchParams.set("response_mode", "query");
  return json({ ok: true, consentUrl: url.toString() });
};

// ---------------------------------------------------------------------------
// GET /api/integrations/oauth/callback/:provider — exchanges the authorisation
// code for a token, stores it server-side on the integration row, and closes
// the popup window (same styled HTML response as the original).
// ---------------------------------------------------------------------------

const oauthCallback: Handler = async (ctx) => {
  const provider = ctx.params.provider;
  const p = PIM_PROVIDERS.find((x) => x.id === provider);
  const origin = ctx.url.origin;
  const html = (msg: string, ok: boolean) =>
    new Response(
      `<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;background:#071a16;color:#d1fae5"><div style="max-width:30rem;text-align:center"><h1 style="font-size:1.2rem">${ok ? "Connected" : "Not connected"}</h1><p style="line-height:1.5">${msg}</p><p><a href="/" style="color:#5eead4">Return to the hub</a></p><script>setTimeout(()=>window.close(),4000)</script></div></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );

  if (!p) return html("Unknown provider.", false);

  const code = ctx.url.searchParams.get("code");
  const error = ctx.url.searchParams.get("error");
  if (error) return html(`The provider returned: ${error}`, false);
  if (!code) return html("No authorisation code was returned.", false);

  const clientId = envVar(ctx.env, p.envClient);
  const clientSecret = envVar(ctx.env, p.envSecret);
  if (!clientId || !clientSecret || !p.tokenEndpoint) {
    return html(`${p.label} OAuth credentials are not configured — ${p.setupNotes}`, false);
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/api/integrations/oauth/callback/${p.id}`,
    });
    if (p.id === "microsoft") body.set("scope", p.scopes || "");
    const res = await safeFetch(p.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs: 15_000,
    });
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      return html(`Token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`, false);
    }
    const row = await ctx.env.DB.prepare(
      "SELECT id FROM pim_integrations WHERE provider = ? AND kind = 'calendar'"
    )
      .bind(p.id)
      .first<{ id: string }>();
    if (row) {
      await ctx.env.DB.prepare(
        "UPDATE pim_integrations SET token = ?, status = 'connected', last_result = ?, updated_at = ? WHERE id = ?"
      )
        .bind(data.access_token, "OAuth connected — run 'Sync now'.", nowIso(), row.id)
        .run();
    }
    return html(`${p.label} connected. You can close this window.`, true);
  } catch (e) {
    return html(`Token exchange error: ${e instanceof Error ? e.message : String(e)}`, false);
  }
};

// ---------------------------------------------------------------------------

export function registerIntegrationRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/integrations", listIntegrations);
  routeFn("POST", "/api/integrations", saveIntegration);
  // static segments before the dynamic :id route (the router matches in order)
  routeFn("POST", "/api/integrations/ics", importIcs);
  routeFn("GET", "/api/integrations/oauth/start", oauthStart);
  routeFn("GET", "/api/integrations/oauth/callback/:provider", oauthCallback);
  routeFn("POST", "/api/integrations/:id", syncIntegration);
  routeFn("DELETE", "/api/integrations/:id", disconnectIntegration);
}
