// Finances API — the money ledger for a service user's affairs: income,
// expenditure, receipts (linked to vault documents) and OPG reportability.
// GET seeds fictional demo entries once so the section demonstrates itself.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

function d(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

async function seedOnce() {
  const count = await db.financeEntry.count();
  if (count > 0) return;
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
    await db.financeEntry.create({ data: { ...e, createdBy: "demo-seed" } });
  }
}

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    await seedOnce();
    const subjectId = req.nextUrl.searchParams.get("subjectId");
    const rows = await db.financeEntry.findMany({
      where: subjectId ? { subjectId } : {},
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    const totals = rows.reduce(
      (acc, r) => {
        if (r.type === "income") acc.income += r.amount;
        else acc.expenses += r.amount;
        if (r.opgReportable) acc.opgReportable += r.type === "expense" ? r.amount : -r.amount;
        return acc;
      },
      { income: 0, expenses: 0, opgReportable: 0 }
    );
    return NextResponse.json({ ok: true, entries: rows, totals });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async (session) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amount = Number(body.amount);
    const type = String(body.type || "expense");
    const description = String(body.description || "").trim();
    const date = String(body.date || "").slice(0, 10);
    if (!description || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !["income", "expense"].includes(type)) {
      return NextResponse.json(
        { ok: false, error: "description, a positive amount, YYYY-MM-DD date and type (income|expense) are required." },
        { status: 400 }
      );
    }
    const row = await db.financeEntry.create({
      data: {
        subjectId: String(body.subjectId || ""),
        date,
        type,
        category: String(body.category || "other").slice(0, 40),
        description: description.slice(0, 300),
        amount,
        receiptId: String(body.receiptId || ""),
        opgReportable: body.opgReportable !== false,
        notes: String(body.notes || "").slice(0, 500),
        createdBy: session.n || "family",
      },
    });
    return NextResponse.json({ ok: true, entry: row }, { status: 201 });
  });
}
