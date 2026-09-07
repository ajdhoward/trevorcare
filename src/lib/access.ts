// Access control: roles, permission matrix, user directory, acting-as session.
// Client-side RBAC for the family oversight interface. The permission matrix is
// also the specification for a server-side deployment (see cloudflare-worker/README):
// enforce the same checks on the server before any data leaves the origin.

export type RoleId = "admin" | "family" | "coordinator" | "carer" | "social" | "auditor";

export interface RoleDef {
  id: RoleId;
  label: string;
  desc: string;
  basis: string; // lawful-basis / framework note
}

export type Permission =
  | "view.overview"
  | "view.visits"
  | "view.medication"
  | "view.watchlist"
  | "view.wellbeing"
  | "view.conditions"
  | "view.recommendations"
  | "view.records_audit"
  | "view.social"
  | "view.ai"
  | "view.schedule"
  | "view.documents"
  | "view.downloads"
  | "view.api_catalog"
  | "view.alerts"
  | "view.access_audit"
  | "view.mytasks"
  | "view.calendar"
  | "view.lpa"
  | "view.whatsapp"
  | "view.mum"
  | "view.familyvoice"
  | "view.dcpi"
  | "view.share"
  | "view.life360"
  | "view.aibrief"
  | "view.council"
  | "view.deploy"
  | "view.kiosk"
  | "data.contacts"
  | "data.documents"
  | "action.export"
  | "action.comms_edit"
  | "action.alerts_manage"
  | "action.users_manage"
  | "action.ai_use"
  | "action.task_manage"
  | "action.availability"
  | "action.wa_send"
  | "action.mum_log"
  | "action.share_manage"
  | "action.ingest";

export const ROLES: Record<RoleId, RoleDef> = {
  admin: {
    id: "admin",
    label: "Administrator (family lead)",
    desc: "Full control: all data, users, roles, alerts, exports and the audit trail.",
    basis: "Data controller (family) — UK GDPR Art. 6(1)(f) legitimate interests + Art. 9(2)(h) health care management.",
  },
  family: {
    id: "family",
    label: "Family member",
    desc: "All care information and documents; cannot manage users or roles.",
    basis: "Same household / involved in care — DPA 2018 Sch.1 Pt.1 s.2 + common-law consent of the patient's representative.",
  },
  coordinator: {
    id: "coordinator",
    label: "Care coordinator (agency)",
    desc: "Operational view: visits, medication, schedule, comms. No family strategy tabs, exports or AI.",
    basis: "Data processor staff — Care Act 2014 s.9/24 assessment duties; confidentiality policy 104.",
  },
  carer: {
    id: "carer",
    label: "Care worker",
    desc: "Only what a shift needs: today's picture, medication, conditions & mitigation, schedule. No contacts, notes-analytics or documents.",
    basis: "Need-to-know minimum — GDPR Art. 5(1)(c) data minimisation; policy 104 Confidentiality; policy 310 Safeguarding.",
  },
  social: {
    id: "social",
    label: "Social worker / commissioner",
    desc: "Review-level access including records audit and recommendations for care act reviews.",
    basis: "Care Act 2014 s.9 (assessment), s.42 (safeguarding enquiry) — statutory function.",
  },
  auditor: {
    id: "auditor",
    label: "External auditor / advocate",
    desc: "Read + audit focus for CQC inspection, advocacy or independent review; personal contacts withheld.",
    basis: "Health & Social Care Act 2008 (Regulated Activities) Reg. 9A duty of candour / CQC inspection powers; Art. 5(1)(c) minimisation.",
  },
};

