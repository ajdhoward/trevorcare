// Research runs — list history, start a new run, fetch run detail with claims.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { runResearch } from "@/lib/research";

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    const subjectId = req.nextUrl.searchParams.get("subjectId");
    const runs = await db.researchRun.findMany({
      where: subjectId ? { subjectId } : {},
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const claimCounts = await db.researchClaim.groupBy({
      by: ["runId", "verdict"],
      _count: { _all: true },
    });
    const runsWithCounts = runs.map((r) => {
      const counts = claimCounts.filter((c) => c.runId === r.id);
      return {
        ...r,
        log: undefined,
        counts: {
          supported: counts.find((c) => c.verdict === "supported")?._count._all ?? 0,
          unsupported: counts.find((c) => c.verdict === "unsupported")?._count._all ?? 0,
        },
      };
    });
    return NextResponse.json({ ok: true, runs: runsWithCounts });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { question?: string; subjectId?: string };
    const question = String(body.question || "").trim();
    if (question.length < 8) {
      return NextResponse.json({ ok: false, error: "Ask a question of at least a few words." }, { status: 400 });
    }
    // note: runs synchronously (10-40s). The client shows a running state and
    // polls the list; acceptable for a research tool, keeps deployment simple.
    const { runId } = await runResearch(question, String(body.subjectId || ""));
    return NextResponse.json({ ok: true, runId });
  });
}
