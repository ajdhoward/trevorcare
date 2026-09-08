// Wizard framework — ported 1:1 from three Next.js route files (C2):
//   src/app/api/wizards/route.ts       → GET+POST /api/wizards
//   src/app/api/wizards/[id]/route.ts  → PUT+DELETE /api/wizards/:id
//   src/app/api/wizard-runs/route.ts   → POST /api/wizard-runs
//
// Wizards are DATA, editable in Wizard Studio. The framework is open: families
// or developers add their own guided flows at runtime; the run dispatcher
// performs each wizard's bound action server-side.
//
// Parity notes:
// - Imports SEED_WIZARDS / parseWizardDef / serializeWizardSteps / WIZARD_ACTIONS
//   from ../../lib/wizards (pure TypeScript, no imports of its own) and
//   extractFacts from ../../lib/extract (pure; Buffer appears only inside the
//   unused extractText helper — the byte length here uses TextEncoder).
// - wizard_defs.system is INTEGER in D1 → converted to boolean via Boolean()
//   before parseWizardDef so the JSON matches Prisma's shape (updatedAt, which
//   Prisma spread into every response, is carried over from updated_at).
// - The seed runs per key (not once per table) so newly shipped built-in
//   wizards appear in databases seeded by an earlier version.
// - Buffer.byteLength(pastedText) → new TextEncoder().encode(...).length
//   (both are UTF-8 byte counts).
// - Prisma update/delete of a missing wizard throws (Next → HTTP 500); the
//   explicit 404s of the original are returned directly, everything else is
//   thrown into the router's catch.

import { route, type Handler } from "../router";
import { cuid, json, nowIso } from "../util";
import {
  SEED_WIZARDS,
  parseWizardDef,
  serializeWizardSteps,
  WIZARD_ACTIONS,
  type WizardStep,
} from "../../lib/wizards";
import { extractFacts } from "../../lib/extract";

interface WizardDefRow {
  id: string;
  key: string;
  title: string;
  description: string;
  steps: string;
  version: number;
  system: number;
  updated_at: string;
}

interface SubjectRow {
  id: string;
  display_name: string;
}

/** D1 row → the JSON Prisma/Next.js returned (steps parsed, system boolean). */
function toWizard(row: WizardDefRow): Record<string, unknown> {
  const def = parseWizardDef({
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    steps: row.steps,
    version: Number(row.version),
    system: Boolean(row.system),
  });
  return { ...def, updatedAt: row.updated_at };
}

// ---------------------------------------------------------------------------
// Seeding — ported from src/app/api/wizards/route.ts seedOnce()
// ---------------------------------------------------------------------------

