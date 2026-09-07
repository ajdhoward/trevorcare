// Wizard framework API. GET lists definitions, seeding the built-in wizards on
// first call. POST creates a NEW wizard (the framework is open — families or
// developers can add their own guided flows at runtime).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { SEED_WIZARDS, parseWizardDef, serializeWizardSteps, type WizardStep } from "@/lib/wizards";

async function seedOnce() {
  // Seed per key (not just once per table) so new built-in wizards shipped by
  // an update appear in databases that were seeded by an earlier version.
  for (const w of SEED_WIZARDS) {
    if ((await db.wizardDef.count({ where: { key: w.key } })) > 0) continue;
    await db.wizardDef.create({
      data: {
        key: w.key,
        title: w.title,
        description: w.description,
        steps: serializeWizardSteps(w.steps),
        system: w.system,
        version: 1,
      },
    });
  }
  // demo LPA register — two fictional instruments so the Legal hub demonstrates
  // itself; replace via the register-an-LPA wizard (entries are data, not code).
  if ((await db.wizardDef.count({ where: { key: "lpa-registry" } })) === 0) {
    await db.wizardDef.create({
      data: {
        key: "lpa-registry",
        title: "LPA register (data store)",
        description: "Structured LPA instruments created via the register-an-LPA wizard. Editable as data.",
        system: true,
        steps: JSON.stringify([
          {
            subjectId: "subj-demo-home",
            area: "financial",
            status: "registered",
            opgReference: "MYPG-SAMPLE-01",
            registrationDate: "2024-06-14",
            attorneys: "Alex, Pat",
            replacementAttorneys: "Rowan (sample)",
            certificateProvider: "J. Bailey (sample)",
            decisions: "Sample: attorneys act jointly on gifts over £500; property decisions can be made severally.",
            registeredVia: "demo-seed",
            createdBy: "demo-seed",
            createdAt: "2026-09-01T09:00:00.000Z",
          },
          {
            subjectId: "subj-demo-home",
            area: "health",
            status: "active",
            opgReference: "MYPG-SAMPLE-02",
            registrationDate: "2024-06-14",
            attorneys: "Alex, Pat",
            replacementAttorneys: "",
            certificateProvider: "J. Bailey (sample)",
            decisions: "Sample: life-sustaining treatment decisions follow the recorded wishes in the advance statement.",
            registeredVia: "demo-seed",
            createdBy: "demo-seed",
            createdAt: "2026-09-01T09:05:00.000Z",
          },
        ]),
        version: 1,
      },
    });
  }
}

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    await seedOnce();
    const rows = await db.wizardDef.findMany({ orderBy: { updatedAt: "asc" } });
    return NextResponse.json({ ok: true, wizards: rows.map(parseWizardDef) });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as {
      key?: string;
      title?: string;
      description?: string;
      steps?: WizardStep[];
    };
    const key = String(body.key || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const title = String(body.title || "").trim();
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!key || !title || steps.length === 0) {
      return NextResponse.json({ ok: false, error: "key, title and at least one step are required." }, { status: 400 });
    }
    const exists = await db.wizardDef.findUnique({ where: { key } });
    if (exists) {
      return NextResponse.json({ ok: false, error: `A wizard with key "${key}" already exists.` }, { status: 409 });
    }
    const row = await db.wizardDef.create({
      data: {
        key,
        title,
        description: String(body.description || ""),
        steps: serializeWizardSteps(steps),
        system: false,
        version: 1,
      },
    });
    return NextResponse.json({ ok: true, wizard: parseWizardDef(row) }, { status: 201 });
  });
}
