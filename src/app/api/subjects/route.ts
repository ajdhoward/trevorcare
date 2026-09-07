// Service-user registry API. GET lists subjects (seeding fictional demo
// subjects on first run); POST adds a new subject — the "add a service
// user" flow target, driven by the add-service-user wizard.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { parseSubject, DEMO_SUBJECTS } from "@/lib/subjects";

async function seedOnce() {
  const count = await db.careSubject.count();
  if (count > 0) return;
  for (const s of DEMO_SUBJECTS) {
    await db.careSubject.create({
      data: {
        id: s.id,
        displayName: s.displayName,
        relationship: s.relationship,
        setting: s.setting,
        dateOfBirth: s.dateOfBirth,
        nhsNumber: s.nhsNumber,
        address: s.address,
        phone: s.phone,
        profile: JSON.stringify(s.profile),
        sortOrder: s.sortOrder,
      },
    });
  }
}

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    await seedOnce();
    const rows = await db.careSubject.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
    const subjects = rows
      .filter((r) => includeArchived || !r.archived)
      .map(parseSubject);
    return NextResponse.json({ ok: true, subjects });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const displayName = String(body.displayName || "").trim();
    if (!displayName) {
      return NextResponse.json({ ok: false, error: "A name is required." }, { status: 400 });
    }
    const max = await db.careSubject.aggregate({ _max: { sortOrder: true } });
    const row = await db.careSubject.create({
      data: {
        displayName: displayName.slice(0, 80),
        relationship: String(body.relationship || "").slice(0, 120),
        setting: ["home", "residential", "supported-living"].includes(String(body.setting))
          ? String(body.setting)
          : "home",
        dateOfBirth: String(body.dateOfBirth || "").slice(0, 10),
        nhsNumber: String(body.nhsNumber || "").slice(0, 20),
        address: String(body.address || "").slice(0, 200),
        phone: String(body.phone || "").slice(0, 40),
        profile: JSON.stringify(body.profile && typeof body.profile === "object" ? body.profile : {}),
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    return NextResponse.json({ ok: true, subject: parseSubject(row) }, { status: 201 });
  });
}
