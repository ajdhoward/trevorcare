// Extraction API — runs the deterministic extraction engine over a vault
// document's text and queues the resulting facts for human review.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { extractFacts } from "@/lib/extract";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const doc = await db.vaultDocument.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const text = doc.textExtract || "";
    if (!text.trim()) {
      return NextResponse.json({
        ok: false,
        error:
          "No extractable text — this file is probably a scan or photo. Use OCR on your device and paste the text via the wizard's 'paste the text' field.",
      }, { status: 422 });
    }

    let hints: { category?: string } = {};
    try {
      const body = (await req.json().catch(() => ({}))) as { hints?: { category?: string } };
      hints = body.hints ?? {};
    } catch {
      /* body optional */
    }

    const facts = extractFacts(doc.fileName, doc.mimeType, text, { category: doc.category, ...hints });

    let created = 0;
    for (const f of facts) {
      // avoid duplicating an identical pending/confirmed fact for this document
      const dup = await db.extractedFact.findFirst({
        where: { documentId: id, key: f.key, value: f.value, status: { in: ["pending", "confirmed"] } },
      });
      if (dup) continue;
      await db.extractedFact.create({
        data: {
          subjectId: doc.subjectId,
          documentId: id,
          key: f.key,
          label: f.label,
          value: f.value.slice(0, 300),
          quote: f.quote.slice(0, 500),
          confidence: f.confidence,
          source: f.source,
        },
      });
      created++;
    }

    return NextResponse.json({ ok: true, found: facts.length, created });
  });
}
