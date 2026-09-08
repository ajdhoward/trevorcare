// WhatsApp ingestion + Whapi.Cloud proxies — ported from:
//   src/app/api/whapi/webhook/route.ts → POST/GET /api/whapi/webhook
//   src/app/api/whapi/send/route.ts    → POST /api/whapi/send
//   src/app/api/whapi/groups/route.ts  → POST /api/whapi/groups
//
// Parity notes:
// - POST /api/whapi/webhook is PUBLIC: the original handler has no auth check
//   at all and prisma/schema.prisma documents it as "stateless and public"
//   (Whapi.Cloud cannot carry a portal session). The original never verified a
//   secret, so none is verified here; the `?secret=…` hardening in
//   docs/DEPLOYMENT.md is a deploy-level (C4) concern, not route behaviour.
// - GET /api/whapi/webhook and POST /api/whapi/{send,groups} stay behind the
//   portal gate (the original Next.js middleware required a session for them;
//   the browser sends the cookie, so UI calls keep working unchanged).
// - Webhook payloads: on the $5 Workers plan the raw payload is handed to the
//   WHAPI_QUEUE and the queue consumer performs ingestion (see index.ts);
//   without a queue binding ($0 plan) it degrades to INLINE processing — same
//   dedupe via the UNIQUE (source, msg_id) index + ON CONFLICT DO NOTHING.
//   `stored` counts messages ingested inline; queued responses return
//   {ok:true, queued:true} because ingestion happens asynchronously.
// - GET returns ts as the stored ISO string (Prisma serialized DateTime the
//   same way) and processed as a boolean.

import { route, type Handler } from "../router";
import { cuid, json, nowIso } from "../util";

interface InboundRow {
  id: string;
  source: string;
  group_id: string;
  group_name: string;
  sender: string;
  subject: string;
  body: string;
  msg_id: string;
  ts: string;
  processed: number;
  created_at: string;
}

interface RawMsg {
  id?: string;
  chat_id?: string;
  chat_from?: string;
  from_name?: string;
  timestamp?: number | string;
  type?: string;
  text?: unknown;
  body?: unknown;
  caption?: unknown;
}

// ---------------------------------------------------------------------------
// Webhook payload helpers (ported 1:1)
// ---------------------------------------------------------------------------

function extractText(m: RawMsg): string {
  if (typeof m.text === "string") return m.text;
  if (m.text && typeof m.text === "object" && "body" in (m.text as Record<string, unknown>)) {
    const b = (m.text as Record<string, unknown>).body;
    if (typeof b === "string") return b;
  }
  if (typeof m.body === "string") return m.body;
  if (typeof m.caption === "string") return m.caption;
  return "";
}

function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

function tsToIso(ts: number | string | undefined): string {
  let d: Date;
  if (typeof ts === "number") d = new Date(ts * 1000);
  else if (typeof ts === "string" && /^\d+$/.test(ts)) d = new Date(Number(ts) * 1000);
  else d = ts ? new Date(ts) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString();
}

/**
 * Ingest a Whapi payload (single message or {messages:[...]}) into the
 * inbound_messages table — deduped by the UNIQUE (source, msg_id) index.
 * Shared by the webhook route (inline fallback) and the queue consumer.
 */
export async function ingestWhapiPayloads(
  env: { DB: D1Database },
  payload: Record<string, unknown>
): Promise<{ stored: number }> {
  const list: RawMsg[] = Array.isArray(payload.messages)
    ? (payload.messages as RawMsg[])
    : [payload as RawMsg];

  let stored = 0;
  for (const m of list) {
    const body = extractText(m);
    const groupId = (m.chat_id || m.chat_from || "") as string;
    if (!body || !groupId) continue; // skip acks / media without caption / non-group pings
    const sender = (m.from_name || m.id?.split("_")[0] || "unknown") as string;
    const msgId = (m.id as string) || `h-${hashId(`${groupId}|${m.timestamp}|${body}`)}`;
    const ts = tsToIso(m.timestamp);
    try {
      await env.DB.prepare(
        `INSERT INTO inbound_messages
         (id, source, group_id, group_name, sender, subject, body, msg_id, ts, processed, created_at)
         VALUES (?, 'whatsapp', ?, ?, ?, '', ?, ?, ?, 0, ?)
         ON CONFLICT (source, msg_id) DO NOTHING`
      )
        .bind(cuid(), groupId, groupId, sender, body.slice(0, 4000), msgId, ts, nowIso())
        .run();
      stored++;
    } catch {
      // dedupe race — ignore, keep going so callers never retry-storm
    }
  }
  return { stored };
}

