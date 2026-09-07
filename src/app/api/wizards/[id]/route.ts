// Update (edit steps/title) or delete a wizard definition. System wizards can
// be reshaped but not deleted — their action bindings are referenced elsewhere
// (the add-service-user flow, OPG receipt logging, LPA registration).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { parseWizardDef, serializeWizardSteps, type WizardStep } from "@/lib/wizards";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      steps?: WizardStep[];
    };
    const existing = await db.wizardDef.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const data: Record<string, unknown> = { version: existing.version + 1 };
    if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (typeof body.description === "string") data.description = body.description;
    if (Array.isArray(body.steps) && body.steps.length > 0) {
      // validation: every step needs an id, a title and at least one field
      for (const [i, s] of body.steps.entries()) {
        if (!s.id || !s.title || !Array.isArray(s.fields) || s.fields.length === 0) {
          return NextResponse.json(
            { ok: false, error: `Step ${i + 1} needs an id, a title and at least one field.` },
            { status: 400 }
          );
        }
        for (const f of s.fields) {
          if (!f.id || !f.label || !f.type) {
            return NextResponse.json(
              { ok: false, error: `Every field in "${s.title}" needs an id, a label and a type.` },
              { status: 400 }
            );
          }
        }
      }
      data.steps = serializeWizardSteps(body.steps);
    }

    const row = await db.wizardDef.update({ where: { id }, data });
    return NextResponse.json({ ok: true, wizard: parseWizardDef(row) });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const existing = await db.wizardDef.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (existing.system) {
      return NextResponse.json(
        { ok: false, error: "System wizards cannot be deleted — they power built-in flows. You can still edit their steps." },
        { status: 403 }
      );
    }
    await db.wizardDef.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
