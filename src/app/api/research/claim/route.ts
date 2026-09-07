// Claim review — accept or dismiss a validated claim. Accepting records WHO
// accepted it (the sign-in username) so the evidence trail stays human-owned.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

export async function PATCH(req: NextRequest) {
  return withSession(req, async (session) => {
    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
    const id = String(body.id || "");
    const status = String(body.status || "");
    if (!id || !["accepted", "dismissed", "pending"].includes(status)) {
      return NextResponse.json({ ok: false, error: "id and status (accepted|dismissed|pending) are required." }, { status: 400 });
    }
    const claim = await db.researchClaim.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ ok: true, claim, decidedBy: session.n || "family" });
  });
}
