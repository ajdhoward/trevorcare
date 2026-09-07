// Document extraction engine — pulls structured candidate facts out of
// uploaded documents. Everything here is DETERMINISTIC (regex / MRZ checksum /
// field parsers) — no model is involved at this layer, so an extracted fact
// always carries the verbatim quote it came from. Facts land in the review
// queue with status "pending"; a human confirms before anything reaches the
// subject profile. (AI-assisted extraction happens later and is also
// human-reviewed — see the research engine's anti-hallucination notes.)

export interface RawFact {
  key: string;
  label: string;
  value: string;
  quote: string;
  confidence: number;
  source: string; // passport-mrz | birth-certificate | chat-transcript | pattern
}

// ---------------------------------------------------------------------------
// Passport MRZ (ICAO 9303 TD3, two 44-char lines) — checksum-verified.
// ---------------------------------------------------------------------------

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

export function parsePassportMrz(text: string): RawFact[] {
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

// ---------------------------------------------------------------------------
// UK birth certificate fields (deterministic patterns over common layouts).
// ---------------------------------------------------------------------------

export function parseBirthCertificate(text: string): RawFact[] {
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

// ---------------------------------------------------------------------------
// AI chat transcript importer — accepts ChatGPT-style JSON exports, generic
// JSON {messages:[{role,content}]}, or plain text with role markers.
// Extracts the conversation AND candidate facts (decisions, dates, contacts,
// medications, actions) with the surrounding sentence as the quote.
// ---------------------------------------------------------------------------

export interface ParsedChat {
  messages: Array<{ role: string; content: string; ts?: string }>;
  facts: RawFact[];
}

export function parseChatTranscript(raw: string): ParsedChat {
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

// ---------------------------------------------------------------------------
// Generic fact mining — letters, assessments, care contracts, anything text.
// ---------------------------------------------------------------------------

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

export function mineFactsFromText(text: string, source: string): RawFact[] {
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

// ---------------------------------------------------------------------------
// Top-level router used by the extract API.
// ---------------------------------------------------------------------------

export function extractFacts(fileName: string, mimeType: string, text: string, hints?: { category?: string }): RawFact[] {
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
export function extractText(fileName: string, mimeType: string, buf: Buffer): { text: string; method: string } {
  if (mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")) {
    // minimal fallback: pull readable ASCII runs (works for many text-born PDFs;
    // scanned PDFs need OCR — surfaced honestly to the user in the UI)
    const raw = buf.toString("latin1");
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
    return { text: buf.toString("utf8"), method: "utf8" };
  }
  // binary unknown — extract readable runs (may catch embedded metadata)
  const runs = buf.toString("latin1").match(/[ -~]{8,}/g) ?? [];
  return { text: runs.slice(0, 400).join("\n"), method: "ascii-runs (binary preview)" };
}
