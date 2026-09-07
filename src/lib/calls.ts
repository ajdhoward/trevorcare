// Calls & evidence log — types and helpers for the family call archive.
// The archive is the family's phone history with Adult Social Care, the NHS
// and partner agencies: the "shadow system" that held the official one
// together. It is a first-class data source (see the Systems Review, §5.1) and
// feeds the early-warning contact-spike rule in src/lib/alerts.ts.

export type CallCategory =
  | "Adult social care"
  | "Community health"
  | "Primary care"
  | "Provider"
  | "Family"
  | "Emergency"
  | "Other";

export interface CallLogEntry {
  id: string;
  date: string; // ISO date
  time: string; // HH:MM
  direction: "inbound" | "outbound";
  number: string;
  party: string;
  category: CallCategory | string;
  subject: string;
  durationMin: number;
  transcript: string;
  highlights: string[];
  escalated?: boolean;
}

export interface ContactDay {
  date: string; // ISO date
  inbound: number;
  outbound: number;
  note?: string;
}

export interface CallsData {
  generated: string;
  note: string;
  coverage: { from: string; to: string };
  counts: { callsLogged: number; archiveTotal: number; archiveNote: string };
  calls: CallLogEntry[];
  contactDaily: ContactDay[];
}

// ------------------------------------------------------------ spike detection
export interface SpikeStatus {
  today: string;
  todayInbound: number;
  mean14: number; // trailing 14-day mean excluding the evaluation day
  ratio: number; // todayInbound ÷ mean14 (floor-adjusted)
  breach: boolean; // ratio > threshold
  floorApplied: boolean;
  spikeDay?: { date: string; inbound: number; note?: string };
}

/**
 * The early-warning rule from the Systems Review §5.1: a day's inbound contact
 * volume is a leading indicator, not noise. Fires when inbound contacts exceed
 * `threshold` × the trailing 14-day mean (excluding the evaluation day), with
 * an absolute floor of 2 contacts/day so quiet periods can't fire on 0→1 days.
 */
export function spikeStatus(
  daily: ContactDay[],
  threshold = 3,
  evaluateDate?: string
): SpikeStatus {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const today = evaluateDate ?? last?.date ?? new Date().toISOString().slice(0, 10);
  const evalDay = sorted.find((d) => d.date === today) ?? last;
  const todayInbound = evalDay?.inbound ?? 0;

  const window = sorted.filter((d) => d.date < today).slice(-14);
  const meanRaw = window.length ? window.reduce((a, d) => a + d.inbound, 0) / window.length : 0;
  const floorApplied = meanRaw < 2;
  const mean = floorApplied ? 2 : meanRaw;
  const ratio = mean > 0 ? todayInbound / mean : 0;

  // documented spike day: the peak day, if it sits far beyond the mean of the REST of the series
  const peak = [...sorted].sort((a, b) => b.inbound - a.inbound)[0];
  const restMean =
    sorted.length > 1
      ? (sorted.reduce((a, d) => a + d.inbound, 0) - (peak?.inbound ?? 0)) / (sorted.length - 1)
      : 0;
  const spikeDay =
    peak && peak.inbound >= 3 * Math.max(restMean, 2)
      ? { date: peak.date, inbound: peak.inbound, note: peak.note }
      : undefined;

  return {
    today,
    todayInbound,
    mean14: Math.round(meanRaw * 10) / 10,
    ratio: Math.round(ratio * 10) / 10,
    breach: ratio > threshold,
    floorApplied,
    spikeDay,
  };
}

/** Composite confirmation — the objective signals already tracked in the record. */
export function compositeSignals(
  record: { flags: { date: string; kw: string[] }[]; hist: { date: string; aout?: string; sout?: string; status: string }[] },
  exits?: { ts: string }[]
): string[] {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const signals: string[] = [];
  const pain = record.flags.filter((f) => f.date >= cutoff && f.kw.some((k) => k.includes("pain"))).length;
  const confusion = record.flags.filter((f) => f.date >= cutoff && f.kw.some((k) => k.includes("confus"))).length;
  const lastDone = record.hist.find((v) => /complete/i.test(v.status));
  if (pain) signals.push(`${pain} pain flag(s) in the last 7 days`);
  if (confusion) signals.push(`${confusion} confusion flag(s) in the last 7 days`);
  if (lastDone) signals.push(`last completed visit recorded ${lastDone.date}`);
  if (exits?.length) signals.push(`${exits.length} tracker exit event(s) logged`);
  return signals;
}

// ------------------------------------------------------------ response ladder
export const RESPONSE_LADDER: { step: string; detail: string }[] = [
  { step: "1 · Same-day welfare check", detail: "Request a double-up visit from the care provider for today." },
  { step: "2 · Named coordinator", detail: "Notify the agency coordinator and ask for written confirmation." },
  { step: "3 · Locator refresh", detail: "Re-confirm tracker status, last-seen location and key-holder availability." },
  { step: "4 · Family group ping", detail: "Alert the family group — every step lands in this log, time-stamped." },
];

export const CATEGORIES: CallCategory[] = [
  "Adult social care",
  "Community health",
  "Primary care",
  "Provider",
  "Family",
  "Emergency",
  "Other",
];
