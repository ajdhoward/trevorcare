// WhatsApp webhook receiver (Whapi.Cloud) + poll endpoint.
//
// POST /api/whapi/webhook        — Whapi.Cloud pushes incoming group messages here.
//   Point the webhook at https://<your-domain>/api/whapi/webhook (Events: messages).
//   Accepts Whapi shapes defensively (batch {messages:[…]} or single message),
//   stores text messages in Prisma (deduped by msgId), returns 200 fast.
//
// GET /api/whapi/webhook?limit=100 — the portal UI polls this to mirror new
//   messages into the family flows (shopping list, tasks, calendar, review flags).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

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

function tsToIso(ts: number | string | undefined): Date {
  if (typeof ts === "number") return new Date(ts * 1000);
  if (typeof ts === "string" && /^\d+$/.test(ts)) return new Date(Number(ts) * 1000);
  const d = ts ? new Date(ts) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) return NextResponse.json({ ok: true, stored: 0 });

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
        await db.inboundMessage.upsert({
          where: { source_msgId: { source: "whatsapp", msgId } },
          create: {
            source: "whatsapp",
            groupId,
            groupName: groupId,
            sender,
            body: body.slice(0, 4000),
            msgId,
            ts,
          },
          update: {},
        });
        stored++;
      } catch {
        // dedupe race — ignore, still return 200 so Whapi doesn't retry-storm
      }
    }
    return NextResponse.json({ ok: true, stored });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "100") || 100, 300);
    const rows = await db.inboundMessage.findMany({
      where: { source: "whatsapp" },
      orderBy: { ts: "desc" },
      take: limit,
    });
    return NextResponse.json({
      ok: true,
      messages: rows.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        groupName: r.groupName,
        sender: r.sender,
        ts: r.ts.toISOString(),
        body: r.body,
        processed: r.processed,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), messages: [] }, { status: 200 });
  }
}
