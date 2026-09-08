// Service-user registry — ported 1:1 from src/app/api/subjects/route.ts (C1)
// and src/app/api/subjects/[id]/route.ts (C2).
// GET /api/subjects lists subjects (seeding the fictional demo subjects on
// first call); POST adds a subject; GET/PATCH/DELETE /api/subjects/:id update,
// archive (soft delete) or hard-delete (cascade vault/facts/finance/research).
// Same JSON shapes as the Next.js originals so client code is unchanged.
// Parity note: Prisma update/delete on a missing row throws (Next → HTTP 500);
// here we check existence and throw into the router's catch, which also 500s.

import { route, type Handler } from "../router";
import { cuid, fail, json, nowIso } from "../util";
import { DEMO_SUBJECTS } from "../../lib/subjects";

interface SubjectRow {
  id: string;
  display_name: string;
  relationship: string;
  setting: string;
  date_of_birth: string;
  nhs_number: string;
  address: string;
  phone: string;
  profile: string;
  sort_order: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

/** D1 row → the camelCase JSON the client expects (parseSubject parity). */
function toSubject(row: SubjectRow): Record<string, unknown> {
  let profile: unknown = {};
  try {
    profile = JSON.parse(row.profile || "{}");
  } catch {
    profile = {};
  }
  return {
    id: row.id,
    displayName: row.display_name,
    relationship: row.relationship,
    setting: row.setting,
    dateOfBirth: row.date_of_birth,
    nhsNumber: row.nhs_number,
    address: row.address,
    phone: row.phone,
    profile,
    sortOrder: row.sort_order,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function seedOnce(DB: D1Database): Promise<void> {
  const count = await DB.prepare("SELECT COUNT(*) AS n FROM care_subjects").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;
  for (const s of DEMO_SUBJECTS) {
    await DB.prepare(
      `INSERT INTO care_subjects
       (id, display_name, relationship, setting, date_of_birth, nhs_number, address, phone, profile, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
      .bind(
        s.id,
        s.displayName,
        s.relationship,
        s.setting,
        s.dateOfBirth,
        s.nhsNumber,
        s.address,
        s.phone,
        JSON.stringify(s.profile),
        s.sortOrder,
        nowIso(),
        nowIso()
      )
      .run();
  }
}

const listSubjectsHandler: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  await seedOnce(DB);
  const includeArchived = ctx.url.searchParams.get("includeArchived") === "1";
  const result = await DB.prepare(
    `SELECT * FROM care_subjects ORDER BY sort_order ASC, created_at ASC`
  ).all<SubjectRow>();
  const subjects = (result.results ?? [])
    .filter((r) => includeArchived || !r.archived)
    .map(toSubject);
  return json({ ok: true, subjects });
};

const createSubject: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const displayName = String(body.displayName || "").trim();
  if (!displayName) return fail("A name is required.", 400);

  const max = await DB.prepare("SELECT MAX(sort_order) AS m FROM care_subjects").first<{ m: number | null }>();
  const id = cuid();
  const now = nowIso();
  await DB.prepare(
    `INSERT INTO care_subjects
     (id, display_name, relationship, setting, date_of_birth, nhs_number, address, phone, profile, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      id,
      displayName.slice(0, 80),
      String(body.relationship || "").slice(0, 120),
      ["home", "residential", "supported-living"].includes(String(body.setting)) ? String(body.setting) : "home",
      String(body.dateOfBirth || "").slice(0, 10),
      String(body.nhsNumber || "").slice(0, 20),
      String(body.address || "").slice(0, 200),
      String(body.phone || "").slice(0, 40),
      JSON.stringify(body.profile && typeof body.profile === "object" ? body.profile : {}),
      (max?.m ?? -1) + 1,
      now,
      now
    )
    .run();

  const row = await DB.prepare("SELECT * FROM care_subjects WHERE id = ?").bind(id).first<SubjectRow>();
  return json({ ok: true, subject: row ? toSubject(row) : { id } }, 201);
};

// ---------------------------------------------------------------------------
// Per-subject routes — ported from src/app/api/subjects/[id]/route.ts
// ---------------------------------------------------------------------------

/** camelCase body field → snake_case column (PATCH partial update). */
const SUBJECT_FIELD_COLUMNS: Record<string, string> = {
  displayName: "display_name",
  relationship: "relationship",
  setting: "setting",
  dateOfBirth: "date_of_birth",
  nhsNumber: "nhs_number",
  address: "address",
  phone: "phone",
};

const getSubject: Handler = async (ctx) => {
  const row = await ctx.env.DB.prepare("SELECT * FROM care_subjects WHERE id = ?")
    .bind(ctx.params.id)
    .first<SubjectRow>();
  if (!row) return json({ ok: false, error: "Not found" }, 404);
  return json({ ok: true, subject: toSubject(row) });
};

const patchSubject: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Prisma throws on update of a missing row (Next responds 500) — mirror it.
  const existing = await DB.prepare("SELECT * FROM care_subjects WHERE id = ?").bind(id).first<SubjectRow>();
  if (!existing) throw new Error("Not found");

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ["displayName", "relationship", "setting", "dateOfBirth", "nhsNumber", "address", "phone"] as const) {
    if (typeof body[k] === "string") {
      sets.push(`${SUBJECT_FIELD_COLUMNS[k]} = ?`);
      vals.push((body[k] as string).slice(0, 200));
    }
  }
  if (typeof body.archived === "boolean") {
    sets.push("archived = ?");
    vals.push(body.archived ? 1 : 0);
  }
  if (body.profile && typeof body.profile === "object") {
    sets.push("profile = ?");
    vals.push(JSON.stringify(body.profile));
  }
  sets.push("updated_at = ?");
  vals.push(nowIso());

  await DB.prepare(`UPDATE care_subjects SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals, id)
    .run();
  const row = await DB.prepare("SELECT * FROM care_subjects WHERE id = ?").bind(id).first<SubjectRow>();
  return json({ ok: true, subject: row ? toSubject(row) : null });
};

const deleteSubject: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const existing = await DB.prepare("SELECT * FROM care_subjects WHERE id = ?").bind(id).first<SubjectRow>();
  if (!existing) throw new Error("Not found"); // Prisma delete on missing row throws → 500

  const hard = ctx.url.searchParams.get("hard") === "1";
  if (hard) {
    // D1 batch ≈ db.$transaction([...]) — all-or-nothing cascade.
    await DB.batch([
      DB.prepare("DELETE FROM vault_documents WHERE subject_id = ?").bind(id),
      DB.prepare("DELETE FROM extracted_facts WHERE subject_id = ?").bind(id),
      DB.prepare("DELETE FROM finance_entries WHERE subject_id = ?").bind(id),
      DB.prepare("DELETE FROM research_runs WHERE subject_id = ?").bind(id),
      DB.prepare("DELETE FROM care_subjects WHERE id = ?").bind(id),
    ]);
    return json({ ok: true, archived: false, deleted: true });
  }
  await DB.prepare("UPDATE care_subjects SET archived = 1, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  const row = await DB.prepare("SELECT * FROM care_subjects WHERE id = ?").bind(id).first<SubjectRow>();
  return json({ ok: true, subject: row ? toSubject(row) : null, archived: true });
};

export function registerSubjectRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/subjects", listSubjectsHandler);
  routeFn("POST", "/api/subjects", createSubject);
  routeFn("GET", "/api/subjects/:id", getSubject);
  routeFn("PATCH", "/api/subjects/:id", patchSubject);
  routeFn("DELETE", "/api/subjects/:id", deleteSubject);
}
