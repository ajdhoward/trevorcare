// ICS / vCard import — paste or upload a calendar export (.ics) or contacts
// export (.vcf) and get parsed events / contacts back. This is the
// works-today sync path for Google Takeout, Apple iCloud exports and
// Outlook exports.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { parseIcs, parseVCard } from "@/lib/pim";

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { text?: string; format?: string };
    const text = String(body.text || "");
    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: "Paste the .ics or .vcf contents (or use a feed URL)." }, { status: 400 });
    }
    const looksVcard = /BEGIN:VCARD/i.test(text.slice(0, 400));
    const format = body.format === "vcard" || looksVcard ? "vcard" : "ics";

    if (format === "vcard") {
      const contacts = parseVCard(text);
      await db.pimIntegration.updateMany({
        where: { kind: "calendar" },
        data: { lastResult: `vCard import: ${contacts.length} contact(s) parsed (client-side list)` },
      });
      return NextResponse.json({ ok: true, format, contacts });
    }

    const { events, errors } = parseIcs(text);
    return NextResponse.json({ ok: true, format, events, errors });
  });
}
