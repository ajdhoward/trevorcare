// System audit trail for THIS interface — who did what, when, tamper-evidently.
// Every governance action (user changes, role changes, alert edits, exports,
// AI sends, comms-log edits, acting-as switches) is appended to a hash-chained
// log in localStorage. Each record carries seq + prevHash + hash (FNV-1a over
// the payload chain) so silent edits or deletions are detectable on verify().
// This is demonstration-grade integrity (not cryptographic) — the Cloudflare
// deployment notes describe the Workers KV/D1 + HMAC version for production.

export type SysAuditAction =
  | "session.switch"
  | "user.add"
  | "user.update"
  | "user.delete"
  | "users.reset"
  | "alert.rule.add"
  | "alert.rule.update"
  | "alert.rule.delete"
  | "alert.ack"
  | "alert.resolve"
  | "alert.evaluate"
  | "alert.email_draft"
  | "export.file"
  | "export.bundle"
  | "ai.send"
  | "ai.settings"
  | "comms.entry.add"
  | "comms.entry.delete"
  | "comms.letter"
  | "careplan.regenerate"
  | "record.correction"
  | "task.add"
  | "task.complete"
  | "task.reopen"
  | "task.delete"
  | "shopping.add"
  | "shopping.bought"
  | "shopping.delete"
  | "sheet.update"
  | "cal.event.add"
  | "cal.event.delete"
  | "avail.update"
  | "avail.ics"
  | "joint.propose"
  | "joint.confirm"
  | "mum.log.add"
  | "mum.log.delete"
  | "mum.wellbeing.add"
  | "wa.settings"
  | "wa.send"
  | "wa.ingest"
  | "wa.sample_load"
  | "email.route"
  | "inbox.ingest"
  | "lpa.item.toggle"
  | "checkin.log"
  | "microdecline.log"
  | "mood.log"
  | "abc.log"
  | "calming.add"
  | "lifestory.add"
  | "consent.update"
  | "capacity.add"
  | "acd.update"
  | "dcpi.report"
  | "kiosk.choice"
  | "share.create"
  | "share.revoke"
  | "life360.sync"
  | "feedback.ingest"
  | "feedback.apply"
  | "council.check"
  | "policy.ingest"
  | "deploy.step"
  | "ai.gateway"
  | "auth.login"
  | "auth.logout"
  | "calls.copy"
  | "carehub.action.toggle"
  | "carehub.letter.copy"
  | "carehub.letter.dispatch"
  | "handoff.add"
  | "handoff.update"
  | "tracker.update"
  | "tracker.exit.add"
  | "tracker.exit.delete"
  | "medrecon.flag.add"
  | "medrecon.flag.resolve"
  | "medrecon.export"
  | "repo.push";

export interface SysAuditEvent {
  seq: number;
  ts: string; // ISO
  actor: string;
  actorRole: string;
  action: SysAuditAction;
  target: string;
  detail: string;
  severity: "info" | "notice" | "warning";
  prevHash: string;
  hash: string;
}

const K = "care-sysaudit-v1";
const MAX = 600;

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

function computeHash(prev: string, e: Omit<SysAuditEvent, "hash" | "prevHash">): string {
  return fnv1a(`${prev}|${e.seq}|${e.ts}|${e.actor}|${e.actorRole}|${e.action}|${e.target}|${e.detail}|${e.severity}`);
}

