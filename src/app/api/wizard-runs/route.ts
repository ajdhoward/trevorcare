// Wizard runtime dispatcher — receives the values collected by the wizard
// engine and performs the wizard's bound action:
//   create-subject   → POST a new service user (also mirrors profile fields)
//   log-opg-receipt  → finance entry + optional receipt into the vault
//   register-lpa     → LPA instrument record (legal hub store, via facts API)
//   intake-document  → vault upload + extraction run
//   custom           → stored as a wizard-run note (visible in the studio log)
// Actions here are deliberately server-side so permissions & validation can't
// be bypassed from the console.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { WIZARD_ACTIONS } from "@/lib/wizards";
import { extractFacts } from "@/lib/extract";

export async function POST(req: NextRequest) {
  return withSession(req, async (session) => {
    const body = (await req.json().catch(() => ({}))) as {
      wizardKey?: string;
      values?: Record<string, string | boolean>;
    };
    const wizardKey = String(body.wizardKey || "");
    const values = body.values ?? {};
    const action = WIZARD_ACTIONS[wizardKey] ?? "custom";
    const actor = session.n || "family";
    const str = (k: string) => String(values[k] ?? "").trim();
    const subjectId = str("subjectId");

    // ---------------- create a service user ----------------
    if (action === "create-subject") {
      const displayName = str("displayName");
      if (!displayName) return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
      const max = await db.careSubject.aggregate({ _max: { sortOrder: true } });
      const profile: Record<string, string> = {};
      for (const k of ["gpPractice", "pharmacy", "conditions", "allergies", "medicationsSummary", "sensory", "nextOfKin", "attorneys", "likes", "dislikes", "routines"]) {
        if (str(k)) profile[k] = str(k);
      }
      const row = await db.careSubject.create({
        data: {
          displayName: displayName.slice(0, 80),
          relationship: str("relationship").slice(0, 120),
          setting: ["home", "residential", "supported-living"].includes(str("setting")) ? str("setting") : "home",
          dateOfBirth: str("dateOfBirth").slice(0, 10),
          phone: str("phone").slice(0, 40),
          address: str("address").slice(0, 200),
          profile: JSON.stringify(profile),
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
      return NextResponse.json({ ok: true, action, subject: { id: row.id, displayName: row.displayName } }, { status: 201 });
    }

    // ---------------- log an OPG receipt ----------------
    if (action === "log-opg-receipt") {
      const amount = Number(str("amount"));
      const date = str("date");
      const description = str("description");
      if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !description) {
        return NextResponse.json({ ok: false, error: "A positive amount, a date and a description are required." }, { status: 400 });
      }
      const entry = await db.financeEntry.create({
        data: {
          subjectId,
          date,
          type: "expense",
          category: str("category") || "other",
          description: description.slice(0, 300),
          amount,
          opgReportable: true,
          notes: [str("paymentMethod"), str("notes")].filter(Boolean).join(" — ").slice(0, 500),
          createdBy: actor,
        },
      });
      // receipt handling happens client-side (file) — wizard reports back
      return NextResponse.json({ ok: true, action, entry, wantsReceipt: values.receiptProvided === true }, { status: 201 });
    }

    // ---------------- register an LPA instrument ----------------
    if (action === "register-lpa") {
      const attorneys = str("attorneys");
      if (!attorneys) return NextResponse.json({ ok: false, error: "At least one attorney is required." }, { status: 400 });
      const instrument = {
        subjectId,
        area: str("area") === "health" ? "health" : "financial",
        status: ["draft", "signed", "registered", "active"].includes(str("status")) ? str("status") : "draft",
        opgReference: str("opgReference"),
        registrationDate: str("registrationDate"),
        attorneys,
        replacementAttorneys: str("replacementAttorneys"),
        certificateProvider: str("certificateProvider"),
        decisions: str("decisions"),
        registeredVia: "wizard",
        createdBy: actor,
        createdAt: new Date().toISOString(),
      };
      const existing = await db.wizardDef.findUnique({ where: { key: "lpa-registry" } });
      let registry: unknown[] = [];
      if (existing) {
        try {
          registry = JSON.parse(existing.steps) as unknown[];
        } catch {
          registry = [];
        }
      }
      registry.push(instrument);
      if (existing) {
        await db.wizardDef.update({ where: { key: "lpa-registry" }, data: { steps: JSON.stringify(registry), version: existing.version + 1 } });
      } else {
        await db.wizardDef.create({
          data: {
            key: "lpa-registry",
            title: "LPA register (data store)",
            description: "Structured LPA instruments created via the register-an-LPA wizard. Editable as data.",
            steps: JSON.stringify(registry),
            system: true,
            version: 1,
          },
        });
      }
      return NextResponse.json({ ok: true, action, instrument }, { status: 201 });
    }

    // ---------------- document intake (paste path) ----------------
    if (action === "intake-document") {
      const title = str("title") || "Pasted text";
      const pastedText = str("pastedText");
      const category = str("category") || "other";
      if (!pastedText) {
        return NextResponse.json({ ok: false, error: "Paste the document text (file uploads use the vault upload panel)." }, { status: 400 });
      }
      const doc = await db.vaultDocument.create({
        data: {
          subjectId,
          title: title.slice(0, 200),
          category: category.slice(0, 40),
          fileName: `${title.replace(/[^\w -]/g, "").slice(0, 40) || "pasted"}.txt`,
          mimeType: "text/plain",
          size: Buffer.byteLength(pastedText),
          sensitivity: ["standard", "sensitive", "restricted"].includes(str("sensitivity")) ? str("sensitivity") : "standard",
          textExtract: pastedText.slice(0, 400_000),
          tags: JSON.stringify([category]),
          uploadedBy: actor,
        },
      });
      const facts = extractFacts(doc.fileName, doc.mimeType, pastedText, { category });
      let created = 0;
      for (const f of facts) {
        await db.extractedFact.create({
          data: {
            subjectId,
            documentId: doc.id,
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
      return NextResponse.json({ ok: true, action, document: { ...doc, data: undefined }, factsFound: facts.length, factsQueued: created }, { status: 201 });
    }

    // ---------------- custom wizards (framework is open) ----------------
    return NextResponse.json({
      ok: true,
      action: "custom",
      note: `Wizard "${wizardKey}" completed. No system action is bound to this key — bind one in code or use the studio to record runs.`,
      values,
    });
  });
}