async function seedOnce(DB: D1Database): Promise<void> {
  // Seed per key (not just once per table) so new built-in wizards shipped by
  // an update appear in databases that were seeded by an earlier version.
  for (const w of SEED_WIZARDS) {
    const count = await DB.prepare("SELECT COUNT(*) AS n FROM wizard_defs WHERE key = ?")
      .bind(w.key)
      .first<{ n: number }>();
    if ((count?.n ?? 0) > 0) continue;
    await DB.prepare(
      `INSERT INTO wizard_defs (id, key, title, description, steps, version, system, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(cuid(), w.key, w.title, w.description, serializeWizardSteps(w.steps), w.system ? 1 : 0, nowIso())
      .run();
  }
  // demo LPA register — two fictional instruments so the Legal hub demonstrates
  // itself; replace via the register-an-LPA wizard (entries are data, not code).
  const lpaCount = await DB.prepare("SELECT COUNT(*) AS n FROM wizard_defs WHERE key = 'lpa-registry'")
    .first<{ n: number }>();
  if ((lpaCount?.n ?? 0) === 0) {
    await DB.prepare(
      `INSERT INTO wizard_defs (id, key, title, description, steps, version, system, updated_at)
       VALUES (?, 'lpa-registry', ?, ?, ?, 1, 1, ?)`
    )
      .bind(
        cuid(),
        "LPA register (data store)",
        "Structured LPA instruments created via the register-an-LPA wizard. Editable as data.",
        JSON.stringify([
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
        nowIso()
      )
      .run();
  }
}

// ---------------------------------------------------------------------------
// GET+POST /api/wizards — src/app/api/wizards/route.ts
// ---------------------------------------------------------------------------

const listWizards: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  await seedOnce(DB);
  const result = await DB.prepare("SELECT * FROM wizard_defs ORDER BY updated_at ASC").all<WizardDefRow>();
  return json({ ok: true, wizards: (result.results ?? []).map(toWizard) });
};

const createWizard: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as {
    key?: string;
    title?: string;
    description?: string;
    steps?: WizardStep[];
  };
  const key = String(body.key || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const title = String(body.title || "").trim();
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!key || !title || steps.length === 0) {
    return json({ ok: false, error: "key, title and at least one step are required." }, 400);
  }
  const exists = await DB.prepare("SELECT * FROM wizard_defs WHERE key = ?").bind(key).first<WizardDefRow>();
  if (exists) {
    return json({ ok: false, error: `A wizard with key "${key}" already exists.` }, 409);
  }
  const id = cuid();
  await DB.prepare(
    `INSERT INTO wizard_defs (id, key, title, description, steps, version, system, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?)`
  )
    .bind(id, key, title, String(body.description || ""), serializeWizardSteps(steps), nowIso())
    .run();
  const row = await DB.prepare("SELECT * FROM wizard_defs WHERE id = ?").bind(id).first<WizardDefRow>();
  return json({ ok: true, wizard: row ? toWizard(row) : { id, key, title, steps, version: 1, system: false } }, 201);
};

// ---------------------------------------------------------------------------
// PUT+DELETE /api/wizards/:id — src/app/api/wizards/[id]/route.ts
// ---------------------------------------------------------------------------

const updateWizard: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const body = (await ctx.req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    steps?: WizardStep[];
  };
  const existing = await DB.prepare("SELECT * FROM wizard_defs WHERE id = ?").bind(id).first<WizardDefRow>();
  if (!existing) return json({ ok: false, error: "Not found" }, 404);

  const sets: string[] = ["version = ?", "updated_at = ?"];
  const vals: unknown[] = [Number(existing.version) + 1, nowIso()];
  if (typeof body.title === "string" && body.title.trim()) {
    sets.push("title = ?");
    vals.push(body.title.trim());
  }
  if (typeof body.description === "string") {
    sets.push("description = ?");
    vals.push(body.description);
  }
  if (Array.isArray(body.steps) && body.steps.length > 0) {
    // validation: every step needs an id, a title and at least one field
    for (const [i, s] of body.steps.entries()) {
      if (!s.id || !s.title || !Array.isArray(s.fields) || s.fields.length === 0) {
        return json(
          { ok: false, error: `Step ${i + 1} needs an id, a title and at least one field.` },
          400
        );
      }
      for (const f of s.fields) {
        if (!f.id || !f.label || !f.type) {
          return json(
            { ok: false, error: `Every field in "${s.title}" needs an id, a label and a type.` },
            400
          );
        }
      }
    }
    sets.push("steps = ?");
    vals.push(serializeWizardSteps(body.steps));
  }
  vals.push(id);

  await DB.prepare(`UPDATE wizard_defs SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  const row = await DB.prepare("SELECT * FROM wizard_defs WHERE id = ?").bind(id).first<WizardDefRow>();
  return json({ ok: true, wizard: row ? toWizard(row) : null });
};

const deleteWizard: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const existing = await DB.prepare("SELECT * FROM wizard_defs WHERE id = ?").bind(id).first<WizardDefRow>();
  if (!existing) return json({ ok: false, error: "Not found" }, 404);
  if (existing.system) {
    return json(
      { ok: false, error: "System wizards cannot be deleted — they power built-in flows. You can still edit their steps." },
      403
    );
  }
  await DB.prepare("DELETE FROM wizard_defs WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /api/wizard-runs — src/app/api/wizard-runs/route.ts
// ---------------------------------------------------------------------------

interface VaultDocRow {
  id: string;
  subject_id: string;
  title: string;
  category: string;
  file_name: string;
  mime_type: string;
  size: number;
  sensitivity: string;
  text_extract: string;
  tags: string;
  uploaded_by: string;
  created_at: string;
}

interface FinanceRow {
  id: string;
  subject_id: string;
  date: string;
  type: string;
  category: string;
  description: string;
  amount: number;
  receipt_id: string;
  opg_reportable: number;
  notes: string;
  created_by: string;
  created_at: string;
}

function toVaultDocument(row: VaultDocRow): Record<string, unknown> {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    category: row.category,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    sensitivity: row.sensitivity,
    textExtract: row.text_extract,
    tags: row.tags,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function toFinanceEntry(row: FinanceRow): Record<string, unknown> {
  return {
    id: row.id,
    subjectId: row.subject_id,
    date: row.date,
    type: row.type,
    category: row.category,
    description: row.description,
    amount: row.amount,
    receiptId: row.receipt_id,
    opgReportable: Boolean(row.opg_reportable),
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const runWizard: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as {
    wizardKey?: string;
    values?: Record<string, string | boolean>;
  };
  const wizardKey = String(body.wizardKey || "");
  const values = body.values ?? {};
  const action = WIZARD_ACTIONS[wizardKey] ?? "custom";
  const actor = ctx.actor || "family";
  const str = (k: string) => String(values[k] ?? "").trim();
  const subjectId = str("subjectId");

  // ---------------- create a service user ----------------
  if (action === "create-subject") {
    const displayName = str("displayName");
    if (!displayName) return json({ ok: false, error: "Name is required." }, 400);
    const max = await DB.prepare("SELECT MAX(sort_order) AS m FROM care_subjects").first<{ m: number | null }>();
    const profile: Record<string, string> = {};
    for (const k of ["gpPractice", "pharmacy", "conditions", "allergies", "medicationsSummary", "sensory", "nextOfKin", "attorneys", "likes", "dislikes", "routines"]) {
      if (str(k)) profile[k] = str(k);
    }
    const id = cuid();
    const now = nowIso();
    await DB.prepare(
      `INSERT INTO care_subjects
       (id, display_name, relationship, setting, date_of_birth, nhs_number, address, phone, profile, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?, ?)`
    )
      .bind(
        id,
        displayName.slice(0, 80),
        str("relationship").slice(0, 120),
        ["home", "residential", "supported-living"].includes(str("setting")) ? str("setting") : "home",
        str("dateOfBirth").slice(0, 10),
        str("address").slice(0, 200),
        str("phone").slice(0, 40),
        JSON.stringify(profile),
        (max?.m ?? -1) + 1,
        now,
        now
      )
      .run();
    return json({ ok: true, action, subject: { id, displayName: displayName.slice(0, 80) } }, 201);
  }

  // ---------------- log an OPG receipt ----------------
  if (action === "log-opg-receipt") {
    const amount = Number(str("amount"));
    const date = str("date");
    const description = str("description");
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !description) {
      return json({ ok: false, error: "A positive amount, a date and a description are required." }, 400);
    }
    const id = cuid();
    await DB.prepare(
      `INSERT INTO finance_entries
       (id, subject_id, date, type, category, description, amount, receipt_id, opg_reportable, notes, created_by, created_at)
       VALUES (?, ?, ?, 'expense', ?, ?, ?, '', 1, ?, ?, ?)`
    )
      .bind(
        id,
        subjectId,
        date,
        str("category") || "other",
        description.slice(0, 300),
        amount,
        [str("paymentMethod"), str("notes")].filter(Boolean).join(" — ").slice(0, 500),
        actor,
        nowIso()
      )
      .run();
    const row = await DB.prepare("SELECT * FROM finance_entries WHERE id = ?").bind(id).first<FinanceRow>();
    // receipt handling happens client-side (file) — wizard reports back
    return json({ ok: true, action, entry: row ? toFinanceEntry(row) : { id }, wantsReceipt: values.receiptProvided === true }, 201);
  }

  // ---------------- register an LPA instrument ----------------
  if (action === "register-lpa") {
    const attorneys = str("attorneys");
    if (!attorneys) return json({ ok: false, error: "At least one attorney is required." }, 400);
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
    const existing = await DB.prepare("SELECT * FROM wizard_defs WHERE key = 'lpa-registry'").first<WizardDefRow>();
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
      await DB.prepare("UPDATE wizard_defs SET steps = ?, version = ?, updated_at = ? WHERE key = 'lpa-registry'")
        .bind(JSON.stringify(registry), Number(existing.version) + 1, nowIso())
        .run();
    } else {
      await DB.prepare(
        `INSERT INTO wizard_defs (id, key, title, description, steps, version, system, updated_at)
         VALUES (?, 'lpa-registry', ?, ?, ?, 1, 1, ?)`
      )
        .bind(
          cuid(),
          "LPA register (data store)",
          "Structured LPA instruments created via the register-an-LPA wizard. Editable as data.",
          JSON.stringify(registry),
          nowIso()
        )
        .run();
    }
    return json({ ok: true, action, instrument }, 201);
  }

  // ---------------- document intake (paste path) ----------------
  if (action === "intake-document") {
    const title = str("title") || "Pasted text";
    const pastedText = str("pastedText");
    const category = str("category") || "other";
    if (!pastedText) {
      return json({ ok: false, error: "Paste the document text (file uploads use the vault upload panel)." }, 400);
    }
    const id = cuid();
    const fileName = `${title.replace(/[^\w -]/g, "").slice(0, 40) || "pasted"}.txt`;
    const sensitivity = ["standard", "sensitive", "restricted"].includes(str("sensitivity")) ? str("sensitivity") : "standard";
    await DB.prepare(
      `INSERT INTO vault_documents
       (id, subject_id, title, category, file_name, mime_type, size, sensitivity, data, r2_key, text_extract, tags, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, '', '', ?, ?, ?, ?)`
    )
      .bind(
        id,
        subjectId,
        title.slice(0, 200),
        category.slice(0, 40),
        fileName,
        new TextEncoder().encode(pastedText).length,
        sensitivity,
        pastedText.slice(0, 400_000),
        JSON.stringify([category]),
        actor,
        nowIso()
      )
      .run();
    const doc = await DB.prepare("SELECT * FROM vault_documents WHERE id = ?").bind(id).first<VaultDocRow>();
    const facts = extractFacts(fileName, "text/plain", pastedText, { category });
    let created = 0;
    for (const f of facts) {
      await DB.prepare(
        `INSERT INTO extracted_facts
         (id, subject_id, document_id, key, label, value, quote, confidence, status, source, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`
      )
        .bind(cuid(), subjectId, id, f.key, f.label, f.value.slice(0, 300), f.quote.slice(0, 500), f.confidence, f.source, nowIso())
        .run();
      created++;
    }
    return json(
      { ok: true, action, document: { ...(doc ? toVaultDocument(doc) : { id }), data: undefined }, factsFound: facts.length, factsQueued: created },
      201
    );
  }

  // ---------------- custom wizards (framework is open) ----------------
  return json({
    ok: true,
    action: "custom",
    note: `Wizard "${wizardKey}" completed. No system action is bound to this key — bind one in code or use the studio to record runs.`,
    values,
  });
};

// ---------------------------------------------------------------------------

export function registerWizardRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/wizards", listWizards);
  routeFn("POST", "/api/wizards", createWizard);
  routeFn("PUT", "/api/wizards/:id", updateWizard);
  routeFn("DELETE", "/api/wizards/:id", deleteWizard);
  routeFn("POST", "/api/wizard-runs", runWizard);
}
