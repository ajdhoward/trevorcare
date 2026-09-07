// Per-subject API: update profile/details or archive. DELETE is soft
// (archive) unless ?hard=1 — hard delete cascades the subject's vault,
// facts and finance rows so a mistaken entry can be fully removed.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { parseSubject } from "@/lib/subjects";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.careSubject.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, subject: parseSubject(row) });
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of ["displayName", "relationship", "setting", "dateOfBirth", "nhsNumber", "address", "phone"] as const) {
      if (typeof body[k] === "string") data[k] = (body[k] as string).slice(0, 200);
    }
    if (typeof body.archived === "boolean") data.archived = body.archived;
    if (body.profile && typeof body.profile === "object") {
      data.profile = JSON.stringify(body.profile);
    }
    const row = await db.careSubject.update({ where: { id }, data });
    return NextResponse.json({ ok: true, subject: parseSubject(row) });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const hard = req.nextUrl.searchParams.get("hard") === "1";
    if (hard) {
      await db.$transaction([
        db.vaultDocument.deleteMany({ where: { subjectId: id } }),
        db.extractedFact.deleteMany({ where: { subjectId: id } }),
        db.financeEntry.deleteMany({ where: { subjectId: id } }),
        db.researchRun.deleteMany({ where: { subjectId: id } }),
        db.careSubject.delete({ where: { id } }),
      ]);
      return NextResponse.json({ ok: true, archived: false, deleted: true });
    }
    const row = await db.careSubject.update({ where: { id }, data: { archived: true } });
    return NextResponse.json({ ok: true, subject: parseSubject(row), archived: true });
  });
}
