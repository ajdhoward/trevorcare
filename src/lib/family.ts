// Family operations layer — the "convenience and control" stores.
// Everything here is family-owned data (tasks, shopping lists, visit task
// sheets, calendar events, LPA availability, Mum's care logs, WhatsApp
// bindings) persisted client-side in localStorage, so it survives reloads
// and stays under the family's control. Server-side ingestion (WhatsApp
// webhook / care inbox) lands in Prisma via /api routes and is mirrored
// into these stores by the UI.

import type { CareRecord } from "@/lib/record";

// ---------------------------------------------------------------- helpers
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso + "T00:00:00").getTime() - new Date(fromIso + "T00:00:00").getTime()) / 86400000
  );
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function day3(iso: string): string {
  return DAY_3[new Date(iso + "T00:00:00").getDay()];
}

export function fmtShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ---------------------------------------------------------------- my tasks
export type TaskFor = "dad" | "mum" | "both" | "family";
export type TaskCategory =
  | "lpa_financial" | "lpa_health" | "shopping" | "communication"
  | "review" | "appointment" | "household" | "other";
export type Assignee = "alex" | "pat" | "either";

export interface MyTask {
  id: string;
  title: string;
  notes?: string;
  forWhom: TaskFor;
  category: TaskCategory;
  due: string; // ISO date
  assignee: Assignee;
  done: boolean;
  doneAt?: string;
  created: string;
  source: "manual" | "whatsapp" | "visit_sheet" | "mum_followup" | "lpa" | "alert";
}

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  lpa_financial: "LPA · financial",
  lpa_health: "LPA · health & welfare",
  shopping: "Shopping",
  communication: "Communication",
  review: "Review",
  appointment: "Appointment",
  household: "Household",
  other: "Other",
};

export const TASK_FOR_LABELS: Record<TaskFor, string> = {
  dad: "Dad",
  mum: "Mum",
  both: "Both parents",
  family: "Family / admin",
};

export const ASSIGNEE_LABELS: Record<Assignee, string> = {
  alex: "Alex",
  pat: "Pat",
  either: "Either of us",
};

export function taskBucket(t: MyTask, today: string): "overdue" | "today" | "week" | "later" | "done" {
  if (t.done) return "done";
  if (t.due < today) return "overdue";
  if (t.due === today) return "today";
  if (t.due <= addDays(today, 7)) return "week";
  return "later";
}

const K_TASKS = "care-tasks-v1";

export function seedTasks(): MyTask[] {
  const t = todayStr();
  const mk = (
    title: string, category: TaskCategory, dueOffset: number, assignee: Assignee,
    forWhom: TaskFor = "dad", notes?: string
  ): MyTask => ({
    id: uid("t"), title, category, due: addDays(t, dueOffset), assignee, forWhom,
    done: false, created: t, source: "lpa", notes,
  });
  return [
    mk("Log this week's wellbeing call to Mum's care home (senior on duty)", "communication", 1, "alex", "mum",
      "Use the questions checklist in Mum's tab, then log the call."),
    mk("Check Dad's shopping list before the weekly shop", "shopping", 2, "either", "dad",
      "Carer visit sheets and the WhatsApp group feed items here automatically."),
    mk("Reconcile the care agency invoice against visit attendance", "lpa_financial", 4, "pat", "dad",
      "Property & financial affairs LPA duty — keep with the accounts file."),
    mk("Request next care-plan review date from the agency", "lpa_health", 9, "either", "dad"),
    mk("Send monthly wellbeing email to Mum's care home manager", "communication", 12, "either", "mum"),
  ];
}

