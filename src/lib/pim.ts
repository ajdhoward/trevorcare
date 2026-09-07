// PIM (personal information management) helpers — provider metadata and an
// ICS (iCalendar) parser. Google / Apple / Microsoft calendars all speak ICS
// on the export path, so ICS import gives working cross-platform sync today;
// native OAuth sync is scaffolded and activates as soon as deployment
// credentials (client IDs) are set — no code changes needed.

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface PimProviderInfo {
  id: "google" | "apple" | "microsoft";
  label: string;
  blurb: string;
  color: string; // tailwind classes for the card chip
  envClient: string; // env var holding the OAuth client id
  envSecret: string; // env var holding the OAuth client secret
  authEndpoint?: string;
  tokenEndpoint?: string;
  scopes?: string;
  setupNotes: string;
}

export const PIM_PROVIDERS: PimProviderInfo[] = [
  {
    id: "google",
    label: "Google Calendar & Contacts",
    blurb: "Two-way-ready calendar sync (visits, appointments, family calendar) and contacts import.",
    color: "bg-emerald-600",
    envClient: "GOOGLE_CLIENT_ID",
    envSecret: "GOOGLE_CLIENT_SECRET",
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/contacts.readonly",
    setupNotes:
      "Google Cloud Console → create OAuth client (web) → authorised redirect URI: <portal origin>/api/integrations/oauth/callback/google → set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET as deployment secrets.",
  },
  {
    id: "apple",
    label: "Apple Calendar & Contacts",
    blurb: "iCloud private-calender share links and CardDAV exports; app-specific-password model.",
    color: "bg-stone-600",
    envClient: "APPLE_CLIENT_ID", // services id for Sign in with Apple
    envSecret: "APPLE_CLIENT_SECRET",
    setupNotes:
      "Apple does not expose a general CalDAV OAuth for personal iCloud. Practical route: iCloud → Calendar → share → public (ICS) URL, paste it as the feed for this provider. Contacts: export a vCard and use 'Import vCard'. Sign in with Apple needs a Services ID + key (APPLE_CLIENT_ID / APPLE_CLIENT_SECRET).",
  },
  {
    id: "microsoft",
    label: "Microsoft 365 / Outlook",
    blurb: "Outlook calendar sync and contacts via Microsoft Graph.",
    color: "bg-sky-700",
    envClient: "MICROSOFT_CLIENT_ID",
    envSecret: "MICROSOFT_CLIENT_SECRET",
    authEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: "offline_access Calendars.Read Contacts.Read",
    setupNotes:
      "Entra admin center → App registration → redirect URI: <portal origin>/api/integrations/oauth/callback/microsoft → set MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET as deployment secrets.",
  },
];

// ---------------------------------------------------------------------------
// ICS parsing (minimal but honest: VEVENT with DTSTART/DTEND/SUMMARY/LOCATION/
// DESCRIPTION; RRULE is surfaced as a note rather than expanded)
// ---------------------------------------------------------------------------

export interface IcsEvent {
  uid: string;
  summary: string;
  start: string; // ISO (local or UTC)
  end: string;
  location: string;
  description: string;
  recurrenceNote: string;
}

function icsUnfold(raw: string): string[] {
  // RFC 5545: continuation lines start with a space or tab
  const lines: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function icsDate(v: string, params: string): string {
  // 20260907T140000Z | 20260907T140000 | 20260907 (all-day) + TZID param
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return v;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const time = `${h}:${mi}:${s}`;
  if (z || !h) return `${y}-${mo}-${d}T${time}Z`; // UTC or all-day marker
  if (params.includes("TZID=")) {
    const tz = params.match(/TZID=([^;:]+)/)?.[1] ?? "";
    return `${y}-${mo}-${d}T${time} (${tz})`;
  }
  return `${y}-${mo}-${d}T${time}`; // floating local time
}

export function parseIcs(raw: string): { events: IcsEvent[]; errors: string[] } {
  const lines = icsUnfold(raw);
  const events: IcsEvent[] = [];
  const errors: string[] = [];
  let cur: Partial<IcsEvent> | null = null;
  let rrule = "";

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      cur = { uid: "", summary: "(untitled)", start: "", end: "", location: "", description: "" };
      rrule = "";
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (cur && cur.start) {
        events.push({
          uid: cur.uid || `${cur.start}-${cur.summary}`,
          summary: cur.summary || "(untitled)",
          start: cur.start,
          end: cur.end || cur.start,
          location: cur.location || "",
          description: cur.description || "",
          recurrenceNote: rrule,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const left = line.slice(0, sep);
    const value = line.slice(sep + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
    const key = left.split(";")[0].toUpperCase();

    switch (key) {
      case "UID":
        cur.uid = value;
        break;
      case "SUMMARY":
        cur.summary = value;
        break;
      case "DTSTART":
        cur.start = icsDate(value, left);
        break;
      case "DTEND":
        cur.end = icsDate(value, left);
        break;
      case "LOCATION":
        cur.location = value;
        break;
      case "DESCRIPTION":
        cur.description = value.slice(0, 500);
        break;
      case "RRULE":
        rrule = value;
        break;
    }
  }

  if (events.length === 0) errors.push("No VEVENT entries found — is this an iCalendar (.ics) export?");
  return { events, errors };
}

// ---------------------------------------------------------------------------
// vCard (contacts) — 3.0/4.0 minimal
// ---------------------------------------------------------------------------

export interface VCardContact {
  fullName: string;
  org: string;
  phones: string[];
  emails: string[];
}

export function parseVCard(raw: string): VCardContact[] {
  const lines = icsUnfold(raw);
  const out: VCardContact[] = [];
  let cur: VCardContact | null = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) {
      cur = { fullName: "", org: "", phones: [], emails: [] };
      continue;
    }
    if (/^END:VCARD/i.test(line)) {
      if (cur && (cur.fullName || cur.phones.length || cur.emails.length)) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const left = line.slice(0, sep);
    const value = line.slice(sep + 1).trim();
    const key = left.split(";")[0].toUpperCase();
    if (key === "FN") cur.fullName = value;
    else if (key === "ORG") cur.org = value.replace(/;/g, " ").trim();
    else if (key === "TEL") cur.phones.push(value.replace(/;type=/gi, " "));
    else if (key === "EMAIL") cur.emails.push(value);
  }
  return out;
}
