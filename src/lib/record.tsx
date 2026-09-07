// Shared types + helpers for Dad's care record interface

export interface TaskItem {
  c: string; // category
  n: string; // name
  s: string; // status
  no: string; // note
  a: string; // action
  an: string; // action notes
  ad: string; // action date
}

export interface MedItem {
  n: string; // name
  d: string; // dose
  s: string; // status
  no: string; // note
  tk: string; // taken at
  p: boolean; // PRN
  w: string; // warning
  lim: string; // do-not-give-before limit
  a: string;
  an: string;
  ad: string;
}

export interface Visit {
  date: string;
  times: string;
  carer: string;
  status: string;
  actual: string;
  sin: string;
  sout: string;
  ain: string;
  aout: string;
  notes: string;
  tlist: string;
  tasks: TaskItem[];
  meds: MedItem[];
}

export interface MedDaily {
  date: string;
  given: number;
  total: number;
  prn_given: number;
  prn_not: number;
  cancelled: number;
}

export interface MedEvent {
  date: string;
  med: string;
  slot: string;
  carer: string;
  comments: string;
  action: string;
  actionBy: string;
}

export interface Flag {
  date: string;
  times: string;
  carer: string;
  kw: string[];
  notes: string;
}

export interface CurrentMed {
  name: string;
  dose: string;
  freq: string;
  prn: boolean;
  form: string;
  directions: string;
  risks: string;
}

export interface Absence {
  from: string;
  to: string;
  reason: string;
}

export interface UpcomingVisit {
  date: string;
  times: string;
  carer: string;
  run: string;
  status: string;
}

export interface PackageSlot {
  packageId: number;
  startDay: string;
  endDay: string;
  times: string;
  duration: number;
  packageStartDate: string;
  packageEndDate: string;
  tasks: string;
}

export interface Contact {
  contactType: string;
  name: string;
  relationship: string;
  address: string;
  postcode: string;
  telNo1: string;
  telNo2: string;
}

export interface ClientInfo {
  name: string;
  dob: string;
  address: string;
  allergies: string;
  pharmacy: string;
  gp: string;
  knownAs: string;
  contacts: Contact[];
}

export interface DocInfo {
  file: string;
  type: string;
  sub: string;
  size: number;
  uploaded: string;
  viewed: string;
}

export interface CareRecord {
  client: ClientInfo;
  hist: Visit[];
  upcoming: UpcomingVisit[];
  med_daily: MedDaily[];
  med_events: MedEvent[];
  carers: [string, number][];
  flags: Flag[];
  meds: CurrentMed[];
  absences: Absence[];
  package: PackageSlot[];
  generated: string;
}

// ---------------------------------------------------------------- status styles
export type StatusTone = "good" | "bad" | "warn" | "grey" | "teal" | "plain";

export function statusTone(s: string): StatusTone {
  const v = (s || "").toLowerCase();
  if (v === "completed" || v === "complete" || v === "given / complete") return "good";
  if (v === "not completed" || v === "not seen" || v === "aborted") return "bad";
  if (v === "not started" || v === "partial" || v === "penalty") return "warn";
  if (v === "cancelled" || v === "cancelled visit") return "grey";
  if (v === "waiting") return "teal";
  return "plain";
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  good: "bg-emerald-100 text-emerald-800 border-emerald-200",
  bad: "bg-red-100 text-red-800 border-red-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  grey: "bg-zinc-200 text-zinc-700 border-zinc-300",
  teal: "bg-teal-100 text-teal-900 border-teal-200",
  plain: "bg-muted text-muted-foreground border-border",
};

export function StatusChip({ s }: { s: string }) {
  const tone = statusTone(s);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {s || "—"}
    </span>
  );
}

