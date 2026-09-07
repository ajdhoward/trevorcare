// Alerting engine — configurable rules evaluated against the live record data.
// Rules persist in localStorage (care-alert-rules-v1); firing state in
// care-alert-state-v1 so acknowledgement survives reloads. Evaluation is pure:
// the same inputs always produce the same firing set (deduped by window).

import type { CareRecord, WellbeingData } from "@/lib/record";
import type { MyTask, MumContact } from "@/lib/family";
import type { ContactDay } from "@/lib/calls";

export type MetricId =
  | "adherence_7d"
  | "missed_doses"
  | "flags_count"
  | "flag_theme"
  | "wellbeing_below"
  | "wellbeing_drop"
  | "prn_count"
  | "cancellations"
  | "visit_gap_hours"
  | "coverage_7d"
  | "tasks_overdue"
  | "mum_contact_gap"
  | "contact_spike";

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertRule {
  id: string;
  label: string;
  metric: MetricId;
  threshold: number;
  days: number; // evaluation window (where applicable)
  theme?: string; // for flag_theme
  severity: AlertSeverity;
  enabled: boolean;
  email: boolean; // offer pre-drafted email when firing
  created: string;
}

export interface FiringAlert {
  key: string; // ruleId + window
  ruleId: string;
  label: string;
  severity: AlertSeverity;
  message: string;
  evidence: string[];
  linkTab: string;
  firstTs?: string; // from persisted state
  status?: "new" | "ack" | "resolved";
}

export interface AlertState {
  [key: string]: { status: "new" | "ack" | "resolved"; firstTs: string; lastTs: string };
}

export const METRICS: Record<
  MetricId,
  { label: string; unit: string; dir: "above" | "below"; window: boolean; linkTab: string; help: string }
> = {
  adherence_7d: {
    label: "Medication adherence", unit: "%", dir: "below", window: true, linkTab: "medication",
    help: "Average of daily given ÷ scheduled doses over the window (fully cancelled days excluded).",
  },
  missed_doses: {
    label: "Missed / declined med doses", unit: "doses", dir: "above", window: true, linkTab: "medication",
    help: "Sum of scheduled-minus-given doses over the window. Includes PRNs declined as 'not required'.",
  },
  flags_count: {
    label: "Flagged notes", unit: "notes", dir: "above", window: true, linkTab: "watchlist",
    help: "Number of carer notes containing concern keywords in the window.",
  },
  flag_theme: {
    label: "Flagged notes — specific theme", unit: "notes", dir: "above", window: true, linkTab: "watchlist",
    help: "Count for one theme (declined, confusion, falls, pain…). Set theme below.",
  },
  wellbeing_below: {
    label: "Well-being index falls below", unit: "/100", dir: "below", window: false, linkTab: "wellbeing",
    help: "7-day rolling well-being score (0–100 composite of reliability, tasks, medication, comfort, food & fluids, cognition).",
  },
  wellbeing_drop: {
    label: "Well-being 7-day drop greater than", unit: "points", dir: "above", window: false, linkTab: "wellbeing",
    help: "Previous 7-day score minus current 7-day score.",
  },
  prn_count: {
    label: "PRN (as-needed) doses given", unit: "doses", dir: "above", window: true, linkTab: "medication",
    help: "Rising PRN use can signal pain, sleep problems or behaviour change.",
  },
  cancellations: {
    label: "Absences & cancellations", unit: "events", dir: "above", window: true, linkTab: "schedule",
    help: "Absence/cancellation records with a start date inside the window.",
  },
  visit_gap_hours: {
    label: "Hours since last completed visit", unit: "hours", dir: "above", window: false, linkTab: "visits",
    help: "Guards against silent service failure — fires when no completed visit recorded recently.",
  },
  coverage_7d: {
    label: "Scheduled visits in next 7 days", unit: "visits", dir: "below", window: false, linkTab: "schedule",
    help: "Coverage check on the upcoming rota — fires when the schedule looks too thin.",
  },
  tasks_overdue: {
    label: "My family tasks overdue", unit: "tasks", dir: "above", window: false, linkTab: "mytasks",
    help: "Fires when open family tasks (LPA duties, shopping, follow-ups) pass their due date — keeps your responsibilities visible.",
  },
  mum_contact_gap: {
    label: "Days since last contact with Mum's home", unit: "days", dir: "above", window: false, linkTab: "mum",
    help: "Fires when no call, email, visit or video contact with Mum's care home has been logged within the threshold — protects the agreed contact cadence.",
  },
  contact_spike: {
    label: "Inbound contacts exceed X× the trailing 14-day mean", unit: "× mean", dir: "above", window: true, linkTab: "calls",
    help: "Early-warning rule (Systems Review §5.1): a day on which the family places far more calls than usual is a day on which acute decompensation is underway. Set X=3 for the documented 33-call-day rule; a floor of 2 contacts/day applies to quiet periods. Composite confirmation is attached automatically (pain/confusion flags, visit gap, tracker exits).",
  },
};

