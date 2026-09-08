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

// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  CONSENT: KVNamespace;
  RATE_LIMIT: KVNamespace;
  DOCUMENTS: R2Bucket;
  AI: Ai;
  /** Absent on the $0 plan (Queues need Workers Paid) — ingest degrades to direct. */
  WHAPI_QUEUE?: Queue<Record<string, unknown>>;
  ASSETS: Fetcher;
  /** Legacy dev-fallback gate (optional secret). */
  PORTAL_PASSWORD?: string;
  /** Legacy cookie-signing secret (optional — auto-generated if unset). */
  SESSION_SECRET?: string;
  AI_GATEWAY_ID?: string;
  PORTAL_NAME?: string;
}

type Handler = (ctx: RequestContext) => Promise<Response>;

interface RequestContext {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** Authenticated identity: Access email, or legacy session username. */
  actor: string;
  /** How the request was authenticated. */
  via: "access" | "session" | "public";
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const fail = (error: string, status = 400): Response => json({ ok: false, error }, status);

const nowIso = (): string => new Date().toISOString();

/** cuid-shaped id: `c` + base36 ms + 8 base36 random chars. */
const cuid = (): string => {
  const ts = Date.now().toString(36);
  let rnd = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) rnd += b.toString(36);
  return `c${ts}${rnd.slice(0, 10)}`;
};

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const b64url = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (s: string): string =>
  atob(s.replace(/-/g, "+").replace(/_/g, "/"));

// ---------------------------------------------------------------------------
// Auto-generated worker secrets (app_secrets table) — persist across deploys
// ---------------------------------------------------------------------------

export async function getOrCreateSecret(env: Env, key: string): Promise<string> {
  const existing = await env.DB.prepare("SELECT value FROM app_secrets WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (existing) return existing.value;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    "INSERT INTO app_secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING"
  )
    .bind(key, value, nowIso())
    .run();
  // Read again in case of a race (another isolate inserted first).
  const row = await env.DB.prepare("SELECT value FROM app_secrets WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? value;
}

async function sessionSigningSecret(env: Env): Promise<string> {
  return env.SESSION_SECRET || (await getOrCreateSecret(env, "session_secret"));
}

// ---------------------------------------------------------------------------
// Auth — Access first, legacy session fallback
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "care_session";
const SESSION_DAYS = 30;

async function createSessionCookie(env: Env, username: string): Promise<string> {
  const payload = b64url(JSON.stringify({ e: Date.now() + SESSION_DAYS * 864e5, n: username }));
  const sig = await hmac(await sessionSigningSecret(env), payload);
  return `${payload}.${sig}`;
}

async function verifySession(env: Env, cookieValue: string | undefined): Promise<string | null> {
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

async function resolveActor(req: Request, env: Env): Promise<{ actor: string; via: RequestContext["via"] }> {
  const accessEmail = req.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) return { actor: accessEmail, via: "access" };
  const sessionUser = await verifySession(env, readCookie(req, SESSION_COOKIE));
  if (sessionUser) return { actor: sessionUser, via: "session" };
  return { actor: "", via: "public" };
}

/** Auto-provision an Access user into `users` (viewer role, admin promotes). */
async function ensureUserRow(env: Env, email: string): Promise<void> {
  if (!email) return;
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, created_at, updated_at)
     VALUES (?, ?, ?, 'viewer', ?, ?)
     ON CONFLICT(email) DO NOTHING`
  )
    .bind(cuid(), email, email.split("@")[0] ?? "", nowIso(), nowIso())
    .run();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes: Array<{ method: string; pattern: string; public?: boolean; handler: Handler }> = [];

function route(method: string, pattern: string, handler: Handler, opts?: { public?: boolean }): void {
  routes.push({ method, pattern, public: opts?.public, handler });
}

function matchRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const pp = r.pattern.split("/").filter(Boolean);
    const sp = pathname.split("/").filter(Boolean);
    if (pp.length !== sp.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
      else if (pp[i] !== sp[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

route("GET", "/api", async ({ env }) => json({ ok: true, portal: env.PORTAL_NAME || "Trevorcare", version: "cf-1.0" }), { public: true });

route("GET", "/api/auth/status", async ({ req, env }) => {
  const hasAccess = Boolean(req.headers.get("Cf-Access-Authenticated-User-Email"));
  const usingFallbackPassword = !env.PORTAL_PASSWORD;
  return json({ ok: true, access: hasAccess, usingFallbackPassword });
}, { public: true });

route("POST", "/api/auth/login", async ({ req, env }) => {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const username = String((body as { username?: string }).username || "").trim() || "family";
  const password = String((body as { password?: string }).password || "");
  const secure = Boolean((body as { secure?: boolean }).secure);

  const expected = env.PORTAL_PASSWORD || "demo"; // parity with the legacy demo fallback
  const usingFallbackPassword = !env.PORTAL_PASSWORD;
  if (password !== expected) {
    await env.DB.prepare(
      "INSERT INTO signin_log (id, username, ok, ip, detail, ts) VALUES (?, ?, 0, ?, ?, ?)"
    ).bind(cuid(), username, "", "wrong password", nowIso()).run();
    return fail("Incorrect password.", 401);
  }
  await env.DB.prepare(
    "INSERT INTO signin_log (id, username, ok, ip, detail, ts) VALUES (?, ?, 1, ?, ?, ?)"
  ).bind(cuid(), username, "", "legacy session", nowIso()).run();

  const cookie = await createSessionCookie(env, username);
  const attrs = `Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return json({ ok: true, usingFallbackPassword }, 200, { "Set-Cookie": `${SESSION_COOKIE}=${cookie}; ${attrs}` });
}, { public: true });

route("POST", "/api/auth/logout", async () => {
  return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
}, { public: true });

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
      // Assets layer normally handles these (run_worker_first is /api/* only);
      // reached only via direct workers.dev hits without assets bound.
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : fail("Not found", 404);
    }

    const match = matchRoute(request.method, pathname);
    if (!match) return fail(`No route for ${request.method} ${pathname}`, 404);

    const { actor, via } = await resolveActor(request, env);
    const routeInfo = routes.find((r) => r.handler === match.handler);
    if (!routeInfo?.public && !actor) {
      return json(
        { ok: false, error: "Sign in to continue.", auth: "required" },
        401,
        { "WWW-Authenticate": "Session" }
      );
    }
    if (via === "access") await ensureUserRow(env, actor);

    try {
      return await match.handler({ req: request, env, url, params: match.params, actor, via });
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

  // C4 — WhatsApp webhook batches → inbound_messages (absent on the $0 plan)
  async queue(_batch: MessageBatch, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // implemented in batch C4
  },
} satisfies ExportedHandler<Env>;