export function listEvents(): SysAuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(K);
    if (!raw) return [];
    const v = JSON.parse(raw) as SysAuditEvent[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function persist(events: SysAuditEvent[]) {
  try {
    localStorage.setItem(K, JSON.stringify(events.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

export function logEvent(
  e: Omit<SysAuditEvent, "seq" | "ts" | "prevHash" | "hash"> & { ts?: string }
): SysAuditEvent {
  const events = listEvents();
  const last = events[events.length - 1];
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? "GENESIS";
  const base = {
    seq,
    ts: e.ts ?? new Date().toISOString(),
    actor: e.actor,
    actorRole: e.actorRole,
    action: e.action,
    target: e.target,
    detail: e.detail,
    severity: e.severity ?? ("info" as const),
    prevHash,
  };
  const ev: SysAuditEvent = { ...base, hash: computeHash(prevHash, base) };
  events.push(ev);
  persist(events);
  return ev;
}

/** Verify the hash chain; returns first broken seq or null if intact. */
export function verifyChain(events?: SysAuditEvent[]): number | null {
  const list = events ?? listEvents();
  let prev = "GENESIS";
  for (const e of list) {
    const expect = computeHash(e.prevHash, e);
    if (e.prevHash !== prev || e.hash !== expect) return e.seq;
    prev = e.hash;
  }
  return null;
}

export function exportEventsJson(): string {
  return JSON.stringify(
    {
      exported: new Date().toISOString(),
      system: "Dad's Care Record — access & audit trail",
      intact: verifyChain() === null,
      events: listEvents(),
    },
    null,
    2
  );
}

export function exportEventsCsv(): string {
  const rows = [["seq", "timestamp", "actor", "role", "action", "target", "severity", "detail", "hash", "prevHash"]];
  for (const e of listEvents()) {
    rows.push([
      String(e.seq), e.ts, e.actor, e.actorRole, e.action, e.target, e.severity,
      e.detail.replace(/\s+/g, " ").trim(), e.hash, e.prevHash,
    ]);
  }
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

export function clearEvents() {
  try {
    localStorage.removeItem(K);
  } catch {
    /* ignore */
  }
}

export const ACTION_LABELS: Record<SysAuditAction, string> = {
  "session.switch": "Session switched (acting as)",
  "user.add": "User added",
  "user.update": "User / role updated",
  "user.delete": "User removed",
  "users.reset": "User directory reset",
  "alert.rule.add": "Alert rule created",
  "alert.rule.update": "Alert rule updated",
  "alert.rule.delete": "Alert rule deleted",
  "alert.ack": "Alert acknowledged",
  "alert.resolve": "Alert resolved",
  "alert.evaluate": "Alert rules evaluated",
  "alert.email_draft": "Alert email drafted",
  "export.file": "File downloaded",
  "export.bundle": "AI review bundle downloaded",
  "ai.send": "Record data sent to AI provider",
  "ai.settings": "AI engine settings changed",
  "comms.entry.add": "Communication log entry added",
  "comms.entry.delete": "Communication log entry removed",
  "comms.letter": "Letter/email drafted to contact",
  "careplan.regenerate": "Care plan section regenerated",
  "record.correction": "Record correction recorded",
  "task.add": "Family task added",
  "task.complete": "Family task completed",
  "task.reopen": "Family task re-opened",
  "task.delete": "Family task removed",
  "shopping.add": "Shopping item added",
  "shopping.bought": "Shopping item marked bought",
  "shopping.delete": "Shopping item removed",
  "sheet.update": "Visit task sheet updated",
  "cal.event.add": "Calendar event added",
  "cal.event.delete": "Calendar event removed",
  "avail.update": "Availability updated",
  "avail.ics": "Calendar (ICS) linked / refreshed",
  "joint.propose": "Joint slot proposed",
  "joint.confirm": "Joint slot confirmed",
  "mum.log.add": "Mum's care contact logged",
  "mum.log.delete": "Mum's care contact removed",
  "mum.wellbeing.add": "Mum's well-being entry added",
  "wa.settings": "WhatsApp settings changed",
  "wa.send": "WhatsApp message sent",
  "wa.ingest": "WhatsApp messages ingested",
  "wa.sample_load": "WhatsApp sample messages loaded",
  "email.route": "Email routing settings changed",
  "inbox.ingest": "Emails ingested to care inbox",
  "lpa.item.toggle": "LPA checklist item updated",
  "checkin.log": "Daily family check-in logged",
  "microdecline.log": "Micro-decline questionnaire submitted",
  "mood.log": "Mood-board observation added",
  "abc.log": "Family ABC episode logged",
  "calming.add": "Calming strategy added",
  "lifestory.add": "Life-story entry added",
  "consent.update": "Consent matrix updated",
  "capacity.add": "Capacity ledger entry added",
  "acd.update": "ACD / ReSPECT vault updated",
  "dcpi.report": "DCPI transition report compiled",
  "kiosk.choice": "'My Day' choice received from Dad",
  "share.create": "Shared view link created",
  "share.revoke": "Shared view link revoked",
  "life360.sync": "Life360 locations synced",
  "feedback.ingest": "AI feedback ingested",
  "feedback.apply": "AI feedback applied to portal",
  "council.check": "Council ASC compliance check run",
  "policy.ingest": "Council policy text ingested",
  "deploy.step": "Deployment wizard step completed",
  "ai.gateway": "AI Gateway configuration changed",
  "auth.login": "Portal sign-in",
  "auth.logout": "Portal sign-out",
  "calls.copy": "Call transcript copied",
  "carehub.action.toggle": "Care Hub action updated",
  "carehub.letter.copy": "Statutory letter copied",
  "carehub.letter.dispatch": "Statutory letter dispatched",
  "handoff.add": "Agency handoff logged",
  "handoff.update": "Agency handoff updated",
  "tracker.update": "Tracker status/checklist updated",
  "tracker.exit.add": "Tracker exit event logged",
  "tracker.exit.delete": "Tracker exit event removed",
  "medrecon.flag.add": "Medication exception flag logged",
  "medrecon.flag.resolve": "Medication exception flag updated",
  "medrecon.export": "Medication reconciliation audit exported",
  "repo.push": "Portal pushed to GitHub repo",
};
