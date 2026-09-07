// Dedicated care inbox — receives emails routed to the family's dedicated
// care email address and exposes them to the portal.
//
// POST /api/inbox  { from, subject, body, ts? } — called by an email ingress
//   (Cloudflare Email Routing → Email Worker → this endpoint when deployed;
//   or any mail-parser webhook). Also usable to log an email manually.
// GET  /api/inbox?limit=100 — the portal polls this for the inbox view.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => null)) as
      | { from?: string; subject?: string; body?: string; ts?: string; source?: string }
      | null;
    if (!b || (!b.body && !b.subject)) {
      return NextResponse.json({ ok: false, error: "subject or body required" }, { status: 400 });
    }
    const msgId = `e-${hashId(`${b.from || ""}|${b.subject || ""}|${b.ts || ""}|${(b.body || "").slice(0, 200)}`)}`;
    const row = await db.inboundMessage.upsert({
      where: { source_msgId: { source: "email", msgId } },
      create: {
        source: b.source === "whatsapp" ? "whatsapp" : "email",
        sender: b.from || "(unknown sender)",
        subject: (b.subject || "").slice(0, 300),
        body: (b.body || "").slice(0, 8000),
        msgId,
        ts: b.ts ? new Date(b.ts) : new Date(),
      },
      update: {},
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "100") || 100, 300);
    const rows = await db.inboundMessage.findMany({
      where: { source: "email" },
      orderBy: { ts: "desc" },
      take: limit,
    });
    return NextResponse.json({
      ok: true,
      messages: rows.map((r) => ({
        id: r.id,
        from: r.sender,
        subject: r.subject,
        body: r.body,
        ts: r.ts.toISOString(),
        processed: r.processed,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), messages: [] }, { status: 200 });
  }
}