export const FLAG_THEME_KEYS: { k: string; label: string }[] = [
  { k: "declin", label: "Declined care" },
  { k: "refus", label: "Refused care" },
  { k: "confus", label: "Confusion" },
  { k: "fall", label: "Falls (incl. 'fell')" },
  { k: "hearing aid", label: "Hearing aids" },
  { k: "pain", label: "Pain" },
  { k: "sleeping", label: "Sleeping" },
  { k: "hospital", label: "Hospital" },
  { k: "nomad", label: "Nomad pack" },
];

// ---------------------------------------------------------------- defaults
export function defaultRules(): AlertRule[] {
  const t = "2026-09-06";
  return [
    { id: "r-adh-w", label: "Medication adherence below 85% (7-day)", metric: "adherence_7d", threshold: 85, days: 7, severity: "warning", enabled: true, email: true, created: t },
    { id: "r-adh-c", label: "Medication adherence below 75% (7-day)", metric: "adherence_7d", threshold: 75, days: 7, severity: "critical", enabled: true, email: true, created: t },
    { id: "r-missed", label: "More than 14 missed/declined doses in 7 days", metric: "missed_doses", threshold: 14, days: 7, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-flags", label: "More than 14 flagged notes in 7 days", metric: "flags_count", threshold: 14, days: 7, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-declin", label: "Declined-care notes 8+ in 7 days", metric: "flag_theme", threshold: 8, days: 7, theme: "declin", severity: "warning", enabled: true, email: true, created: t },
    { id: "r-confus", label: "Confusion notes 2+ in 7 days", metric: "flag_theme", threshold: 2, days: 7, theme: "confus", severity: "warning", enabled: true, email: true, created: t },
    { id: "r-fall", label: "Any fall noted in 7 days", metric: "flag_theme", threshold: 1, days: 7, theme: "fall", severity: "critical", enabled: true, email: true, created: t },
    { id: "r-pain", label: "Pain notes 3+ in 7 days", metric: "flag_theme", threshold: 3, days: 7, theme: "pain", severity: "warning", enabled: true, email: false, created: t },
    { id: "r-wb", label: "Well-being index below 75", metric: "wellbeing_below", threshold: 75, days: 0, severity: "warning", enabled: true, email: true, created: t },
    { id: "r-wbdrop", label: "Well-being dropped 5+ points week-on-week", metric: "wellbeing_drop", threshold: 5, days: 0, severity: "info", enabled: true, email: false, created: t },
    { id: "r-prn", label: "More than 25 PRN doses given in 7 days", metric: "prn_count", threshold: 25, days: 7, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-cxl", label: "4+ absences/cancellations in 30 days", metric: "cancellations", threshold: 4, days: 30, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-gap", label: "No completed visit for 30+ hours", metric: "visit_gap_hours", threshold: 30, days: 0, severity: "critical", enabled: true, email: true, created: t },
    { id: "r-cov", label: "Fewer than 20 visits scheduled next 7 days", metric: "coverage_7d", threshold: 20, days: 0, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-tasks", label: "3+ family tasks overdue", metric: "tasks_overdue", threshold: 3, days: 0, severity: "warning", enabled: true, email: false, created: t },
    { id: "r-mum", label: "No contact with Mum's home for 7+ days", metric: "mum_contact_gap", threshold: 7, days: 0, severity: "warning", enabled: true, email: true, created: t },
    { id: "r-spike", label: "Inbound contacts exceed 3× the trailing 14-day mean", metric: "contact_spike", threshold: 3, days: 14, severity: "critical", enabled: true, email: true, created: t },
  ];
}

const K_RULES = "care-alert-rules-v1";
const K_STATE = "care-alert-state-v1";

export function loadRules(): AlertRule[] {
  if (typeof window === "undefined") return defaultRules();
  try {
    const raw = localStorage.getItem(K_RULES);
    if (!raw) return defaultRules();
    const v = JSON.parse(raw) as AlertRule[];
    let rules = Array.isArray(v) && v.length ? v : defaultRules();
    // migration: append new default rules that shipped after the user's saved set
    for (const d of defaultRules()) {
      if (d.metric === "contact_spike" && !rules.some((r) => r.metric === "contact_spike")) {
        rules = [...rules, d];
      }
    }
    return rules;
  } catch {
    return defaultRules();
  }
}
export function saveRules(rules: AlertRule[]) {
  try {
    localStorage.setItem(K_RULES, JSON.stringify(rules));
  } catch {
    /* ignore */
  }
}
export function loadAlertState(): AlertState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(K_STATE) || "{}") as AlertState;
  } catch {
    return {};
  }
}
export function saveAlertState(s: AlertState) {
  try {
    localStorage.setItem(K_STATE, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- evaluation
function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AlertExtra {
  tasks?: MyTask[];
  mumContacts?: MumContact[];
  contactDaily?: ContactDay[];
  trackerExits?: { ts: string }[];
}

export function evaluateAlerts(
  record: CareRecord,
  wellbeing: WellbeingData | null,
  rules: AlertRule[],
  state: AlertState,
  extra?: AlertExtra
): FiringAlert[] {
  const now = new Date();
  const today = dayStr(now);
  const firing: FiringAlert[] = [];
  const touch = (key: string) => {
    const prev = state[key];
    return { firstTs: prev?.firstTs ?? now.toISOString(), lastTs: now.toISOString() };
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const m = METRICS[rule.metric];
    let value: number | null = null;
    const evidence: string[] = [];
    let windowEnd = today;

    try {
      if (rule.metric === "adherence_7d" || rule.metric === "missed_doses" || rule.metric === "prn_count") {
        const days = record.med_daily.filter((d) => d.date <= today).slice(0, rule.days);
        const active = days.filter((d) => d.total > 0 && d.cancelled < 2);
        if (rule.metric === "adherence_7d") {
          const pcts = active.map((d) => (d.given / d.total) * 100);
          if (pcts.length === 0) continue;
          value = pcts.reduce((a, b) => a + b, 0) / pcts.length;
          for (const d of active) {
            evidence.push(
              `${d.date}: ${d.given}/${d.total} given (${Math.round((d.given / d.total) * 100)}%)` +
                (d.cancelled ? `, ${d.cancelled} cancelled` : "")
            );
          }
        } else if (rule.metric === "missed_doses") {
          value = active.reduce((a, d) => a + (d.total - d.given), 0);
          for (const d of active) if (d.total - d.given > 0) evidence.push(`${d.date}: ${d.total - d.given} not given`);
        } else {
          value = active.reduce((a, d) => a + d.prn_given, 0);
          for (const d of active) if (d.prn_given > 0) evidence.push(`${d.date}: ${d.prn_given} PRN given`);
        }
        if (active.length < Math.ceil(rule.days * 0.5)) evidence.push(`(only ${active.length} active days in window)`);
      } else if (rule.metric === "flags_count" || rule.metric === "flag_theme") {
        const cutoff = dayStr(new Date(now.getTime() - rule.days * 86400000));
        windowEnd = cutoff;
        const inWin = record.flags.filter((f) => f.date >= cutoff && f.date <= today);
        const sel =
          rule.metric === "flag_theme" ? inWin.filter((f) => f.kw.includes(rule.theme || "")) : inWin;
        value = sel.length;
        for (const f of sel.slice(0, 12)) evidence.push(`${f.date} · ${f.carer}: “${f.notes.slice(0, 110)}…”`);
        if (sel.length > 12) evidence.push(`…and ${sel.length - 12} more (see Watch items)`);
      } else if (rule.metric === "wellbeing_below" && wellbeing) {
        value = wellbeing.current.score;
        evidence.push(
          `7-day score ${value.toFixed(1)} (${wellbeing.current.window}); previous 7-day ${wellbeing.current.prev7?.toFixed(1) ?? "—"}`
        );
      } else if (rule.metric === "wellbeing_drop" && wellbeing) {
        value = (wellbeing.current.prev7 ?? 0) - wellbeing.current.score;
        evidence.push(
          `previous 7-day ${wellbeing.current.prev7?.toFixed(1) ?? "—"} → current ${wellbeing.current.score.toFixed(1)}`
        );
      } else if (rule.metric === "cancellations") {
        const cutoff = dayStr(new Date(now.getTime() - rule.days * 86400000));
        windowEnd = cutoff;
        const sel = record.absences.filter((a) => a.from.slice(0, 10) >= cutoff);
        value = sel.length;
        for (const a of sel.slice(0, 10)) evidence.push(`${a.from.slice(0, 10)}: ${a.reason}`);
      } else if (rule.metric === "visit_gap_hours") {
        const done = record.hist.find((v) => v.date <= today && /complete/i.test(v.status));
        if (!done) {
          value = 999;
          evidence.push("No completed visit found up to today in the record.");
        } else {
          const outT = done.aout || done.sout || "23:59";
          const last = new Date(`${done.date}T${outT.length === 5 ? outT : "23:59"}:00`);
          value = Math.max(0, (now.getTime() - last.getTime()) / 3600000);
          evidence.push(`Last completed visit ${done.date} (${done.times}, ${done.carer}) — ${value.toFixed(1)}h ago`);
        }
      } else if (rule.metric === "coverage_7d") {
        const end = dayStr(new Date(now.getTime() + 7 * 86400000));
        const sel = record.upcoming.filter((u) => u.date >= today && u.date <= end);
        value = sel.length;
        const byDay = sel.reduce<Record<string, number>>((acc, u) => {
          acc[u.date] = (acc[u.date] || 0) + 1;
          return acc;
        }, {});
        evidence.push(Object.entries(byDay).map(([d, n]) => `${d}: ${n}`).join(", "));
      } else if (rule.metric === "tasks_overdue") {
        const open = (extra?.tasks ?? []).filter((t) => !t.done && t.due && t.due < today);
        value = open.length;
        for (const t of open.slice(0, 10)) evidence.push(`${t.due}: ${t.title} (${t.assignee})`);
        if (open.length > 10) evidence.push(`…and ${open.length - 10} more`);
      } else if (rule.metric === "mum_contact_gap") {
        const last = (extra?.mumContacts ?? []).slice().sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!last) {
          value = 999;
          evidence.push("No contact with Mum's care home has been logged yet.");
        } else {
          const diff = Math.floor((now.getTime() - new Date(last.date + "T00:00:00").getTime()) / 86400000);
          value = Math.max(0, diff);
          evidence.push(`Last logged contact: ${last.date} (${last.type} with ${last.who || "home"})`);
        }
      } else if (rule.metric === "contact_spike") {
        const daily = (extra?.contactDaily ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
        if (daily.length < 3) {
          continue; // not enough telemetry yet
        }
        const last = daily[daily.length - 1];
        const window14 = daily.filter((d) => d.date < last.date).slice(-rule.days || -14);
        const meanRaw = window14.length ? window14.reduce((a, d) => a + d.inbound, 0) / window14.length : 0;
        const floorApplied = meanRaw < 2;
        const mean = floorApplied ? 2 : meanRaw;
        value = mean > 0 ? Math.round((last.inbound / mean) * 100) / 100 : 0;
        evidence.push(
          `${last.date}: ${last.inbound} inbound contacts vs trailing ${window14.length}-day mean ${meanRaw.toFixed(1)}` +
            (floorApplied ? " (floor 2/day applied)" : "")
        );
        if (last.note) evidence.push(`Day note: ${last.note}`);
        // composite confirmation — the objective signals the portal already tracks
        const cutoff = dayStr(new Date(now.getTime() - 7 * 86400000));
        const pain = record.flags.filter((f) => f.date >= cutoff && f.kw.some((k) => k.includes("pain"))).length;
        const confusion = record.flags.filter((f) => f.date >= cutoff && f.kw.some((k) => k.includes("confus"))).length;
        if (pain) evidence.push(`Composite: ${pain} pain flag(s) in the last 7 days`);
        if (confusion) evidence.push(`Composite: ${confusion} confusion flag(s) in the last 7 days`);
        const lastDone = record.hist.find((v2) => /complete/i.test(v2.status));
        if (lastDone) evidence.push(`Composite: last completed visit recorded ${lastDone.date}`);
        if (extra?.trackerExits?.length) evidence.push(`Composite: ${extra.trackerExits.length} tracker exit event(s) on file`);
      }
    } catch {
      continue;
    }

    if (value === null) continue;
    const hit = m.dir === "above" ? value > rule.threshold : value < rule.threshold;
    if (!hit) continue;
    const key = `${rule.id}:${rule.metric === "visit_gap_hours" || rule.metric === "wellbeing_below" || rule.metric === "wellbeing_drop" || rule.metric === "coverage_7d" || rule.metric === "tasks_overdue" || rule.metric === "mum_contact_gap" || rule.metric === "contact_spike" ? today : windowEnd}`;
    const t = touch(key);
    firing.push({
      key,
      ruleId: rule.id,
      label: rule.label,
      severity: rule.severity,
      message: `${rule.label} — currently ${value.toFixed(rule.metric === "adherence_7d" || rule.metric === "contact_spike" ? 2 : 0)} ${m.unit}.`,
      evidence,
      linkTab: m.linkTab,
      firstTs: t.firstTs,
      status: state[key]?.status ?? "new",
    });
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  firing.sort((a, b) => order[a.severity] - order[b.severity]);
  return firing;
}

export function buildAlertEmail(
  alert: FiringAlert,
  record: CareRecord,
  sender: string
): { subject: string; body: string } {
  const subject = `[Dad — care alert] ${alert.label}`;
  const lines = [
    "Dear colleague,",
    "",
    `An automated watch rule on Dad's care record has triggered:`,
    "",
    `  ${alert.message}`,
    "",
    "Evidence from the record:",
    ...alert.evidence.slice(0, 8).map((e) => `  • ${e}`),
    "",
    "Requested actions:",
    "  1. Review the related entries in the care record (link shared separately).",
    "  2. Confirm what has been done and any changes made.",
    "  3. Reply to confirm receipt — this forms part of the family's oversight trail under our agreed care arrangements.",
    "",
    "This alert was generated automatically from the family care-record interface. Data provenance: the care agency (the care portal) family portal export. Personal and confidential — UK GDPR Art. 9 health data.",
    "",
    "Kind regards,",
    sender,
    `Generated ${new Date().toLocaleString("en-GB")}`,
  ];
  return { subject, body: lines.join("\n") };
}
