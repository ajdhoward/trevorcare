// Service-user registry — ported 1:1 from src/app/api/subjects/route.ts.
// GET lists subjects (seeding the fictional demo subjects on first call);
// POST adds a subject — the "add a service user" wizard's target.
// Same JSON shapes as the Next.js original so client code is unchanged.

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

export function registerSubjectRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/subjects", listSubjectsHandler);
  routeFn("POST", "/api/subjects", createSubject);
}
