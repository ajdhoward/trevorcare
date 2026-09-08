// Data vault — ported 1:1 from:
//   src/app/api/vault/route.ts            (GET list, POST upload)
//   src/app/api/vault/[id]/route.ts       (GET download, DELETE)
//   src/app/api/vault/[id]/extract/route.ts (POST extraction)
//
// Parity notes:
//  - Response envelopes, field names, status codes and error strings are kept
//    exactly as the Next.js originals (including the 413/422 texts and the
//    "data: undefined"-shaped POST document, i.e. no data/r2Key field is ever
//    exposed in JSON).
//  - STORAGE: the original kept base64 payloads in SQLite (vault_documents.data).
//    On D1, payloads go to the DOCUMENTS R2 bucket with the key recorded in
//    vault_documents.r2_key (data column stays ''). The download route reads
//    R2 first and falls back to the legacy base64 data column; DELETE removes
//    the R2 object best-effort.
//  - src/lib/extract.ts is pure TypeScript but uses Node's Buffer, which does
//    not exist in Workers, so its logic (extractText + the deterministic
//    extractFacts engine) is inlined verbatim over Uint8Array below.
//  - DELETE/PATCH parity quirk preserved: the original Prisma delete/update on
//    a missing record throws, which withSession turns into a 500
//    "Server error — see logs." envelope (not a 404).

import { route, type Handler } from "../router";
import { cuid, fail, json, nowIso } from "../util";

const MAX_BYTES = 8 * 1024 * 1024;

interface VaultDocumentRow {
  id: string;
  subject_id: string;
  title: string;
  category: string;
  file_name: string;
  mime_type: string;
  size: number;
  sensitivity: string;
  data: string;
  r2_key: string;
  text_extract: string;
  tags: string;
  uploaded_by: string;
  created_at: string;
}

/** D1 row → the camelCase JSON the client expects (Prisma row minus `data`). */
function toDocument(row: VaultDocumentRow): Record<string, unknown> {
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

// ---------------------------------------------------------------------------
// Byte helpers (Buffer replacements)
// ---------------------------------------------------------------------------

/** Lenient base64 → bytes (Node's Buffer.from(s, "base64") analogue). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (!clean) return new Uint8Array(0);
  let bin = "";
  try {
    bin = atob(clean);
  } catch {
    try {
      bin = atob(clean.replace(/[^A-Za-z0-9+/=]/g, ""));
    } catch {
      return new Uint8Array(0);
    }
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Buffer.byteLength(s, "base64") analogue: decoded byte count of base64. */
function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s+/g, "");
  if (!clean) return 0;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Buffer#toString("latin1") analogue (chunked to avoid call-stack limits). */
