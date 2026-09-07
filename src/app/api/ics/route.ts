// ICS calendar link proxy — fetches a user's private ICS URL (Google / Outlook /
// iCloud "secret address") server-side (avoids CORS) and extracts busy dates so
// the joint-availability engine can exclude them.
// Limitation (stated in UI): recurring events are counted once on their first
// occurrence — add manual exceptions in the availability grid if needed.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface BusyBlock {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  summary: string;
  recurring: boolean;
}

function unfold(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function toIsoDate(v: string): string | null {
  // forms: 20260918 / 20260918T103000Z / 20260918T103000 (TZID)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (m[4]) {
    const d = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    );
    // date-level precision only — no timezone shifting attempted
    return d.toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseIcs(text: string): { busy: BusyBlock[]; parsed: number } {
  const lines = unfold(text);
  const busy: BusyBlock[] = [];
  let cur: { start?: string; end?: string; summary?: string; rrule?: boolean } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (t === "END:VEVENT") {
      if (cur?.start) {
        busy.push({
          start: cur.start,
          end: cur.end || cur.start,
          summary: cur.summary || "Busy",
          recurring: !!cur.rrule,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const [prop, ...rest] = t.split(":");
    const value = rest.join(":");
    const name = prop.split(";")[0].toUpperCase();
    if (name === "DTSTART" || name === "DTEND") {
      const iso = toIsoDate(value);
      if (iso) {
        if (name === "DTSTART") cur.start = iso;
        else cur.end = iso;
      }
    } else if (name === "SUMMARY") {
      cur.summary = value.slice(0, 80);
    } else if (name === "RRULE") {
      cur.rrule = true;
    }
  }
  return { busy, parsed: busy.length };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string };
    const url = (body.url || "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      return NextResponse.json({ error: "Provide a full https:// calendar (ICS) URL." }, { status: 400 });
    }
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "text/calendar,text/plain,*/*" }, redirect: "follow" });
    } catch {
      return NextResponse.json({ error: "Could not reach that calendar URL (network/DNS)." }, { status: 502 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Calendar returned HTTP ${res.status}.` }, { status: 502 });
    }
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return NextResponse.json(
        { error: "That URL did not return an iCalendar file (check it is the .ics 'secret address in iCal format')." },
        { status: 400 }
      );
    }
    const { busy, parsed } = parseIcs(text);
    return NextResponse.json({ ok: true, count: parsed, busy });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
