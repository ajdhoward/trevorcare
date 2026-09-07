// Research run detail — the auditable record of one research run: question,
// full tool-call trace, grounding score, and every claim with its validation
// state and verbatim source quote.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const run = await db.researchRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const claims = await db.researchClaim.findMany({
      where: { runId: id },
      orderBy: [{ verdict: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ ok: true, run: { ...run, log: JSON.parse(run.log || "[]") }, claims });
  });
}
