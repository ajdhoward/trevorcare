// Shared Worker utilities — JSON responses, ids, HMAC, auto-generated secrets.

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const fail = (error: string, status = 400): Response => json({ ok: false, error }, status);

const nowIso = (): string => new Date().toISOString();

/** cuid-shaped id: `c` + base36 ms + base36 random chars. */
const cuid = (): string => {
  const ts = Date.now().toString(36);
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let rnd = "";
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

const unb64url = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

/**
 * Auto-generated worker secrets (per deployment spec): on first run the value
 * is created with crypto.getRandomValues() and persisted in the D1
 * `app_secrets` table, so it survives across deploys. Nothing for the user to
 * paste except WHAPI_TOKEN.
 */
async function getOrCreateSecret(env: {
  DB: D1Database;
  SESSION_SECRET?: string;
}, key: string): Promise<string> {
  if (key === "session_secret" && env.SESSION_SECRET) return env.SESSION_SECRET;
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

export { json, fail, nowIso, cuid, hmac, b64url, unb64url, getOrCreateSecret };