// ---------------------------------------------------------------- misc helpers
export function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateRange(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

export function fmtDateTime(s: string): string {
  if (!s) return "";
  return s.replace("T", " ").slice(0, 16);
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export const FLAG_LABELS: Record<string, string> = {
  declin: "Declined",
  refus: "Refused",
  confus: "Confusion",
  fall: "Fall",
  fell: "Fall",
  "hearing aid": "Hearing aids",
  nomad: "Nomad pack",
  pain: "Pain",
  sleeping: "Sleeping",
  hospital: "Hospital",
};

export const AI_PROMPT = `You are reviewing 11 months of complete domiciliary care records for Dad (78, Market Town), provided by the care agency. Start with README_FOR_AI_REVIEW.md, then the insights/ folder (conditions, recommendations, well-being index, flag analytics, Mental Health Act Sections 17/117 check) and the Overview sheet of the Excel workbook, then work through the CSV extracts (visits and notes, task/medication outcomes, eMAR) and the care plan (including the updated 06-09-2026 version) and risk assessments in documents/. Produce: (1) an executive summary a family member could act on; (2) medication safety findings with exact dates and doses; (3) declined-care and consent patterns with quotes; (4) continuity/missed-visit analysis by day-of-week and time-of-day; (5) care-plan adherence gaps and whether the September 2026 amendments cover them; (6) anything that meets safeguarding thresholds; and (7) a prioritised list of questions and actions for the agency, GP and, if needed, Council safeguarding/commissioning. Quote evidence (date, carer, note text) for every finding. Be direct about concerns — this is about keeping my dad safe.`;

// ---------------------------------------------------------------- insights
export type WellbeingBand = { k: string; label: string };

export interface WellbeingDaily {
  date: string;
  score: number;
  visits: number;
  cancelled: number;
  tasks_pct: number | null;
  meds_pct: number | null;
  flags: number;
  flag_types: string[];
  positives: number;
  band: WellbeingBand;
  roll7: number;
}

export interface WellbeingDriver {
  theme: string;
  label: string;
  area: string;
  count: number;
  example: { date: string; notes: string };
}

export interface WellbeingData {
  generated: string;
  method: string;
  bands: { k: string; label: string; min: number; desc: string }[];
  current: {
    score: number;
    band: WellbeingBand;
    prev7: number;
    trend: string;
    window: string;
    days_counted: number;
    components: Record<string, number>;
    components_prev: Record<string, number>;
  };
  daily: WellbeingDaily[];
  monthly: { month: string; score: number; prev: number | null; days: number; min: number; max: number }[];
  drivers: WellbeingDriver[];
}

export interface FlagsAnalytics {
  generated: string;
  total: number;
  theme_order: string[];
  themes: Record<
    string,
    {
      label: string;
      count: number;
      last30: number;
      prev30: number;
      trend: string;
      by_month: Record<string, number>;
      by_call: Record<string, number>;
      top_carers: { name: string; n: number }[];
      rapid_repeats: number;
      examples: { date: string; carer: string; notes: string }[];
    }
  >;
  matrix: Record<string, Record<string, number>>;
  months: string[];
  clusters: { theme: string; label: string; start: string; end: string; n: number }[];
  cooccur: { a: string; b: string; n: number }[];
  by_call: Record<string, number>;
}

export interface ConditionItem {
  id: string;
  name: string;
  category: string;
  source: "recorded" | "inferred";
  source_note: string;
  desc: string;
  meds: string[];
  // richer shape preferred; a bare number (legacy generator output) is rendered
  // defensively as a count instead of crashing the Conditions tab
  evidence:
    | { summary: string; stats?: { label: string; value: number | string }[] }
    | number;
  links: ({ tab: string; kw?: string; label: string } | string)[];
  triggers: string[];
  staff: string[];
  comfort: string[];
  docs: string[];
}

export interface RecommendationItem {
  id: string;
  title: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  rationale: string;
  actions: string[];
  evidence_refs: string;
  links: { conditions: string[] };
}

export interface SectionsData {
  headline: string;
  verdict: string;
  verdict_label: string;
  // data ships as a string[]; a plain string is tolerated defensively
  search_evidence: string[] | string;
  s17: { title: string; what: string; relevance: string; watch_for: string[] | string };
  s117: { title: string; what: string; relevance: string; watch_for: string[] | string };
  related_law: { title: string; text: string }[];
  bottom_line: string;
}

// ---------------------------------------------------------------- audit
export interface AuditNote {
  date: string;
  note: string;
  callId: string;
  carerId: number | null;
}

export interface AuditField {
  field: string;
  source: string;
  verbatim: unknown | null;
  note: string;
}

export interface IncorrectInfoItem {
  id: string;
  item: string;
  severity: "High" | "Medium" | "Low";
  recorded: string;
  reality: string;
  also?: string;
  status: string;
  actions: string[];
}

export interface AuditData {
  generated: string;
  provenance: {
    portal: string;
    account: string;
    pulled: string;
    headline_answer: string;
    fields: AuditField[];
    api_scope: {
      question: string;
      answer: string;
      extra_you_can_get: string[];
      not_exposed_to_family_role: string[];
    };
  };
  change_attribution: {
    question: string;
    answer: string;
    routes: string[];
  };
  alex: {
    question: string;
    answer: string;
    in_contacts: boolean;
    mentions_in_notes: number;
    quotes: AuditNote[];
  };
  alzheimer: {
    question: string;
    short_answer: string;
    diagnosis_named_in_record: null;
    signals: { type: string; weight: string; detail: string; source: string }[];
    note_quotes: {
      memory_clinic: AuditNote[];
      dementia_nurse: AuditNote[];
      confusion: AuditNote[];
    };
    med_spans: {
      memantine: { from: string; active: boolean } | null;
      risperidone: { from: string; active: boolean } | null;
    };
    verdict: string;
    staff_awareness: string[];
    actions: string[];
  };
  incorrect_info: IncorrectInfoItem[];
}

export const COMPONENT_LABELS: Record<string, string> = {
  reliability: "Reliability",
  tasks: "Care tasks",
  medication: "Medication",
  comfort: "Physical comfort",
  food_fluid: "Food & fluids",
  cognition_comms: "Cognition & comms",
};