export function loadTasks(): MyTask[] {
  if (typeof window === "undefined") return seedTasks();
  try {
    const raw = localStorage.getItem(K_TASKS);
    if (!raw) return seedTasks();
    const v = JSON.parse(raw) as MyTask[];
    return Array.isArray(v) ? v : seedTasks();
  } catch {
    return seedTasks();
  }
}
export function saveTasks(tasks: MyTask[]) {
  try {
    localStorage.setItem(K_TASKS, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- shopping list
export interface ShoppingItem {
  id: string;
  name: string;
  qty?: string;
  addedBy: string; // display name e.g. "Dawn (carer)" / "Claire (niece-in-law)" / "Alex"
  addedVia: "visit_sheet" | "whatsapp" | "manual";
  visitDate?: string;
  needed: boolean;
  boughtAt?: string;
  boughtBy?: string;
  created: string;
  forWhom: TaskFor;
}

const K_SHOP = "care-shopping-v1";

export function loadShopping(): ShoppingItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_SHOP) || "[]") as ShoppingItem[];
  } catch {
    return [];
  }
}
export function saveShopping(items: ShoppingItem[]) {
  try {
    localStorage.setItem(K_SHOP, JSON.stringify(items));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- visit task sheets
export interface SheetItem {
  id: string;
  name: string;
  addedBy: string;
  addedAt: string;
}

export interface VisitSheet {
  id: string;
  visitDate: string; // ISO date
  visitSlot?: string; // e.g. "08:00–08:30"
  carer?: string;
  tasksDone: string; // what was completed
  items: SheetItem[]; // "items for dad's list" — shopping / requirements noticed on visit
  note: string;
  updated: string;
}

const K_SHEETS = "care-visitsheets-v1";

/** Build sheet stubs for the next N upcoming visits (or the weekly package when the rota is thin). */
export function nextVisitSlots(record: CareRecord, n: number): { date: string; slot?: string; carer?: string }[] {
  const t = todayStr();
  const out: { date: string; slot?: string; carer?: string }[] = record.upcoming
    .filter((u) => u.date >= t)
    .slice(0, n)
    .map((u) => ({ date: u.date, slot: u.times, carer: u.carer }));
  if (out.length < n) {
    // derive from the weekly package so sheets always exist
    const dayMap: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };
    for (let i = 0; out.length < n && i < 21; i++) {
      const d = addDays(t, i);
      const k = day3(d);
      const slots = record.package.filter((p) => (dayMap[p.startDay] || p.startDay.slice(0, 3)) === k);
      for (const p of slots) {
        if (out.length < n && !out.some((o) => o.date === d && o.slot === p.times)) {
          out.push({ date: d, slot: p.times, carer: undefined });
        }
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || (a.slot || "").localeCompare(b.slot || ""));
  }
  return out.slice(0, n);
}

export function loadSheets(): VisitSheet[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_SHEETS) || "[]") as VisitSheet[];
  } catch {
    return [];
  }
}
export function saveSheets(sheets: VisitSheet[]) {
  try {
    localStorage.setItem(K_SHEETS, JSON.stringify(sheets));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- calendar events
export type EventSource = "task" | "joint" | "mum" | "visit" | "whatsapp" | "manual";

export interface CalEvent {
  id: string;
  date: string; // ISO
  endDate?: string; // multi-day (inclusive)
  time?: string; // "HH:MM"
  title: string;
  source: EventSource;
  who: TaskFor;
  details?: string;
}

const K_EVENTS = "care-events-v1";

export function loadEvents(): CalEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_EVENTS) || "[]") as CalEvent[];
  } catch {
    return [];
  }
}
export function saveEvents(events: CalEvent[]) {
  try {
    localStorage.setItem(K_EVENTS, JSON.stringify(events));
  } catch { /* ignore */ }
}

