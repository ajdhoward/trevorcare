// Haven 360 family-voice layer — integrates the Qwen "Haven 360" specification
// (PRD-360-FAM v4.0) into the Family Care Hub:
//   §07  360° family ingestion hub — people are the sensors (check-ins,
//        micro-decline, mood board, ABC log, calming strategies, life story)
//   §06  Legal watchdogs helpers (capacity ledger, ACD/ReSPECT vault)
//   §03  Consent matrix with per-relative visibility tiers
//   §08  Dementia Care Progression Index (DCPI) — live calculator
//   §05  "My Day" kiosk choices captured from Dad's tablet view
// All stores are client-side (localStorage) keyed h360-*; on Cloudflare they map
// to D1 tables — see docs/DEPLOYMENT.md.

// ------------------------------------------------------------------ types
export interface CheckIn {
  id: string;
  date: string; // YYYY-MM-DD
  person: "dad" | "mum";
  stamina: number; // 1 low – 5 strong
  sleep: number; // 1 poor – 5 restful
  confusion: number; // 1 clear – 5 very muddled
  appetite: number; // 1 none – 5 full
  burnout: number; // 0 calm – 10 exhausted (CONFIDENTIAL, carer self-check)
  notes: string;
}

export interface MicroDecline {
  id: string;
  date: string;
  visitor: string;
  weightDeltaKg: number; // +/- since last visit
  homeCondition: number; // 1 worrying – 5 excellent
  hygiene: number; // 1 concerning – 5 well kept
  cognition: number; // 1 much worse – 5 much better (vs last visit)
  notes: string;
}

export interface MoodEntry {
  id: string;
  ts: string;
  who: string;
  text: string;
  tags: string[];
}

export interface AbcEntry {
  id: string;
  date: string;
  time: string; // HH:MM
  antecedent: string;
  behaviour: string;
  consequence: string;
  durationMin: number;
  severity: 1 | 2 | 3; // 1 mild, 2 moderate, 3 severe
}

export interface CalmingStrategy {
  id: string;
  title: string;
  kind: "music" | "clip" | "phrase" | "activity" | "object";
  when: string; // "sundowning", "bath time", ...
  detail: string;
  link?: string;
}

export interface LifeStoryEntry {
  id: string;
  category: "history" | "family" | "work" | "favourites" | "triggers" | "milestones";
  title: string;
  detail: string;
}

export type ConsentTier = "full" | "lifestyle" | "activities" | "none";

export interface ConsentRow {
  person: string;
  tier: ConsentTier;
  updated: string;
  note?: string;
}

export interface CapacityEntry {
  id: string;
  ts: string;
  task: string;
  level: "independent" | "assisted" | "lacking";
  note: string;
  contested?: boolean;
}

export interface AcdDoc {
  id: string;
  kind: "ACD" | "ReSPECT" | "DNACPR" | "Care wishes" | "LPA note";
  title: string;
  status: "in place" | "draft" | "planned" | "discuss";
  location: string;
  updated: string;
}

export interface DcpiInputs {
  wandering: number; // unsafe exit attempts / week (0-10)
  disorientation: number; // time/place episodes / week (0-10)
  weightLoss: number; // % over 12 weeks (0-10)
  hydrationDays: number; // days below hydration target last 14 (0-14)
  medsRefused: number; // refused/missed doses / week (0-10)
  nightDisturbance: number; // night events / week (0-10)
  burnout: number; // primary carer burnout 0-10 (from check-ins)
}

export interface KioskChoice {
  id: string;
  ts: string;
  board: string; // "dinner" | "outfit" | "drink" | "activity" | "call"
  choice: string;
}

// ------------------------------------------------------------------ store
function makeStore<T>(key: string, fallback: T) {
  return {
    key,
    load(): T {
      if (typeof window === "undefined") return fallback;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const v = JSON.parse(raw);
        return (v ?? fallback) as T;
      } catch {
        return fallback;
      }
    },
    save(v: T) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage full */
      }
    },
  };
}

export const checkInStore = makeStore<CheckIn[]>("h360-checkins", []);
export const microDeclineStore = makeStore<MicroDecline[]>("h360-microdecline", []);
export const moodStore = makeStore<MoodEntry[]>("h360-mood", []);
export const abcStore = makeStore<AbcEntry[]>("h360-abc", []);
export const calmingStore = makeStore<CalmingStrategy[]>("h360-calming", []);
export const lifeStoryStore = makeStore<LifeStoryEntry[]>("h360-lifestory", []);
export const capacityStore = makeStore<CapacityEntry[]>("h360-capacity", []);
export const acdStore = makeStore<AcdDoc[]>("h360-acd", []);
export const kioskChoiceStore = makeStore<KioskChoice[]>("h360-kiosk-choices", []);

