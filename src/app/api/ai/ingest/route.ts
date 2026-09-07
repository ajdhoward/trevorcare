// AI feedback inbox — receives AI review output (pasted or uploaded file),
// parses the feedback contract (src/lib/feedback.ts), stores the raw copy +
// parsed items (Prisma / AiFeedback), and returns the parsed items for the
// family to apply into live stores with audit entries.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractFeedbackItems } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.aiFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({
    feedback: rows.map((r) => ({ ...r, parsed: JSON.parse(r.items || "[]") })),
  });
}

export async function POST(req: NextRequest) {
  let body: { title?: string; fileName?: string; text?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "No feedback text received — paste the AI's reply or upload its file." }, { status: 400 });
  const items = extractFeedbackItems(text);
  const row = await db.aiFeedback.create({
    data: {
      source: body.source === "file" ? "file" : "paste",
      fileName: (body.fileName ?? "").slice(0, 200),
      title: (body.title ?? "").slice(0, 200) || `AI review — ${new Date().toLocaleDateString("en-GB")}`,
      raw: text.slice(0, 200_000),
      items: JSON.stringify(items),
      status: "received",
    },
  });
  return NextResponse.json({ id: row.id, items });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const status = ["received", "applied", "dismissed"].includes(body.status ?? "") ? body.status! : "received";
  const row = await db.aiFeedback.update({ where: { id: body.id }, data: { status } });
  return NextResponse.json({ feedback: { ...row, parsed: JSON.parse(row.items || "[]") } });
}