function latin1Decode(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction engine — inlined from src/lib/extract.ts (deterministic: regex /
// MRZ checksum / field parsers; no model involved). Verbatim except extractText,
// which takes a Uint8Array instead of a Buffer.
// ---------------------------------------------------------------------------

interface RawFact {
  key: string;
  label: string;
  value: string;
  quote: string;
  confidence: number;
  source: string; // passport-mrz | birth-certificate | chat-transcript | pattern
}

function mrzCharValue(c: string): number {
  if (/[0-9]/.test(c)) return c.charCodeAt(0) - 48;
  if (/[A-Z]/.test(c)) return c.charCodeAt(0) - 55;
  return 0; // '<'
}

function mrzCheckDigit(data: string, check: string): boolean {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += mrzCharValue(data[i]) * weights[i % 3];
  return sum % 10 === Number(check);
}

function expandYear(yy: string): string {
  // ICAO: YYMMDD. For dates of birth, years > current two-digit year → 1900s.
  const curYY = new Date().getFullYear() % 100;
  const n = Number(yy);
  return (n > curYY ? "19" : "20") + yy;
}

function parsePassportMrz(text: string): RawFact[] {
  const facts: RawFact[] = [];
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Z0-9<]{30,44}$/.test(l));

  const l1 = lines.find((l) => /^P</.test(l));
  if (!l1) return facts;
  const l1idx = lines.indexOf(l1);
  const l2 = lines[l1idx + 1];
  if (!l2) return facts;

  // line 2 layout: passportNo(9) check(1) nationality(3) dob(6) check(1)
  //                sex(1) expiry(6) check(1) personalNo(14) check(1) final(1)
  const passNo = l2.slice(0, 9).replace(/</g, "");
  const passCheck = l2[9];
  const nationality = l2.slice(10, 13).replace(/</g, "");
  const dobRaw = l2.slice(13, 19);
  const dobCheck = l2[19];
  const sex = l2[20];
  const expRaw = l2.slice(21, 27);
  const expCheck = l2[27];

  const push = (fact: RawFact, verified: boolean) => {
    if (verified) facts.push(fact);
  };

  if (passNo && mrzCheckDigit(l2.slice(0, 9), passCheck)) {
    push(
      {
        key: "passportNumber",
        label: "Passport number",
        value: passNo,
        quote: l2.slice(0, 10),
        confidence: 0.98,
        source: "passport-mrz",
      },
      true
    );
  }
  if (nationality) {
    push(
      {
        key: "nationality",
        label: "Nationality (ISO code)",
        value: nationality,
        quote: l2.slice(10, 13),
        confidence: 0.95,
        source: "passport-mrz",
      },
      true
    );
  }
  if (/^\d{6}$/.test(dobRaw) && mrzCheckDigit(dobRaw, dobCheck)) {
    const ym = expandYear(dobRaw.slice(0, 2));
    push(
      {
        key: "dateOfBirth",
        label: "Date of birth",
        value: `${ym}-${dobRaw.slice(2, 4)}-${dobRaw.slice(4, 6)}`,
        quote: dobRaw,
        confidence: 0.97,
        source: "passport-mrz",
      },
      true
    );
  }
  if (sex === "F" || sex === "M" || sex === "X") {
    push(
      {
        key: "sex",
        label: "Sex",
        value: sex,
        quote: l2[20],
        confidence: 0.95,
        source: "passport-mrz",
      },
      true
    );
  }
  if (/^\d{6}$/.test(expRaw) && mrzCheckDigit(expRaw, expCheck)) {
    push(
      {
        key: "passportExpiry",
        label: "Passport expiry",
        value: `20${expRaw.slice(0, 2)}-${expRaw.slice(2, 4)}-${expRaw.slice(4, 6)}`,
        quote: expRaw,
        confidence: 0.97,
        source: "passport-mrz",
      },
      true
    );
  }
  // names from line 1: P<SURNAME<<GIVEN<NAMES<<<<
  const namePart = l1.slice(5);
  const nameMatch = namePart.match(/^([A-Z]+)<<?([A-Z<]*)/);
  if (nameMatch) {
    const surname = nameMatch[1].replace(/</g, " ").trim();
    const given = (nameMatch[2] || "").replace(/</g, " ").trim();
    push(
      {
        key: "fullName",
        label: "Full name (as in passport)",
        value: `${given} ${surname}`.trim(),
        quote: l1.slice(5, 5 + nameMatch[0].length),
        confidence: 0.9,
        source: "passport-mrz",
      },
      surname.length > 0
    );
  }
  return facts;
}

