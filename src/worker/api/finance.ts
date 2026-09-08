// Finances — ported 1:1 from:
//   src/app/api/finance/route.ts      (GET list + demo seed, POST create)
//   src/app/api/finance/[id]/route.ts (DELETE, PATCH)
//
// Parity notes:
//  - Envelopes/fields/status codes/error strings preserved exactly, including
//    the GET totals shape { income, expenses, opgReportable } and the 201s.
//  - opg_reportable is an INTEGER in D1 → mapped back to a boolean via
//    Boolean(x); amount is REAL → number; created_at → ISO string.
//  - PATCH quirk preserved: the original Prisma update on a missing record
//    throws, which withSession turns into a 500 "Server error — see logs."
//    envelope (not a 404). DELETE *does* return 404 "Not found" (it caught).
//  - GET seeds the fictional demo ledger on first call, like the original.

import { route, type Handler } from "../router";
import { cuid, fail, json, nowIso } from "../util";

interface FinanceEntryRow {
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

/** D1 row → the camelCase JSON the client expects. */
function toEntry(row: FinanceEntryRow): Record<string, unknown> {
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

function d(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function seedOnce(DB: D1Database): Promise<void> {
  const count = await DB.prepare("SELECT COUNT(*) AS n FROM finance_entries").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  const demo = [
    { subjectId: "subj-demo-home", date: d(3), type: "expense", category: "care-fees", description: "Domiciliary care — sample invoice (monthly)", amount: 1180.0, opgReportable: true, notes: "Standing order sample" },
    { subjectId: "subj-demo-home", date: d(7), type: "expense", category: "household", description: "Groceries — sample supermarket receipt", amount: 54.62, opgReportable: true, notes: "" },
    { subjectId: "subj-demo-home", date: d(10), type: "expense", category: "utilities", description: "Energy bill — sample", amount: 96.4, opgReportable: true, notes: "" },
    { subjectId: "subj-demo-home", date: d(12), type: "expense", category: "council-tax", description: "Council tax — sample monthly instalment", amount: 158.0, opgReportable: true, notes: "" },
    { subjectId: "subj-demo-home", date: d(14), type: "income", category: "pension", description: "State pension — sample", amount: 221.2, opgReportable: false, notes: "Weekly x4 approximation" },
    { subjectId: "subj-demo-home", date: d(16), type: "expense", category: "medical", description: "Podiatry — sample private appointment", amount: 38.0, opgReportable: true, notes: "" },
    { subjectId: "subj-demo-residential", date: d(5), type: "expense", category: "care-fees", description: "Residential care fees — sample invoice", amount: 3420.0, opgReportable: true, notes: "Deferred payment sample note" },
    { subjectId: "subj-demo-residential", date: d(9), type: "expense", category: "personal", description: "Hairdresser at home — sample", amount: 18.0, opgReportable: true, notes: "" },
    { subjectId: "subj-demo-residential", date: d(15), type: "income", category: "attendance-allowance", description: "Attendance Allowance — sample", amount: 434.0, opgReportable: false, notes: "" },
  ];
  for (const e of demo) {
    await DB.prepare(
      `INSERT INTO finance_entries
       (id, subject_id, date, type, category, description, amount, receipt_id, opg_reportable, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, 'demo-seed', ?)`
    )
      .bind(cuid(), e.subjectId, e.date, e.type, e.category, e.description, e.amount, e.opgReportable ? 1 : 0, e.notes, nowIso())
      .run();
  }
}

const listEntries: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  await seedOnce(DB);
  const subjectId = ctx.url.searchParams.get("subjectId");
  const result = subjectId
    ? await DB.prepare("SELECT * FROM finance_entries WHERE subject_id = ? ORDER BY date DESC, created_at DESC")
        .bind(subjectId)
        .all<FinanceEntryRow>()
    : await DB.prepare("SELECT * FROM finance_entries ORDER BY date DESC, created_at DESC").all<FinanceEntryRow>();
  const rows = result.results ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      if (r.type === "income") acc.income += r.amount;
      else acc.expenses += r.amount;
      if (r.opg_reportable) acc.opgReportable += r.type === "expense" ? r.amount : -r.amount;
      return acc;
    },
    { income: 0, expenses: 0, opgReportable: 0 }
  );
  return json({ ok: true, entries: rows.map(toEntry), totals });
};

const createEntry: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = Number(body.amount);
  const type = String(body.type || "expense");
  const description = String(body.description || "").trim();
  const date = String(body.date || "").slice(0, 10);
  if (!description || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["income", "expense"].includes(type)) {
    return fail("description, a positive amount, YYYY-MM-DD date and type (income|expense) are required.", 400);
  }
  const id = cuid();
  await DB.prepare(
    `INSERT INTO finance_entries
     (id, subject_id, date, type, category, description, amount, receipt_id, opg_reportable, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      String(body.subjectId || ""),
      date,
      type,
      String(body.category || "other").slice(0, 40),
      description.slice(0, 300),
      amount,
      String(body.receiptId || ""),
      body.opgReportable !== false ? 1 : 0,
      String(body.notes || "").slice(0, 500),
      ctx.actor || "family",
      nowIso()
    )
    .run();
  const row = await DB.prepare("SELECT * FROM finance_entries WHERE id = ?").bind(id).first<FinanceEntryRow>();
  return json({ ok: true, entry: row ? toEntry(row) : { id } }, 201);
};

const deleteEntry: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const row = await DB.prepare("SELECT * FROM finance_entries WHERE id = ?").bind(id).first<FinanceEntryRow>();
  if (!row) return fail("Not found", 404);
  await DB.prepare("DELETE FROM finance_entries WHERE id = ?").bind(id).run();
  // The audit copy of the deleted entry is returned to the caller.
  return json({ ok: true, deleted: toEntry(row) });
};

const patchEntry: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.receiptId === "string") {
    sets.push("receipt_id = ?");
    binds.push(body.receiptId);
  }
  if (typeof body.notes === "string") {
    sets.push("notes = ?");
    binds.push(body.notes.slice(0, 500));
  }
  if (typeof body.opgReportable === "boolean") {
    sets.push("opg_reportable = ?");
    binds.push(body.opgReportable ? 1 : 0);
  }
  let row = await DB.prepare("SELECT * FROM finance_entries WHERE id = ?").bind(id).first<FinanceEntryRow>();
  if (!row) {
    // Parity: the original Prisma update throws P2025 on a missing record and
    // withSession converts that into this exact 500 envelope.
    return fail("Server error — see logs.", 500);
  }
  if (sets.length) {
    await DB.prepare(`UPDATE finance_entries SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, id)
      .run();
    row = (await DB.prepare("SELECT * FROM finance_entries WHERE id = ?").bind(id).first<FinanceEntryRow>()) ?? row;
  }
  return json({ ok: true, entry: toEntry(row) });
};

export function registerFinanceRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/finance", listEntries);
  routeFn("POST", "/api/finance", createEntry);
  routeFn("DELETE", "/api/finance/:id", deleteEntry);
  routeFn("PATCH", "/api/finance/:id", patchEntry);
}