export const ALL_PERMISSIONS: Permission[] = [
  "view.overview", "view.visits", "view.medication", "view.watchlist", "view.wellbeing",
  "view.conditions", "view.recommendations", "view.records_audit", "view.social", "view.ai",
  "view.schedule", "view.documents", "view.downloads", "view.api_catalog", "view.alerts",
  "view.access_audit",
  "view.mytasks", "view.calendar", "view.lpa", "view.whatsapp", "view.mum",
  "view.familyvoice", "view.dcpi", "view.share", "view.life360", "view.aibrief",
  "view.council", "view.deploy", "view.kiosk",
  "data.contacts", "data.documents",
  "action.export", "action.comms_edit", "action.alerts_manage", "action.users_manage", "action.ai_use",
  "action.task_manage", "action.availability", "action.wa_send", "action.mum_log",
  "action.share_manage", "action.ingest",
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "view.overview": "Overview tab",
  "view.visits": "Visits & notes",
  "view.medication": "Medication & eMAR",
  "view.watchlist": "Watch items (flag analytics)",
  "view.wellbeing": "Well-being index",
  "view.conditions": "Conditions & mitigation",
  "view.recommendations": "Recommendations",
  "view.records_audit": "Records audit (provenance)",
  "view.social": "Social & comms",
  "view.ai": "AI assistant tab",
  "view.schedule": "Schedule & package",
  "view.documents": "Documents library",
  "view.downloads": "Downloads tab",
  "view.api_catalog": "API & data catalog",
  "view.alerts": "Alerts centre",
  "view.access_audit": "Access & audit trail",
  "view.mytasks": "My tasks & shopping list",
  "view.calendar": "Family calendar",
  "view.lpa": "LPA & joint availability",
  "view.whatsapp": "WhatsApp group integration",
  "view.mum": "Mum's care (Mum) information",
  "view.familyvoice": "Family voice hub (check-ins, mood board, ABC log, consent)",
  "view.dcpi": "Dementia Care Progression Index (DCPI)",
  "view.share": "Shared views (time-boxed links for advisers)",
  "view.life360": "Life360 location awareness",
  "view.aibrief": "AI review brief & feedback inbox",
  "view.council": "Council ASC policy & compliance watch",
  "view.deploy": "Deployment, GitHub sync & AI Gateway",
  "view.kiosk": "'My Day' tablet view (Dad)",
  "data.contacts": "See contacts / next-of-kin details",
  "data.documents": "Open documents (care plan, risk assessments)",
  "action.export": "Download data & bundles",
  "action.comms_edit": "Edit communication log",
  "action.alerts_manage": "Create & edit alert rules",
  "action.users_manage": "Manage users & roles",
  "action.ai_use": "Send record data to AI providers",
  "action.task_manage": "Add & complete tasks, shopping items, visit sheets",
  "action.availability": "Edit LPA availability & propose joint slots",
  "action.wa_send": "Send WhatsApp messages to bound groups",
  "action.mum_log": "Log calls/emails & well-being for Mum's care",
  "action.share_manage": "Create & revoke shared views",
  "action.ingest": "Apply AI feedback into the portal",
};

const F = (p: Permission) => p;

export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = {
  admin: ALL_PERMISSIONS,
  family: [
    "view.overview", "view.visits", "view.medication", "view.watchlist", "view.wellbeing",
    "view.conditions", "view.recommendations", "view.records_audit", "view.social", "view.ai",
    "view.schedule", "view.documents", "view.downloads", "view.api_catalog", "view.alerts",
    "view.access_audit",
    "view.mytasks", "view.calendar", "view.lpa", "view.whatsapp", "view.mum",
    "view.familyvoice", "view.dcpi", "view.share", "view.life360", "view.aibrief",
    "view.council", "view.deploy", "view.kiosk",
    "data.contacts", "data.documents",
    "action.export", "action.comms_edit", "action.alerts_manage", "action.ai_use",
    "action.task_manage", "action.availability", "action.wa_send", "action.mum_log",
    "action.share_manage", "action.ingest",
  ],
  coordinator: [
    "view.overview", "view.visits", "view.medication", "view.wellbeing", "view.conditions",
    "view.social", "view.schedule", "view.documents", "view.alerts",
    "view.mytasks", "view.calendar", "view.whatsapp", "view.mum",
    "data.contacts", "data.documents",
    "action.comms_edit", "action.task_manage", "action.wa_send", "action.mum_log",
  ],
  carer: [
    "view.overview", "view.visits", "view.medication", "view.conditions",
    "view.schedule", "view.alerts",
    "view.mytasks", "view.calendar",
    "action.task_manage",
  ],
  social: [
    "view.overview", "view.visits", "view.medication", "view.watchlist", "view.wellbeing",
    "view.conditions", "view.recommendations", "view.records_audit", "view.social",
    "view.schedule", "view.documents", "view.alerts",
    "view.mytasks", "view.calendar", "view.council", "view.dcpi",
    "data.contacts", "data.documents",
    "action.export", "action.comms_edit",
  ],
  auditor: [
    "view.overview", "view.visits", "view.medication", "view.watchlist", "view.wellbeing",
    "view.conditions", "view.recommendations", "view.records_audit", "view.schedule",
    "view.documents", "view.downloads", "view.api_catalog", "view.alerts", "view.access_audit",
    "view.council", "view.dcpi", "view.familyvoice",
    "data.documents",
    "action.export",
  ],
};