export const SOURCE_META: Record<EventSource, { label: string; dot: string; chip: string }> = {
  task: { label: "My tasks", dot: "bg-amber-500", chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" },
  joint: { label: "Joint (with Pat)", dot: "bg-teal-600", chip: "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-200" },
  mum: { label: "Mum's care", dot: "bg-violet-500", chip: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200" },
  visit: { label: "Dad's visits", dot: "bg-sky-600", chip: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200" },
  whatsapp: { label: "From WhatsApp", dot: "bg-emerald-500", chip: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" },
  manual: { label: "Family events", dot: "bg-zinc-500", chip: "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" },
};

// ---------------------------------------------------------------- availability
export type SlotKey = "am" | "pm" | "eve";
export const SLOTS: { k: SlotKey; label: string; time: string }[] = [
  { k: "am", label: "Morning", time: "09:00–12:00" },
  { k: "pm", label: "Afternoon", time: "13:00–17:00" },
  { k: "eve", label: "Evening", time: "18:00–20:30" },
];

export interface AvailabilityProfile {
  name: string;
  role: string;
  weekly: Record<string, SlotKey[]>; // "Mon".."Sun" -> free slots
  icsUrl?: string;
  icsBusyDates?: string[]; // dates blocked by ICS events
  icsEventCount?: number;
  icsFetchedAt?: string;
  updatedAt: string;
}

export interface JointProposal {
  id: string;
  date: string;
  slot: SlotKey;
  purpose: string;
  proposedBy: string;
  proposedAt: string;
  status: "proposed" | "confirmed" | "declined";
  note?: string;
}

export interface AvailabilityStore {
  alex: AvailabilityProfile;
  pat: AvailabilityProfile;
  proposals: JointProposal[];
}

const K_AVAIL = "care-avail-v1";

const DEFAULT_WEEKLY: Record<string, SlotKey[]> = {
  Mon: ["pm"], Tue: ["am", "pm"], Wed: ["pm"], Thu: ["am", "pm"], Fri: ["pm"], Sat: ["am", "pm"], Sun: ["eve"],
};

export function defaultAvailability(): AvailabilityStore {
  const t = todayStr();
  return {
    alex: { name: "Alex", role: "Family lead · co-attorney (LPA)", weekly: { ...DEFAULT_WEEKLY }, updatedAt: t },
    pat: { name: "Pat", role: "Co-attorney (LPA)", weekly: { ...DEFAULT_WEEKLY }, updatedAt: t },
    proposals: [],
  };
}

export function loadAvailability(): AvailabilityStore {
  if (typeof window === "undefined") return defaultAvailability();
  try {
    const raw = localStorage.getItem(K_AVAIL);
    if (!raw) return defaultAvailability();
    const v = JSON.parse(raw) as AvailabilityStore;
    return v && v.alex && v.pat ? v : defaultAvailability();
  } catch {
    return defaultAvailability();
  }
}
export function saveAvailability(a: AvailabilityStore) {
  try {
    localStorage.setItem(K_AVAIL, JSON.stringify(a));
  } catch { /* ignore */ }
}

/** Days in the next `weeks` weeks where both profiles show a common free slot. */
export function suggestJointSlots(
  avail: AvailabilityStore,
  weeks = 4
): { date: string; slots: SlotKey[] }[] {
  const busy = new Set<string>([...(avail.alex.icsBusyDates ?? []), ...(avail.pat.icsBusyDates ?? [])]);
  const out: { date: string; slots: SlotKey[] }[] = [];
  const t = todayStr();
  for (let i = 1; i <= weeks * 7; i++) {
    const d = addDays(t, i);
    if (busy.has(d)) continue;
    const k = day3(d);
    const a = avail.alex.weekly[k] ?? [];
    const g = avail.pat.weekly[k] ?? [];
    const both = (["am", "pm", "eve"] as SlotKey[]).filter((s) => a.includes(s) && g.includes(s));
    if (both.length) out.push({ date: d, slots: both });
  }
  return out;
}

// ---------------------------------------------------------------- Mum (mum) logs
export interface MumContact {
  id: string;
  date: string;
  type: "call" | "email" | "visit" | "video";
  who: string;
  summary: string;
  followUp: boolean;
  followUpBy?: string;
  created: string;
}

export interface MumWellbeingEntry {
  id: string;
  date: string;
  score: number; // 1..5
  tags: string[];
  note: string;
}

export const MUM_WB_TAGS = [
  "Eating well", "Engaged in activities", "Rested / sleeping", "Mobility OK",
  "Cheerful in herself", "Low mood", "Unwell / off food", "Skin / bruising concern",
] as const;

export const MUM_WB_SCALE = [
  { score: 5, label: "Very good", desc: "Bright, engaged, eating and drinking well, no concerns." },
  { score: 4, label: "Good", desc: "Steady baseline; minor, self-resolving niggles." },
  { score: 3, label: "Mixed", desc: "Good days and off days; worth watching and mentioning to the home." },
  { score: 2, label: "Concerning", desc: "Clear change — request the home to review and tell us what they find." },
  { score: 1, label: "Urgent concern", desc: "Escalate today: senior on duty → manager; consider GP review." },
];

const K_JANE_CONTACTS = "care-mum-contacts-v1";
const K_JANE_WB = "care-mum-wb-v1";

export function loadJaneContacts(): MumContact[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_JANE_CONTACTS) || "[]") as MumContact[];
  } catch {
    return [];
  }
}
export function saveJaneContacts(list: MumContact[]) {
  try {
    localStorage.setItem(K_JANE_CONTACTS, JSON.stringify(list));
  } catch { /* ignore */ }
}
export function loadJaneWellbeing(): MumWellbeingEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_JANE_WB) || "[]") as MumWellbeingEntry[];
  } catch {
    return [];
  }
}
export function saveJaneWellbeing(list: MumWellbeingEntry[]) {
  try {
    localStorage.setItem(K_JANE_WB, JSON.stringify(list));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- WhatsApp (Whapi.Cloud)
export interface WaSettings {
  token: string;
  dadGroupId: string;
  dadGroupName: string;
  mumGroupId: string;
  mumGroupName: string;
  autoPoll: boolean;
  configured: boolean;
}

export const DEFAULT_WA_SETTINGS: WaSettings = {
  token: "", dadGroupId: "", dadGroupName: "Dad's care group (existing)",
  mumGroupId: "", mumGroupName: "Mum's group (Mum + Mum's care home)",
  autoPoll: true, configured: false,
};

const K_WA_SETTINGS = "care-wa-settings-v1";
const K_WA_CACHE = "care-wa-cache-v1";
const K_WA_PROCESSED = "care-wa-processed-v1";

export function loadWaSettings(): WaSettings {
  if (typeof window === "undefined") return DEFAULT_WA_SETTINGS;
  try {
    const raw = localStorage.getItem(K_WA_SETTINGS);
    if (!raw) return DEFAULT_WA_SETTINGS;
    return { ...DEFAULT_WA_SETTINGS, ...(JSON.parse(raw) as Partial<WaSettings>) };
  } catch {
    return DEFAULT_WA_SETTINGS;
  }
}
export function saveWaSettings(s: WaSettings) {
  try {
    localStorage.setItem(K_WA_SETTINGS, JSON.stringify(s));
  } catch { /* ignore */ }
}

export interface WaMessage {
  id: string;
  groupId: string;
  groupName?: string;
  sender: string;
  ts: string; // ISO
  body: string;
  source: "webhook" | "sample" | "poll" | "email";
}

export function loadWaCache(): WaMessage[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(K_WA_CACHE) || "[]") as WaMessage[];
  } catch {
    return [];
  }
}
export function saveWaCache(list: WaMessage[]) {
  try {
    localStorage.setItem(K_WA_CACHE, JSON.stringify(list.slice(-300)));
  } catch { /* ignore */ }
}

