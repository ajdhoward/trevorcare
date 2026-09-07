// Care Hub & legal — client stores for the statutory toolkit: tickable case
// actions, letter-dispatch records with escalation clocks, and the multi-agency
// handoff register. Demo data ships in public/data/carehub.json; user changes
// (ticks, dispatches, handoff entries) persist in localStorage on top of it.

export interface CaseAction {
  id: string;
  title: string;
  detail: string;
  owner: string;
  due: string; // ISO date
  priority: "P1" | "P2" | "P3";
  done?: boolean;
  doneAt?: string;
  linkTab?: string;
}

export interface LetterTemplate {
  id: string;
  key: string;
  title: string;
  statute: string;
  clockHours: number; // acknowledgement clock started on send (0 = none)
  recipient: string;
  body: string; // template with {{placeholders}}
}

export interface DispatchRecord {
  id: string;
  letterId: string;
  letterTitle: string;
  sentAt: string; // ISO datetime
  sentBy: string;
  clockHours: number;
  clockExpires: string; // ISO datetime
  acknowledgedAt?: string; // ISO datetime — cleared clock when set
}

export type HandoffAcceptance = "pending" | "accepted" | "refused" | "n/a";
export type HandoffEscalation = "none" | "service-manager" | "s42";

export interface HandoffEntry {
  id: string;
  ts: string; // ISO datetime of the contact
  agency: string;
  contact: string; // who was spoken to
  method: "phone" | "email" | "voicemail" | "letter" | "form";
  subject: string;
  accepted: HandoffAcceptance;
  acceptedAt?: string;
  escalation: HandoffEscalation;
  notes?: string;
  loggedBy: string;
}

// ------------------------------------------------------------------ storage
const K_DONE = "care-carehub-actions-v1";
const K_DISPATCH = "care-carehub-dispatch-v1";
const K_HANDOFF = "care-handoffs-v1";
const K_ESCAL = "care-handoff-escalation-v1"; // 4h/24h clock default state

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode */
  }
}

// ------------------------------------------------------------------ actions
export function loadActionDone(): Record<string, { done: boolean; doneAt?: string }> {
  return load(K_DONE, {});
}
export function saveActionDone(map: Record<string, { done: boolean; doneAt?: string }>) {
  save(K_DONE, map);
}
export function mergeActions(templates: CaseAction[], done: Record<string, { done: boolean; doneAt?: string }>): CaseAction[] {
  return templates.map((a) => {
    const d = done[a.id];
    return d ? { ...a, done: d.done, doneAt: d.doneAt ?? (d.done ? new Date().toISOString().slice(0, 10) : undefined) } : a;
  });
}

// ------------------------------------------------------------------ dispatch
export function loadDispatches(): DispatchRecord[] {
  return load<DispatchRecord[]>(K_DISPATCH, []);
}
export function saveDispatches(list: DispatchRecord[]) {
  save(K_DISPATCH, list);
}
export function addDispatch(list: DispatchRecord[], rec: Omit<DispatchRecord, "id">): DispatchRecord[] {
  const next = [{ ...rec, id: `d-${Date.now()}` }, ...list];
  saveDispatches(next);
  return next;
}
export function clockState(rec: DispatchRecord): { expired: boolean; hoursLeft: number; label: string } {
  if (rec.clockHours <= 0) return { expired: false, hoursLeft: Infinity, label: "no clock" };
  const end = new Date(rec.clockExpires).getTime();
  const diffH = (end - Date.now()) / 3600000;
  if (rec.acknowledgedAt) return { expired: false, hoursLeft: diffH, label: "acknowledged" };
  return {
    expired: diffH <= 0,
    hoursLeft: Math.max(0, Math.round(diffH * 10) / 10),
    label: diffH <= 0 ? "clock expired — escalate" : `${diffH.toFixed(1)} h left`,
  };
}

// ------------------------------------------------------------------ handoffs
export function loadHandoffs(): HandoffEntry[] {
  return load<HandoffEntry[]>(K_HANDOFF, seedHandoffs());
}
export function saveHandoffs(list: HandoffEntry[]) {
  save(K_HANDOFF, list);
}

/** Demo seeds — depersonalised, echoing the documented failure modes. */
export function seedHandoffs(): HandoffEntry[] {
  return [
    {
      id: "h-seed-1",
      ts: "2026-08-29T12:40:00.000Z",
      agency: "Transfer of Care Hub",
      contact: "Duty operator",
      method: "phone",
      subject: "Bus-stop crisis follow-up — request temporary care",
      accepted: "refused",
      escalation: "service-manager",
      notes: "Redirected to Adult Social Care; no receipt confirmation offered. Family re-told the same account to a fourth endpoint.",
      loggedBy: "Alex (sample)",
    },
    {
      id: "h-seed-2",
      ts: "2026-08-29T19:20:00.000Z",
      agency: "ASC out-of-hours team",
      contact: "Night duty worker",
      method: "phone",
      subject: "Overnight risk — referral received without context",
      accepted: "pending",
      escalation: "none",
      notes: "Full re-telling required; no visit capability overnight; advised 999 if genuinely concerned.",
      loggedBy: "Alex (sample)",
    },
    {
      id: "h-seed-3",
      ts: "2026-09-04T17:45:00.000Z",
      agency: "ASC safeguarding",
      contact: "Voicemail",
      method: "voicemail",
      subject: "Formal safeguarding concern logged",
      accepted: "pending",
      escalation: "none",
      notes: "Identification details retaken; 72-hour acknowledgement clock started by the family.",
      loggedBy: "Alex (sample)",
    },
  ];
}

/** Escalation ladder per the Systems Review Table 2. */
export function handoffEscalationState(entry: HandoffEntry): { clockLabel: string; breach: boolean } {
  if (entry.accepted === "accepted") return { clockLabel: "accepted", breach: false };
  if (entry.accepted === "n/a") return { clockLabel: "no handoff needed", breach: false };
  const hours = (Date.now() - new Date(entry.ts).getTime()) / 3600000;
  if (entry.escalation === "s42" || hours >= 24) {
    return { clockLabel: hours >= 24 ? "24 h breached → s42 route" : "s42 route", breach: true };
  }
  if (hours >= 4) {
    return { clockLabel: `${Math.floor(hours)} h — service-manager clock running`, breach: true };
  }
  return { clockLabel: `${Math.max(0, Math.round((4 - hours) * 10) / 10)} h to service-manager clock`, breach: false };
}

export const HANDOFF_AGENCIES = [
  "ASC duty team",
  "ASC business support",
  "ASC out-of-hours team",
  "ASC safeguarding",
  "District Nurse triage",
  "Transfer of Care Hub",
  "Mental health crisis line",
  "GP surgery",
  "The care agency",
  "Other",
];
