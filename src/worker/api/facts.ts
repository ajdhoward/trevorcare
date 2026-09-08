// Extracted-fact review queue — ported 1:1 from src/app/api/facts/route.ts (C2).
// GET lists facts (optionally per subject / status). PATCH confirms or rejects
// a fact; confirming a profile-relevant key writes it straight into the
// subject's profile JSON (server-side) so the About-the-subject section stays
// the single source of truth.
//
// Parity notes:
// - Response shapes preserved: { ok, facts } / { ok, fact } with Prisma's
//   camelCase fields (confidence as REAL float, decidedAt ISO string or null).
// - Prisma update of a missing fact throws (Next → HTTP 500); mirrored by
//   throwing into the router's catch.
// - Prisma bumps updatedAt automatically; here updated_at is set explicitly.

import { route, type Handler } from "../router";
import { json, nowIso } from "../util";

interface FactRow {
  id: string;
  subject_id: string;
  document_id: string;
  key: string;
  label: string;
  value: string;
  quote: string;
  confidence: number;
  status: string;
  source: string;
  created_at: string;
  decided_at: string | null;
}

interface SubjectRow {
  id: string;
  profile: string;
}

/** fact.key → subject profile key (identical to the original mapping). */
const PROFILE_KEYS: Record<string, string> = {
  fullName: "preferredName",
  dateOfBirth: "dateOfBirth",
  nhsNumber: "nhsNumber",
  address: "address",
  phone: "phone",
  medication: "medicationsSummary",
  careHome: "careHome",
  opgReference: "opgReference",
};

/** fact.key → care_subjects column that mirrors the profile key, if any. */
const PROFILE_KEY_COLUMNS: Record<string, string> = {
  dateOfBirth: "date_of_birth",
  nhsNumber: "nhs_number",
  address: "address",
  phone: "phone",
};

function toFact(row: FactRow): Record<string, unknown> {
  return {
    id: row.id,
    subjectId: row.subject_id,
    documentId: row.document_id,
    key: row.key,
    label: row.label,
    value: row.value,
    quote: row.quote,
    confidence: row.confidence,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

const listFacts: Handler = async (ctx) => {
  const subjectId = ctx.url.searchParams.get("subjectId");
  const status = ctx.url.searchParams.get("status");
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (subjectId) {
    conds.push("subject_id = ?");
    vals.push(subjectId);
  }
  if (status) {
    conds.push("status = ?");
    vals.push(status);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const result = await ctx.env.DB.prepare(
    `SELECT * FROM extracted_facts ${where} ORDER BY created_at DESC LIMIT 200`
  )
    .bind(...vals)
    .all<FactRow>();
  return json({ ok: true, facts: (result.results ?? []).map(toFact) });
};

const decideFact: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as { id?: string; status?: string };
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !["confirmed", "rejected", "pending"].includes(status)) {
    return json({ ok: false, error: "id and status (confirmed|rejected|pending) are required." }, 400);
  }
  const existing = await DB.prepare("SELECT * FROM extracted_facts WHERE id = ?").bind(id).first<FactRow>();
  if (!existing) throw new Error("Fact not found"); // Prisma update of missing row throws → 500

  const decidedAt = nowIso();
  await DB.prepare("UPDATE extracted_facts SET status = ?, decided_at = ? WHERE id = ?")
    .bind(status, decidedAt, id)
    .run();

  // confirm → project into the subject profile where a mapping exists
  if (status === "confirmed" && existing.subject_id) {
    const profileKey = PROFILE_KEYS[existing.key];
    const subject = await DB.prepare("SELECT id, profile FROM care_subjects WHERE id = ?")
      .bind(existing.subject_id)
      .first<SubjectRow>();
    if (subject) {
      let profile: Record<string, unknown> = {};
      try {
        profile = JSON.parse(subject.profile || "{}") as Record<string, unknown>;
      } catch {
        profile = {};
      }
      const column = PROFILE_KEY_COLUMNS[existing.key];
      if (column) {
        await DB.prepare(`UPDATE care_subjects SET ${column} = ?, updated_at = ? WHERE id = ?`)
          .bind(existing.value, nowIso(), subject.id)
          .run();
      }
      if (profileKey) {
        profile[profileKey] = existing.value;
        profile[`${profileKey}ConfirmedFrom`] = existing.quote;
        await DB.prepare("UPDATE care_subjects SET profile = ?, updated_at = ? WHERE id = ?")
          .bind(JSON.stringify(profile), nowIso(), subject.id)
          .run();
      }
    }
  }

  const row = await DB.prepare("SELECT * FROM extracted_facts WHERE id = ?").bind(id).first<FactRow>();
  return json({ ok: true, fact: row ? toFact(row) : null });
};

export function registerFactRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/facts", listFacts);
  routeFn("PATCH", "/api/facts", decideFact);
}