export function loadWaProcessed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(K_WA_PROCESSED) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
export function saveWaProcessed(p: Record<string, boolean>) {
  try {
    localStorage.setItem(K_WA_PROCESSED, JSON.stringify(p));
  } catch { /* ignore */ }
}

export const WA_SAMPLE_MESSAGES: WaMessage[] = [
  {
    id: "sample-1", groupId: "120363…@g.us", groupName: "Dad's care group",
    sender: "Claire (niece-in-law)", ts: new Date().toISOString(),
    body: "Just back from seeing Grandad — he was in good form. They've run out of bleach and he's low on shaving foam, said his radio batteries have gone as well. Added it to the chat so we don't forget.",
    source: "sample",
  },
  {
    id: "sample-2", groupId: "120363…@g.us", groupName: "Dad's care group",
    sender: "Dawn (the care agency)", ts: new Date(Date.now() - 3600_000 * 5).toISOString(),
    body: "Visit done 8-8.30, all meds given. He seemed a bit confused about the time again this morning but settled after breakfast. We could do with some more squash when anyone is passing the shops.",
    source: "sample",
  },
  {
    id: "sample-3", groupId: "120363…@g.us", groupName: "Dad's care group",
    sender: "Alex", ts: new Date(Date.now() - 3600_000 * 26).toISOString(),
    body: "Reminder: GP memory clinic review is 18/09 at 10:30 — I'll go with Dad. Can someone cover the 14:00 visit that day?",
    source: "sample",
  },
];

/** Rule-based extraction: what a group message means for the flows. */
export interface WaAnalysis {
  shopping: string[];
  concern: { theme: string; label: string } | null;
  appointment: { date?: string; time?: string; text: string } | null;
}