// ---------------------------------------------------------------------------
// POST /api/whapi/webhook — Whapi.Cloud pushes incoming group messages here.
// Point the webhook at https://<your-domain>/api/whapi/webhook (Events:
// messages). Accepts Whapi shapes defensively (batch {messages:[…]} or a
// single message). On the $5 Workers plan the payload is handed to the
// WHAPI_QUEUE for durable ingestion; without a queue binding it degrades to
// inline processing. Returns 200 fast either way.
// ---------------------------------------------------------------------------

const webhookPost: Handler = async (ctx) => {
  try {
    const payload = (await ctx.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) return json({ ok: true, stored: 0 });

    if (ctx.env.WHAPI_QUEUE) {
      await ctx.env.WHAPI_QUEUE.send(payload);
      return json({ ok: true, stored: 0, queued: true });
    }

    const { stored } = await ingestWhapiPayloads(ctx.env, payload);
    return json({ ok: true, stored });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
};

// ---------------------------------------------------------------------------
// GET /api/whapi/webhook?limit=100 — the portal UI polls this to mirror new
// messages into the family flows (shopping list, tasks, calendar, review flags).
// ---------------------------------------------------------------------------

const webhookGet: Handler = async (ctx) => {
  try {
    const limit = Math.min(Number(ctx.url.searchParams.get("limit") || "100") || 100, 300);
    const result = await ctx.env.DB.prepare(
      "SELECT * FROM inbound_messages WHERE source = 'whatsapp' ORDER BY ts DESC LIMIT ?"
    )
      .bind(limit)
      .all<InboundRow>();
    return json({
      ok: true,
      messages: (result.results ?? []).map((r) => ({
        id: r.id,
        groupId: r.group_id,
        groupName: r.group_name,
        sender: r.sender,
        ts: r.ts,
        body: r.body,
        processed: Boolean(r.processed),
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e), messages: [] }, 200);
  }
};

// ---------------------------------------------------------------------------
// POST /api/whapi/send — Whapi.Cloud proxy: send a text message into a
// WhatsApp group (by @g.us id). Used for proposed-slot messages to Pat, the
// family group, and the future mum's group with Mum's care home.
// ---------------------------------------------------------------------------

const send: Handler = async (ctx) => {
  try {
    const { token, to, body } = (await ctx.req.json()) as { token?: string; to?: string; body?: string };
    if (!token || !to || !body) {
      return json({ error: "token, to (group id) and body are required." }, 400);
    }
    const res = await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ to, body }),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return json(
        {
          error:
            res.status === 401
              ? "Whapi rejected the token (401)."
              : res.status === 404
                ? "Group id not found (404) — re-fetch groups and pick the right one."
                : `Whapi returned HTTP ${res.status}.`,
          status: res.status,
        },
        502
      );
    }
    return json({ ok: true, response: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

// ---------------------------------------------------------------------------
// POST /api/whapi/groups — Whapi.Cloud proxy: list the WhatsApp groups on the
// linked number. The API token is supplied by the client per request (stored
// in the user's browser, not on the server) and proxied so the browser never
// calls gate.whapi.cloud directly (CORS + keeps the token out of page history).
// ---------------------------------------------------------------------------

const groups: Handler = async (ctx) => {
  try {
    const { token } = (await ctx.req.json()) as { token?: string };
    if (!token) {
      return json({ error: "No Whapi.Cloud token provided." }, 400);
    }
    const res = await fetch("https://gate.whapi.cloud/groups?count=100", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !Array.isArray(data)) {
      const msg =
        res.status === 401
          ? "Whapi rejected the token (401) — check it in the Whapi dashboard."
          : `Whapi returned HTTP ${res.status}.`;
      return json({ error: msg, status: res.status }, 502);
    }
    const groups = (data as Record<string, unknown>[])
      .filter((g) => typeof g.id === "string")
      .map((g) => ({
        id: g.id as string,
        name: (g.name as string) || "(unnamed group)",
        participants: (g.participants_count as number) ?? null,
      }));
    return json({ ok: true, groups });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

// ---------------------------------------------------------------------------

export function registerWhapiRoutes(routeFn: typeof route): void {
  // External ingest — unauthenticated in the original (see header note).
  routeFn("POST", "/api/whapi/webhook", webhookPost, { public: true });
  // Portal UI poll — behind the session gate, like the Next.js middleware did.
  routeFn("GET", "/api/whapi/webhook", webhookGet);
  routeFn("POST", "/api/whapi/send", send);
  routeFn("POST", "/api/whapi/groups", groups);
}
