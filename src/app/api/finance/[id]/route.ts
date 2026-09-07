// Delete a finance entry (typo correction) — audit copy is returned to the
// caller for their own records before deletion.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.financeEntry.delete({ where: { id } }).catch(() => null);
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: row });
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof body.receiptId === "string") data.receiptId = body.receiptId;
    if (typeof body.notes === "string") data.notes = body.notes.slice(0, 500);
    if (typeof body.opgReportable === "boolean") data.opgReportable = body.opgReportable;
    const row = await db.financeEntry.update({ where: { id }, data });
    return NextResponse.json({ ok: true, entry: row });
  });
}