const KNOWN_ITEMS = [
  "bleach", "shaving foam", "razor", "razor blades", "soap", "shower gel", "shampoo",
  "toothpaste", "deodorant", "squash", "juice", "milk", "bread", "butter", "eggs",
  "biscuits", "teabags", "coffee", "sugar", "tinned soup", "bin bags", "tissues",
  "kitchen roll", "toilet roll", "laundry", "washing powder", "washing pods",
  "incontinence pads", "radio batteries", "batteries", "light bulbs", "batteries",
];

const CONCERNS: { re: RegExp; theme: string; label: string }[] = [
  { re: /\bfell\b|\bfall(en)?\b|\bbruise/i, theme: "fall", label: "Possible fall / injury mentioned" },
  { re: /\bconfus|\bdisorient|\bnot sure where|\bdidn'?t know where/i, theme: "confus", label: "Confusion mentioned" },
  { re: /\bdeclin|\brefus|\bwouldn'?t (let|take|have)\b|\bnot (eating|drinking)\b/i, theme: "declin", label: "Care/food declined or refused" },
  { re: /\bpain|\bsore|\bhurts?\b/i, theme: "pain", label: "Pain mentioned" },
  { re: /\bunwell|\bill|\btemperature|\bsick\b|\bhospital/i, theme: "unwell", label: "Unwell / hospital mentioned" },
];

// Negation handling (CODE_REVIEW H2): a concern keyword inside the scope of a
// negation ("did not fall", "no pain", "denies confusion", "pain free") must
// NOT raise the flag. Checks a window before the match and the match itself.
// Theme "declin" is EXEMPT — its own patterns are already negative behaviours
// ("not eating", "refused meds") and must survive their own wording.
const NEGATION_RE =
  /\b(no|not|n't|never|without|denies|denied|no\s+signs?\s+of|free\s+from|free|resolved|settled|improved)\b/i;

function negated(text: string, index: number, len: number): boolean {
  const windowStart = Math.max(0, index - 42);
  const before = text.slice(windowStart, index);
  const after = text.slice(index, index + len + 24); // e.g. "pain free", "fell asleep"
  return NEGATION_RE.test(before) || /\basleep\b|\bfest(ive)?\b|\bfree\b/i.test(after);
}

export function analyzeWaMessage(body: string): WaAnalysis {
  const text = body || "";
  const lower = text.toLowerCase();

  // shopping: known items near "need / run out / low on / pick up / add to list", else item names outright
  const shopping = new Set<string>();
  const cueRe = /(run(?:ning)? (?:out of|low on)|low on|out of|needs?|pick(?:ing)? up|get(?:ting)? (?:some|more)|add(?:ed)? (?:it |this )?to (?:the )?list|shopping|forgo?t)/i;
  for (const item of KNOWN_ITEMS) {
    const idx = lower.indexOf(item);
    if (idx === -1) continue;
    const window = lower.slice(Math.max(0, idx - 70), idx + item.length + 20);
    if (cueRe.test(window)) shopping.add(item.replace(/\b\w/, (c) => c.toUpperCase()));
  }
  // fallback: explicit "we need X" style capture
  const needRe = /(?:we |he |she )?(?:also )?(?:need|needs|could do with|get|pick up|buy)(?: some| more)? ([a-z ,\-']{3,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = needRe.exec(lower))) {
    const phrase = m[1].split(/[.,!?]|\bwhen\b|\bbefore\b|\bafter\b/)[0].trim();
    const hit = KNOWN_ITEMS.find((i) => phrase.includes(i));
    if (hit) shopping.add(hit.replace(/\b\w/, (c) => c.toUpperCase()));
    else if (phrase.length >= 3 && phrase.split(" ").length <= 3) {
      shopping.add(phrase.replace(/\b\w/, (c) => c.toUpperCase()));
    }
  }

  // negation-aware concern matching: find the first match that is not inside
  // a negation scope (see negated() above)
  let concern: WaAnalysis["concern"] = null;
  for (const c of CONCERNS) {
    const m = c.re.exec(lower);
    if (!m) continue;
    if (c.theme !== "declin" && negated(lower, m.index, m[0].length)) {
      // keep scanning later occurrences before giving up on this theme
      let found = false;
      let rest = lower.slice(m.index + m[0].length);
      let offset = m.index + m[0].length;
      while (rest.length > 0) {
        const m2 = c.re.exec(rest);
        if (!m2) break;
        if (!negated(lower, offset + m2.index, m2[0].length)) {
          concern = c;
          found = true;
          break;
        }
        rest = rest.slice(m2.index + m2[0].length);
        offset += m2.index + m2[0].length;
      }
      if (found) break;
      continue;
    }
    concern = c;
    break;
  }

  let appointment: WaAnalysis["appointment"] = null;
  const dmy = text.match(/\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?\b/);
  const time = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
  if (dmy || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower)) {
    let date: string | undefined;
    if (dmy) {
      const [, dd, mm, yy] = dmy;
      const year = yy ? (yy.length === 2 ? `20${yy}` : yy) : String(new Date().getFullYear());
      date = `${year}-${String(Number(mm)).padStart(2, "0")}-${String(Number(dd)).padStart(2, "0")}`;
    }
    appointment = {
      date,
      time: time ? `${String(Number(time[1])).padStart(2, "0")}:${time[2]}${time[3] ? time[3].toLowerCase() : ""}` : undefined,
      text: text.slice(0, 160),
    };
  }

  return { shopping: [...shopping], concern: concern ? { theme: concern.theme, label: concern.label } : null, appointment };
}

// ---------------------------------------------------------------- ICS export
function icsEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(events: CalEvent[], calName = "Family care"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Family Care Hub//EN",
    `X-WR-CALNAME:${icsEsc(calName)}`, "CALSCALE:GREGORIAN",
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@familycare`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`);
    const end = addDays(e.endDate || e.date, 1);
    lines.push(`DTEND;VALUE=DATE:${end.replace(/-/g, "")}`);
    lines.push(`SUMMARY:${icsEsc(e.title + (e.time ? ` ${e.time}` : ""))}`);
    if (e.details) lines.push(`DESCRIPTION:${icsEsc(e.details.slice(0, 400))}`);
    lines.push(`CATEGORIES:${e.source.toUpperCase()}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------------------------------------------------------------- dedicated email
export interface EmailRouteSettings {
  dedicatedAddress: string;
  forwardTo: string;
  pollNote: string;
}

export const DEFAULT_EMAIL_ROUTE: EmailRouteSettings = {
  dedicatedAddress: "",
  forwardTo: "",
  pollNote: "",
};

const K_EMAIL_ROUTE = "care-emailroute-v1";

export function loadEmailRoute(): EmailRouteSettings {
  if (typeof window === "undefined") return DEFAULT_EMAIL_ROUTE;
  try {
    const raw = localStorage.getItem(K_EMAIL_ROUTE);
    if (!raw) return DEFAULT_EMAIL_ROUTE;
    return { ...DEFAULT_EMAIL_ROUTE, ...(JSON.parse(raw) as Partial<EmailRouteSettings>) };
  } catch {
    return DEFAULT_EMAIL_ROUTE;
  }
}
export function saveEmailRoute(s: EmailRouteSettings) {
  try {
    localStorage.setItem(K_EMAIL_ROUTE, JSON.stringify(s));
  } catch { /* ignore */ }
}

export interface InboxMessage {
  id: string;
  source: "email" | "whatsapp";
  from: string;
  subject?: string;
  body: string;
  ts: string;
  processed: boolean;
}

// ---------------------------------------------------------------- LPA checklist store
export interface LpaCheckState {
  done: boolean;
  assignee: "alex" | "pat" | "shared";
}

const K_LPA_CHECKS = "care-lpa-checks-v1";

export function loadLpaChecks(): Record<string, LpaCheckState> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(K_LPA_CHECKS) || "{}") as Record<string, LpaCheckState>;
  } catch {
    return {};
  }
}
export function saveLpaChecks(v: Record<string, LpaCheckState>) {
  try {
    localStorage.setItem(K_LPA_CHECKS, JSON.stringify(v));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- mum.json shape
export interface MumInfo {
  generated: string;
  profile: {
    name: string;
    relationship: string;
    setting: string;
    portalAvailable: boolean;
    monitoringModel: string;
    careHome: {
      name: string;
      operator: string;
      town: string;
      web: string;
      phone: string;
      email: string;
      manager: string;
      address: string;
      fillNote: string;
    };
    lpaNote: string;
  };
  protocol: {
    cadence: { freq: string; what: string; detail: string }[];
    questionsChecklist: string[];
    escalation: string[];
    whatsappPlan: string[];
  };
  emailTemplates: { id: string; title: string; subject: string; body: string }[];
}