// ---------------------------------------------------------------- users
export type UserStatus = "active" | "invited" | "suspended";

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: RoleId;
  status: UserStatus;
  added: string;
  note?: string;
  lastSeen?: string;
}

const SEED_USERS: SystemUser[] = [
  {
    id: "u-alex",
    name: "Alex",
    email: "admin@family.example",
    role: "admin",
    status: "active",
    added: "2026-09-05",
    note: "Family lead — account owner (sample persona). Replace with your details.",
    lastSeen: new Date().toISOString().slice(0, 10),
  },
  {
    id: "u-pat",
    name: "Pat",
    email: "pat@example",
    role: "family",
    status: "invited",
    added: "2026-09-06",
    note: "Co-attorney (LPA — health & welfare + property & financial affairs). Invite with her real email; she links her calendar in LPA & availability.",
  },
  {
    id: "u-ex-coord",
    name: "the care agency office (coordinator)",
    email: "coordinator@care-agency.example",
    role: "coordinator",
    status: "invited",
    added: "2026-09-06",
    note: "Example invite — replace with the real coordinator before sending.",
  },
  {
    id: "u-ex-carer",
    name: "Assigned care worker (daily visit team)",
    email: "carer@care-agency.example",
    role: "carer",
    status: "suspended",
    added: "2026-09-06",
    note: "Example — minimum-data role for shift staff. Invite individually; never share one login.",
  },
  {
    id: "u-ex-social",
    name: "Assigned social worker",
    email: "socialworker@council.example",
    role: "social",
    status: "invited",
    added: "2026-09-06",
    note: "Example invite — attach to Care Act s.9 review correspondence in Social & comms.",
  },
  {
    id: "u-ex-auditor",
    name: "External auditor (CQC / advocate)",
    email: "auditor@example",
    role: "auditor",
    status: "suspended",
    added: "2026-09-06",
    note: "Example — enable only for a scoped review, then suspend.",
  },
];

const K_USERS = "care-users-v1";
const K_SESSION = "care-session-v1";

export function loadUsers(): SystemUser[] {
  if (typeof window === "undefined") return SEED_USERS;
  try {
    const raw = localStorage.getItem(K_USERS);
    if (!raw) return SEED_USERS;
    const v = JSON.parse(raw) as SystemUser[];
    return Array.isArray(v) && v.length ? v : SEED_USERS;
  } catch {
    return SEED_USERS;
  }
}

export function saveUsers(users: SystemUser[]) {
  try {
    localStorage.setItem(K_USERS, JSON.stringify(users));
  } catch {
    /* storage full / private mode */
  }
}

export function currentUserId(): string {
  if (typeof window === "undefined") return "u-alex";
  return localStorage.getItem(K_SESSION) || "u-alex";
}

export function setCurrentUserId(id: string) {
  try {
    localStorage.setItem(K_SESSION, id);
  } catch {
    /* ignore */
  }
}

export function getUser(users: SystemUser[], id: string): SystemUser | undefined {
  return users.find((u) => u.id === id);
}

export function effectiveUser(users: SystemUser[]): SystemUser {
  return getUser(users, currentUserId()) ?? users[0] ?? SEED_USERS[0];
}

export function can(user: SystemUser | undefined, perm: Permission): boolean {
  if (!user || user.status !== "active") return false;
  return ROLE_PERMISSIONS[user.role].includes(perm);
}

export function permissionsOf(user: SystemUser | undefined): Permission[] {
  if (!user || user.status !== "active") return [];
  return ROLE_PERMISSIONS[user.role];
}

export function userLabel(u: SystemUser): string {
  return `${u.name} · ${ROLES[u.role].label.split(" (")[0]}${u.status !== "active" ? ` · ${u.status}` : ""}`;
}

export const ROLE_ORDER: RoleId[] = ["admin", "family", "coordinator", "carer", "social", "auditor"];