const K_CONSENT = "h360-consent";
export const DEFAULT_CONSENT: ConsentRow[] = [
  { person: "Alex (son, LPA)", tier: "full", updated: "2026-09-06", note: "Family lead — full timeline." },
  { person: "Pat (co-attorney, LPA)", tier: "full", updated: "2026-09-06", note: "Joint LPA for health & welfare + property & affairs." },
  { person: "Contact A (niece-in-law)", tier: "lifestyle", updated: "2026-09-06", note: "Lifestyle-only — daily life, no clinical detail." },
  { person: "Contact B (nephew)", tier: "activities", updated: "2026-09-06", note: "Activities & visits only." },
  { person: "the family's social worker", tier: "activities", updated: "2026-09-06", note: "Time-boxed shared links only — see Share tab." },
];
export function loadConsent(): ConsentRow[] {
  if (typeof window === "undefined") return DEFAULT_CONSENT;
  try {
    const raw = localStorage.getItem(K_CONSENT);
    if (!raw) return DEFAULT_CONSENT;
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v : DEFAULT_CONSENT;
  } catch {
    return DEFAULT_CONSENT;
  }
}
export function saveConsent(rows: ConsentRow[]) {
  try {
    localStorage.setItem(K_CONSENT, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

export const CONSENT_TIER_HELP: Record<ConsentTier, string> = {
  full: "Full timeline: visits, tasks, medication, clinical notes and lifestyle.",
  lifestyle: "Lifestyle only: meals, activities, mood — no clinical or medication detail.",
  activities: "Activities & visits: who visited and what happened, nothing clinical.",
  none: "Nothing — access revoked (one tap to restore any tier).",
};

// ------------------------------------------------------------------ DCPI
export const DCPI_DEFAULTS: DcpiInputs = {
  wandering: 2,
  disorientation: 3,
  weightLoss: 3,
  hydrationDays: 4,
  medsRefused: 2,
  nightDisturbance: 3,
  burnout: 4,
};

// Weights calibrated so the Qwen spec's worked example (2,3,3,4,2,3,4) ≈ 31.
export function dcpiScore(i: DcpiInputs): number {
  const raw =
    2.5 * i.wandering +
    2.0 * i.disorientation +
    2.0 * i.weightLoss +
    1.0 * i.hydrationDays +
    1.5 * i.medsRefused +
    1.5 * i.nightDisturbance +
    0.4 * i.burnout;
  return Math.min(100, Math.round(raw));
}

export interface DcpiBand {
  label: string;
  tone: "green" | "amber" | "red" | "crimson";
  advice: string;
}

export function dcpiBand(score: number): DcpiBand {
  if (score < 25)
    return { label: "GREEN — Steady", tone: "green", advice: "Visiting care still meets needs. Keep monitoring; re-run the index monthly." };
  if (score < 50)
    return { label: "AMBER — Intensify & review", tone: "amber", advice: "Increase visit frequency; commission OT + telecare review; schedule CMHT input; re-run the index in 2 weeks." };
  if (score < 75)
    return { label: "RED — Urgent reassessment", tone: "red", advice: "Request a Care Act s.9 needs reassessment and a medication review this month. Consider respite to protect the carer." };
  return { label: "CRIMSON — Transition likely", tone: "crimson", advice: "Visiting care is likely no longer safe. Compile the transition evidence pack and request a multi-agency review now." };
}

export interface StatutoryFlag {
  title: string;
  basis: string;
  action: string;
}

export function dcpiStatutoryFlags(i: DcpiInputs): StatutoryFlag[] {
  const flags: StatutoryFlag[] = [];
  if (i.weightLoss >= 3)
    flags.push({
      title: "MUST re-assessment due — weight loss ≥ 3% over 12 weeks",
      basis: "NICE NG27 malnutrition threshold; Care Act 2014 s.9 review duty",
      action: "Request a needs reassessment and a dietetic review; add weights to the visits log.",
    });
  if (i.wandering >= 3)
    flags.push({
      title: "Exit-risk escalation — unsafe exits ≥ 3 per week",
      basis: "MCA 2005 + local wandering protocol; Herbert Protocol form",
      action: "Complete/update the Herbert Protocol with the family; raise with the care coordinator.",
    });
  if (i.medsRefused >= 5)
    flags.push({
      title: "Medication review needed — ≥ 5 refused/missed doses a week",
      basis: "NICE NG5 medicines optimisation; Reg. 12 HSCA 2008",
      action: "Ask the GP/pharmacist for a structured medication review (SMR).",
    });
  if (i.burnout >= 7)
    flags.push({
      title: "Carer burnout crisis — respite review",
      basis: "Care Act 2014 s.10 carer's assessment",
      action: "Request a carer's assessment and emergency respite plan.",
    });
  if (i.hydrationDays >= 7)
    flags.push({
      title: "Hydration risk — below target more than half of 14 days",
      basis: "UTI prevention guidance; Reg. 12 safe care & treatment",
      action: "Agree a hydration plan with carers; watch for UTI-driven confusion spikes.",
    });
  return flags;
}

/** Default DCPI inputs seeded from live record signals where available. */
export function dcpiFromRecord(medsRefusedPerWeek: number | undefined): DcpiInputs {
  return { ...DCPI_DEFAULTS, medsRefused: Math.max(0, Math.round(medsRefusedPerWeek ?? DCPI_DEFAULTS.medsRefused)) };
}

export function dcpiReportMd(i: DcpiInputs, score: number, band: DcpiBand, flags: StatutoryFlag[], abcHours?: [number, number][]): string {
  const lines: string[] = [
    "# Dementia Care Progression Index — transition report",
    "",
    `Generated: ${new Date().toLocaleString("en-GB")}  `,
    "Person: Dad · Prepared by the Family care hub (family-owned intelligence layer)",
    "",
    `## Score: ${score} / 100 — ${band.label}`,
    "",
    `**What this means:** ${band.advice}`,
    "",
    "## Indicator inputs",
    "",
    "| Indicator | Value |",
    "|---|---|",
    `| Unsafe exit attempts (wandering) | ${i.wandering} / week |`,
    `| Disorientation episodes (time/place) | ${i.disorientation} / week |`,
    `| Weight loss (12 weeks) | ${i.weightLoss} % |`,
    `| Days below hydration target (last 14) | ${i.hydrationDays} |`,
    `| Medications refused / missed | ${i.medsRefused} / week |`,
    `| Night disturbance / unsafe appliance events | ${i.nightDisturbance} / week |`,
    `| Primary carer burnout (confidential 0-10) | ${i.burnout} |`,
    "",
    "## Statutory thresholds crossed",
    flags.length === 0
      ? "_None this run._"
      : flags.map((f) => `- **${f.title}** — basis: ${f.basis}. *Action:* ${f.action}`).join("\n"),
    "",
  ];
  if (abcHours && abcHours.length) {
    lines.push(
      "## Distress-time pattern (family ABC log, by hour)",
      "",
      ...abcHours.map(([h, n]) => `- ${String(h).padStart(2, "0")}:00 — ${n} episode(s)`),
      ""
    );
  }
  lines.push(
    "## Ask",
    "",
    "1. Care Act 2014 s.9 needs reassessment (with s.10 carer's assessment).",
    "2. Structured medication review (NICE NG5).",
    "3. Consideration of DC/CHC funding eligibility given progressing dementia.",
    "",
    "_Family-generated evidence: portal data + family voice inputs. This report is informational and is not legal or medical advice._"
  );
  return lines.join("\n");
}

// ------------------------------------------------------------------ kiosk
export const KIOSK_BOARDS: { board: string; icon: string; options: string[] }[] = [
  { board: "Dinner", icon: "🍽️", options: ["Fish & chips", "Soup & bread", "Chicken & veg", "Jacket potato", "Egg on toast"] },
  { board: "Drink", icon: "🥤", options: ["Tea", "Coffee", "Squash", "Water", "Orange juice"] },
  { board: "Outfit", icon: "👕", options: ["Blue shirt", "Green jumper", "Cardigan", "Fleece", "Polo shirt"] },
  { board: "Activity", icon: "🧩", options: ["Music", "Garden", "Photo album", "Football on TV", "Walk", "Quiz"] },
];

export const KIOSK_CALM_LINES = [
  "You are safe, Dad. See you soon. — Alex",
  "You served 21 years in the Army. You are our hero.",
  "Mum is being well looked after. She loves you.",
];

export function uid(prefix?: string): string {
  return `${prefix ? prefix + "-" : ""}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
