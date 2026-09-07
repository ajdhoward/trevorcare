// Extracted-fact review queue. GET lists facts (optionally per subject /
// status). PATCH confirms or rejects a fact; confirming a profile-relevant key
// writes it straight into the subject's profile JSON (server-side) so the
// About-the-subject section stays the single source of truth.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

const PROFILE_KEYS: Record<string, string> = {
  fullName: "preferredName",
  dateOfBirth: "dateOfBirth",
  nhsNumber: "nhsNumber",
  address: "address",
  phone: "phone",
  medication: "medicationsSummary",
  careHome: "careHome",
  opgReference: "opgReference",
};

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    const subjectId = req.nextUrl.searchParams.get("subjectId");
    const status = req.nextUrl.searchParams.get("status");
    const rows = await db.extractedFact.findMany({
      where: {
        ...(subjectId ? { subjectId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ ok: true, facts: rows });
  });
}

export async function PATCH(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
    const id = String(body.id || "");
    const status = String(body.status || "");
    if (!id || !["confirmed", "rejected", "pending"].includes(status)) {
      return NextResponse.json({ ok: false, error: "id and status (confirmed|rejected|pending) are required." }, { status: 400 });
    }
    const fact = await db.extractedFact.update({
      where: { id },
      data: { status, decidedAt: new Date() },
    });

    // confirm → project into the subject profile where a mapping exists
    if (status === "confirmed" && fact.subjectId) {
      const profileKey = PROFILE_KEYS[fact.key];
      const subject = await db.careSubject.findUnique({ where: { id: fact.subjectId } });
      if (subject) {
        let profile: Record<string, unknown> = {};
        try {
          profile = JSON.parse(subject.profile || "{}") as Record<string, unknown>;
        } catch {
          profile = {};
        }
        if (profileKey === "dateOfBirth") {
          await db.careSubject.update({ where: { id: subject.id }, data: { dateOfBirth: fact.value } });
        } else if (profileKey === "nhsNumber") {
          await db.careSubject.update({ where: { id: subject.id }, data: { nhsNumber: fact.value } });
        } else if (profileKey === "address") {
          await db.careSubject.update({ where: { id: subject.id }, data: { address: fact.value } });
        } else if (profileKey === "phone") {
          await db.careSubject.update({ where: { id: subject.id }, data: { phone: fact.value } });
        }
        if (profileKey) {
          profile[profileKey] = fact.value;
          profile[`${profileKey}ConfirmedFrom`] = fact.quote;
          await db.careSubject.update({ where: { id: subject.id }, data: { profile: JSON.stringify(profile) } });
        }
      }
    }

    return NextResponse.json({ ok: true, fact });
  });
}