function parseBirthCertificate(text: string): RawFact[] {
  const facts: RawFact[] = [];
  const q = (re: RegExp): string | null => {
    const m = text.match(re);
    return m ? m[0] : null;
  };

  const name = q(/(?:Name and surname|Name of child|Full name at birth)[:\s]+([A-Z][A-Za-z' -]{2,60})/i);
  if (name)
    facts.push({
      key: "fullName",
      label: "Full name at birth",
      value: name.split(/[:\s]/).slice(1).join(" ").trim(),
      quote: name,
      confidence: 0.85,
      source: "birth-certificate",
    });

  const dob = q(/(?:Date of birth)[:\s]+(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
  if (dob) {
    const v = dob.split(/[:\s]/).slice(1).join(" ").trim();
    facts.push({
      key: "dateOfBirth",
      label: "Date of birth",
      value: normalizeDate(v) ?? v,
      quote: dob,
      confidence: 0.85,
      source: "birth-certificate",
    });
  }

  const place = q(/(?:Place of birth)[:\s]+([A-Za-z ,.'-]{3,60})/i);
  if (place)
    facts.push({
      key: "placeOfBirth",
      label: "Place of birth",
      value: place.split(/[:\s]/).slice(1).join(" ").trim().replace(/[,.]$/, ""),
      quote: place,
      confidence: 0.8,
      source: "birth-certificate",
    });

  const mother = q(/(?:Name and maiden surname of mother|Mother's name)[:\s]+([A-Z][A-Za-z' -]{2,60})/i);
  if (mother)
    facts.push({
      key: "mothersName",
      label: "Mother's name",
      value: mother.split(/[:\s]/).slice(1).join(" ").trim(),
      quote: mother,
      confidence: 0.8,
      source: "birth-certificate",
    });

  const father = q(/(?:Name and surname of father|Father's name)[:\s]+([A-Z][A-Za-z' -]{2,60})/i);
  if (father)
    facts.push({
      key: "fathersName",
      label: "Father's name",
      value: father.split(/[:\s]/).slice(1).join(" ").trim(),
      quote: father,
      confidence: 0.8,
      source: "birth-certificate",
    });

  const district = q(/(?:Registration district)[:\s]+([A-Za-z ,.'-]{3,60})/i);
  if (district)
    facts.push({
      key: "registrationDistrict",
      label: "Registration district",
      value: district.split(/[:\s]/).slice(1).join(" ").trim().replace(/[,.]$/, ""),
      quote: district,
      confidence: 0.85,
      source: "birth-certificate",
    });

  const entry = q(/(?:Entry number|Entry No\.?)[:\s]+(\d{1,8})/i);
  if (entry)
    facts.push({
      key: "entryNumber",
      label: "Entry number",
      value: entry.split(/[:\s]/).pop() ?? "",
      quote: entry,
      confidence: 0.85,
      source: "birth-certificate",
    });

  return facts;
}

function normalizeDate(v: string): string | null {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return v;
  const uk = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (uk) {
    const y = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${y}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }
  const long = v.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
  if (long) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    return `${long[3]}-${String(months.indexOf(long[2].toLowerCase()) + 1).padStart(2, "0")}-${long[1].padStart(2, "0")}`;
  }
  return null;
}

interface ParsedChat {
  messages: Array<{ role: string; content: string; ts?: string }>;
  facts: RawFact[];
}

function parseChatTranscript(raw: string): ParsedChat {
  const messages: ParsedChat["messages"] = [];
  const text = raw.trim();

  // 1) try JSON exports
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      type ChatNode = { role?: string; author?: { role?: string }; content?: { parts?: unknown[] } | string; create_time?: number };
      const nodes: ChatNode[] = Array.isArray(data)
        ? (data as ChatNode[])
        : Array.isArray((data as { messages?: ChatNode[] }).messages)
          ? ((data as { messages: ChatNode[] }).messages)
          : // ChatGPT mapping shape
            Object.values((data as { mapping?: Record<string, ChatNode> }).mapping ?? {});
      for (const n of nodes) {
        const role = n.role ?? n.author?.role ?? "unknown";
        let content = "";
        if (typeof n.content === "string") content = n.content;
        else if (Array.isArray(n.content?.parts)) content = (n.content.parts as unknown[]).filter((p): p is string => typeof p === "string").join("\n");
        if (content.trim()) {
          messages.push({ role, content: content.trim(), ts: n.create_time ? new Date(n.create_time * 1000).toISOString() : undefined });
        }
      }
    } catch {
      /* fall through to plain text */
    }
  }

  // 2) plain text with role markers
  if (messages.length === 0) {
    const lines = text.split(/\r?\n/);
    let cur: { role: string; content: string } | null = null;
    for (const line of lines) {
      const m = line.match(/^\s*(?:\*\*)?(user|assistant|human|ai|system|you|me)(?:\*\*)?\s*[:：]\s*(.*)$/i);
      if (m) {
        if (cur) messages.push(cur);
        const role = /human|user|me|you/i.test(m[1]) ? "user" : "assistant";
        cur = { role, content: m[2] };
      } else if (cur) {
        cur.content += "\n" + line;
      }
    }
    if (cur) messages.push(cur);
  }

  // 3) fact mining over the combined text (deterministic patterns)
  const facts = mineFactsFromText(text, "chat-transcript");
  return { messages, facts };
}

const GENERIC_PATTERNS: Array<{ key: string; label: string; re: RegExp; conf: number }> = [
  { key: "nhsNumber", label: "NHS number", re: /\bNHS\s*(?:no\.?|number)?[:\s]*(\d{3}\s?\d{3}\s?\d{4})\b/i, conf: 0.9 },
  { key: "nhsNumber", label: "NHS number", re: /\b(\d{3}[- ]\d{3}[- ]\d{4})\b/, conf: 0.7 },
  { key: "dateOfBirth", label: "Date of birth", re: /\b(?:DOB|date of birth|born)\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i, conf: 0.85 },
  { key: "postcode", label: "Postcode", re: /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/, conf: 0.75 },
  { key: "phone", label: "Phone number", re: /\b(?:tel|phone|mobile|contact)\s*[:\-]?\s*(\+?44\s?\d{3,4}[\s-]?\d{3}[\s-]?\d{3,4}|0\d{3,4}[\s-]?\d{3}[\s-]?\d{3,4})/i, conf: 0.8 },
  { key: "medication", label: "Medication mention", re: /\b(?:prescribed|taking|medication[:\s]+|tablet[s]?\s+of)\s+([A-Z][a-z]{3,}(?:\s(?:\d+\s?mg|prn|daily|twice daily|om|on))*[a-z ]{0,30})/i, conf: 0.65 },
  { key: "hospitalNumber", label: "Hospital number", re: /\b(?:hospital (?:no\.?|number)|Hosp[:\s])\s*[:\-]?\s*([A-Z0-9]{6,10})\b/i, conf: 0.85 },
  { key: "careHome", label: "Care home / provider", re: /\b(?:care home|residential home|provider)\s*[:\-]?\s*([A-Z][A-Za-z '&-]{3,50})/i, conf: 0.7 },
  { key: "opgReference", label: "OPG reference", re: /\b(?:OPG[- ]?(?:ref(?:erence)?)?|MYPG)[:\s-]*([A-Z0-9-]{5,20})\b/i, conf: 0.9 },
];

function mineFactsFromText(text: string, source: string): RawFact[] {
  const facts: RawFact[] = [];
  const seen = new Set<string>();
  for (const p of GENERIC_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const value = (m[1] ?? "").trim();
    if (!value) continue;
    const dedupe = `${p.key}:${value.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const start = Math.max(0, (m.index ?? 0) - 20);
    const quote = text.slice(start, (m.index ?? 0) + m[0].length + 20).replace(/\s+/g, " ").trim();
    let v = value;
    if (p.key === "dateOfBirth") v = normalizeDate(value) ?? value;
    facts.push({ key: p.key, label: p.label, value: v, quote, confidence: p.conf, source });
  }
  return facts;
}

function extractFacts(fileName: string, mimeType: string, text: string, hints?: { category?: string }): RawFact[] {
  const category = hints?.category?.toLowerCase() ?? "";
  const out: RawFact[] = [];
  const seen = new Set<string>();
  const addAll = (facts: RawFact[]) => {
    for (const f of facts) {
      const dedupe = `${f.key}:${f.value.toLowerCase()}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(f);
    }
  };

  const lower = (fileName + " " + category).toLowerCase();

  if (category === "passport" || lower.includes("passport")) {
    addAll(parsePassportMrz(text));
  }
  if (category === "birth-certificate" || lower.includes("birth")) {
    addAll(parseBirthCertificate(text));
  }
  if (category === "chat-export" || mimeType.includes("json") || lower.includes("chat")) {
    addAll(parseChatTranscript(text).facts);
  }
  // always run the generic miner as a safety net
  addAll(mineFactsFromText(text, "pattern"));
  return out;
}

/** Best-effort plain-text extraction for common text-ish uploads. */
function extractText(fileName: string, mimeType: string, buf: Uint8Array): { text: string; method: string } {
  if (mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")) {
    // minimal fallback: pull readable ASCII runs (works for many text-born PDFs;
    // scanned PDFs need OCR — surfaced honestly to the user in the UI)
    const raw = latin1Decode(buf);
    const runs = raw.match(/[ -~]{6,}/g) ?? [];
    const text = runs
      .filter((r) => !/^[A-Za-z]:\\|\/Type\s|\/Font|obj\s*<<|endobj|xref|%%EOF/.test(r))
      .join("\n")
      .replace(/\s{3,}/g, "\n");
    return { text, method: "pdf-ascii (scanned PDFs need OCR — paste text instead)" };
  }
  if (
    mimeType.startsWith("text/") ||
    /\.(txt|md|csv|json|html?|xml|vcard|ics|log)$/i.test(fileName) ||
    mimeType.includes("json")
  ) {
    return { text: utf8Decode(buf), method: "utf8" };
  }
  // binary unknown — extract readable runs (may catch embedded metadata)
  const runs = latin1Decode(buf).match(/[ -~]{8,}/g) ?? [];
  return { text: runs.slice(0, 400).join("\n"), method: "ascii-runs (binary preview)" };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const listDocuments: Handler = async (ctx) => {
  const subjectId = ctx.url.searchParams.get("subjectId");
  const category = ctx.url.searchParams.get("category");
  const clauses: string[] = [];
  const binds: string[] = [];
  if (subjectId) {
    clauses.push("subject_id = ?");
    binds.push(subjectId);
  }
  if (category) {
    clauses.push("category = ?");
    binds.push(category);
  }
  const sql = `SELECT * FROM vault_documents${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC`;
  const result = await ctx.env.DB.prepare(sql).bind(...binds).all<VaultDocumentRow>();
  return json({ ok: true, documents: (result.results ?? []).map(toDocument) });
};

const createDocument: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const uploader = ctx.actor || "family";

  const ct = ctx.req.headers.get("content-type") || "";
  let title = "";
  let category = "other";
  let sensitivity = "standard";
  let subjectId = "";
  let fileName = "";
  let mimeType = "";
  let bytes: Uint8Array | null = null;
  let hasPayload = false; // mirrors the original's truthy `base64` string
  let pastedText = "";

  if (ct.includes("multipart/form-data")) {
    const form = await ctx.req.formData();
    const file = form.get("file");
    title = String(form.get("title") || "");
    category = String(form.get("category") || "other");
    sensitivity = String(form.get("sensitivity") || "standard");
    subjectId = String(form.get("subjectId") || "");
    pastedText = String(form.get("pastedText") || "");
    if (file && typeof file === "object" && "arrayBuffer" in (file as object)) {
      const f = file as File;
      if (f.size > MAX_BYTES) {
        return fail("File exceeds the 8 MB vault limit.", 413);
      }
      bytes = new Uint8Array(await f.arrayBuffer());
      hasPayload = true;
      fileName = f.name;
      mimeType = f.type || "application/octet-stream";
      if (!title) title = f.name;
    }
  } else {
    const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
    title = String(body.title || "");
    category = String(body.category || "other");
    sensitivity = String(body.sensitivity || "standard");
    subjectId = String(body.subjectId || "");
    const base64 = String(body.data || "");
    fileName = String(body.fileName || "");
    mimeType = String(body.mimeType || "text/plain");
    pastedText = String(body.pastedText ?? body.text ?? "");
    // derive a meaningful fileName from the title so filename-based
    // extraction routing (passport/birth/chat) keeps working for pastes
    if (!fileName && title) {
      fileName = `${title.replace(/[^\w -]/g, "").trim().slice(0, 40) || "pasted"}.txt`;
    }
    if (base64 && base64ByteLength(base64) > MAX_BYTES) {
      return fail("File exceeds the 8 MB vault limit.", 413);
    }
    if (base64) {
      bytes = base64ToBytes(base64);
      hasPayload = true;
    }
  }

  if (!title) title = fileName || "Untitled document";

  // text extraction for the search/extraction pipeline
  let textExtract = pastedText;
  let method = pastedText ? "pasted" : "";
  if (!textExtract && bytes && bytes.byteLength > 0) {
    const ex = extractText(fileName, mimeType, bytes);
    textExtract = ex.text.slice(0, 400_000);
    method = ex.method;
  }

  const size = hasPayload ? bytes?.byteLength ?? 0 : new TextEncoder().encode(pastedText || "").length;

  // Payload → R2 (key recorded in r2_key); the base64 `data` column stays ''
  // on the Worker (it remains the read-fallback for legacy rows).
  const id = cuid();
  const now = nowIso();
  let r2Key = "";
  if (bytes && bytes.byteLength > 0) {
    const safeName = fileName.replace(/[^\w.-]+/g, "_").slice(0, 120) || "document";
    r2Key = `vault/${id}/${safeName}`;
    await ctx.env.DOCUMENTS.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType || "application/octet-stream" },
    });
  }

  await DB.prepare(
    `INSERT INTO vault_documents
     (id, subject_id, title, category, file_name, mime_type, size, sensitivity, data, r2_key, text_extract, tags, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      subjectId,
      title.slice(0, 200),
      category.slice(0, 40),
      fileName.slice(0, 200),
      mimeType,
      size,
      ["standard", "sensitive", "restricted"].includes(sensitivity) ? sensitivity : "standard",
      r2Key,
      textExtract,
      JSON.stringify([category, ...(sensitivity !== "standard" ? [sensitivity] : [])]),
      uploader,
      now
    )
    .run();

  const row = await DB.prepare("SELECT * FROM vault_documents WHERE id = ?").bind(id).first<VaultDocumentRow>();
  return json(
    {
      ok: true,
      document: row ? toDocument(row) : { id },
      textMethod: method,
      hasText: textExtract.trim().length > 0,
    },
    201
  );
};

const downloadDocument: Handler = async (ctx) => {
  const row = await ctx.env.DB.prepare("SELECT * FROM vault_documents WHERE id = ?")
    .bind(ctx.params.id)
    .first<VaultDocumentRow>();
  if (!row) return fail("Not found", 404);

  let bytes: Uint8Array | null = null;
  if (row.r2_key) {
    try {
      const obj = await ctx.env.DOCUMENTS.get(row.r2_key);
      if (obj) bytes = new Uint8Array(await obj.arrayBuffer());
    } catch {
      bytes = null; // fall through to the base64 column
    }
  }
  if (!bytes && row.data) bytes = base64ToBytes(row.data);
  if (!bytes || bytes.byteLength === 0) {
    return fail("This entry has no stored file (text-only).", 404);
  }

  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(row.file_name || row.title)}"`,
      "Cache-Control": "no-store",
      "X-Vault-Sensitivity": row.sensitivity,
    },
  });
};

const deleteDocument: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const row = await DB.prepare("SELECT id, r2_key FROM vault_documents WHERE id = ?")
    .bind(id)
    .first<{ id: string; r2_key: string }>();
  // Same effect order as the original: facts → finance links → document row.
  await DB.prepare("DELETE FROM extracted_facts WHERE document_id = ?").bind(id).run();
  await DB.prepare("UPDATE finance_entries SET receipt_id = '' WHERE receipt_id = ?").bind(id).run();
  await DB.prepare("DELETE FROM vault_documents WHERE id = ?").bind(id).run();
  if (row?.r2_key) {
    try {
      await ctx.env.DOCUMENTS.delete(row.r2_key);
    } catch {
      /* best-effort — the DB row is already gone */
    }
  }
  // Parity: a missing record made Prisma throw → withSession 500 (not 404).
  if (!row) return fail("Server error — see logs.", 500);
  return json({ ok: true });
};

const extractDocument: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const doc = await DB.prepare("SELECT * FROM vault_documents WHERE id = ?").bind(id).first<VaultDocumentRow>();
  if (!doc) return fail("Not found", 404);

  const text = doc.text_extract || "";
  if (!text.trim()) {
    return fail(
      "No extractable text — this file is probably a scan or photo. Use OCR on your device and paste the text via the wizard's 'paste the text' field.",
      422
    );
  }

  let hints: { category?: string } = {};
  try {
    const body = (await ctx.req.json().catch(() => ({}))) as { hints?: { category?: string } };
    hints = body.hints ?? {};
  } catch {
    /* body optional */
  }

  const facts = extractFacts(doc.file_name, doc.mime_type, text, { category: doc.category, ...hints });

  let created = 0;
  for (const f of facts) {
    // avoid duplicating an identical pending/confirmed fact for this document
    const dup = await DB.prepare(
      `SELECT id FROM extracted_facts
       WHERE document_id = ? AND key = ? AND value = ? AND status IN ('pending', 'confirmed')
       LIMIT 1`
    )
      .bind(id, f.key, f.value)
      .first<{ id: string }>();
    if (dup) continue;
    await DB.prepare(
      `INSERT INTO extracted_facts
       (id, subject_id, document_id, key, label, value, quote, confidence, status, source, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`
    )
      .bind(cuid(), doc.subject_id, id, f.key, f.label, f.value.slice(0, 300), f.quote.slice(0, 500), f.confidence, f.source, nowIso())
      .run();
    created++;
  }

  return json({ ok: true, found: facts.length, created });
};

export function registerVaultRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/vault", listDocuments);
  routeFn("POST", "/api/vault", createDocument);
  routeFn("GET", "/api/vault/:id", downloadDocument);
  routeFn("DELETE", "/api/vault/:id", deleteDocument);
  routeFn("POST", "/api/vault/:id/extract", extractDocument);
}
