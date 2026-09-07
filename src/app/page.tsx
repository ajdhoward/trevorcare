"use client";

// Family Care Hub — ground-up IA (batch 7):
// Family-first, both parents paramount. Sidebar information architecture:
//   Family hub (today's responsibilities) · Dad (care record)
//   Mum's care home) · Connect (WhatsApp / share / AI bridge)
//   Intelligence (family voice, DCPI) · Oversight & assurance · Workspace & tools
// RBAC filters every group; the acting-as switcher, bell and theme live in the header.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  CalendarCheck,
  Pill,
  Eye,
  Activity,
  Stethoscope,
  Lightbulb,
  Loader2,
  ShieldCheck,
  UsersRound,
  Bot,
  Sun,
  Moon,
  Bell,
  Siren,
  Database,
  UserCog,
  HeartPulse,
  ListChecks,
  CalendarDays,
  FileBadge,
  MessageSquareText,
  FileText,
  Download,
  Building2,
  HeartHandshake,
  Gauge,
  Link2,
  LocateFixed,
  Landmark,
  Menu,
  MonitorSmartphone,
  Rocket,
  Sparkles,
  X,
  PhoneCall,
  Gavel,
  LogOut,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Dashboard from "@/components/record/dashboard";
import MyTasks from "@/components/record/mytasks";
import MyCalendar from "@/components/record/mycalendar";
import Lpa from "@/components/record/lpa";
import MumCare from "@/components/record/mum";
import WhatsAppHub from "@/components/record/whatsapp";
import Overview from "@/components/record/overview";
import Visits from "@/components/record/visits";
import Medication from "@/components/record/medication";
import Watchlist from "@/components/record/watchlist";
import Wellbeing from "@/components/record/wellbeing";
import Conditions from "@/components/record/conditions";
import Recommendations from "@/components/record/recommendations";
import Audit from "@/components/record/audit";
import Social from "@/components/record/social";
import Assistant from "@/components/record/assistant";
import Schedule from "@/components/record/schedule";
import Documents from "@/components/record/documents";
import Downloads from "@/components/record/downloads";
import AlertsCentre from "@/components/record/alerts";
import ApiCatalog from "@/components/record/apicatalog";
import Governance from "@/components/record/governance";
import FamilyVoice, { DcpiPanel } from "@/components/record/haven360";
import Share from "@/components/record/share";
import Life360Panel from "@/components/record/life360";
import AiBrief from "@/components/record/aibrief";
import Council from "@/components/record/council";
import Deploy from "@/components/record/deploy";
import Calls from "@/components/record/calls";
import CareHub from "@/components/record/carehub";
import {
  type CallsData,
} from "@/lib/calls";
import { type TrackerStore, type TrackerExit, loadTracker, loadExits, saveTracker, saveExits } from "@/lib/tracker";
import {
  type MedReconStore, type MedException, loadMedRecon, loadMedExceptions,
  saveMedRecon, saveMedExceptions, defaultMedRecon, MedRecon,
} from "@/components/record/medrecon";
import {
  type CareRecord,
  type DocInfo,
  type WellbeingData,
  type FlagsAnalytics,
  type ConditionItem,
  type RecommendationItem,
  type SectionsData,
  type AuditData,
} from "@/lib/record";
import {
  type SystemUser, type Permission, ROLES,
  loadUsers, saveUsers, currentUserId, setCurrentUserId, effectiveUser, can,
} from "@/lib/access";
import {
  type AlertRule, type AlertState, loadRules, saveRules, loadAlertState,
  saveAlertState, evaluateAlerts,
} from "@/lib/alerts";
import { logEvent, type SysAuditAction } from "@/lib/auditlog";
import type { ApiCatalogData } from "@/components/record/apicatalog";
import {
  type MyTask, type ShoppingItem, type VisitSheet, type CalEvent,
  type AvailabilityStore, type MumContact, type MumWellbeingEntry, type MumInfo,
  type WaSettings, type WaMessage,
  loadTasks, saveTasks, loadShopping, saveShopping, loadSheets, saveSheets,
  loadEvents, saveEvents, loadAvailability, saveAvailability,
  loadJaneContacts, saveJaneContacts, loadJaneWellbeing, saveJaneWellbeing,
  loadWaSettings, saveWaSettings, loadWaCache, saveWaCache,
  loadWaProcessed, saveWaProcessed, loadEmailRoute, saveEmailRoute,
  type EmailRouteSettings,
} from "@/lib/family";

type TabPerm = { id: string; label: string; icon: React.ReactNode; perm: Permission };

const TAB_GROUPS: { label: string; tabs: TabPerm[] }[] = [
  {
    label: "Family hub",
    tabs: [
      { id: "dashboard", label: "My dashboard", icon: <LayoutDashboard className="h-4 w-4" />, perm: "view.overview" },
      { id: "mytasks", label: "My tasks", icon: <ListChecks className="h-4 w-4" />, perm: "view.mytasks" },
      { id: "calendar", label: "Calendar", icon: <CalendarDays className="h-4 w-4" />, perm: "view.calendar" },
      { id: "lpa", label: "LPA & availability", icon: <FileBadge className="h-4 w-4" />, perm: "view.lpa" },
      { id: "life360", label: "Family circle (Life360)", icon: <LocateFixed className="h-4 w-4" />, perm: "view.life360" },
    ],
  },
  {
    label: "Dad (home care)",
    tabs: [
      { id: "overview", label: "Overview", icon: <HeartPulse className="h-4 w-4" />, perm: "view.overview" },
      { id: "visits", label: "Visits & Notes", icon: <CalendarCheck className="h-4 w-4" />, perm: "view.visits" },
      { id: "medication", label: "Medication", icon: <Pill className="h-4 w-4" />, perm: "view.medication" },
      { id: "watchlist", label: "Watch items", icon: <Eye className="h-4 w-4" />, perm: "view.watchlist" },
      { id: "wellbeing", label: "Well-being", icon: <Activity className="h-4 w-4" />, perm: "view.wellbeing" },
      { id: "conditions", label: "Conditions", icon: <Stethoscope className="h-4 w-4" />, perm: "view.conditions" },
      { id: "schedule", label: "Schedule & package", icon: <CalendarDays className="h-4 w-4" />, perm: "view.schedule" },
      { id: "documents", label: "Documents", icon: <FileText className="h-4 w-4" />, perm: "view.documents" },
      { id: "kiosk", label: "My Day (his tablet)", icon: <MonitorSmartphone className="h-4 w-4" />, perm: "view.kiosk" },
    ],
  },
  {
    label: "Mum's care home)",
    tabs: [
      { id: "mum", label: "Mum's care", icon: <Building2 className="h-4 w-4" />, perm: "view.mum" },
    ],
  },
  {
    label: "Connect",
    tabs: [
      { id: "whatsapp", label: "WhatsApp & inbox", icon: <MessageSquareText className="h-4 w-4" />, perm: "view.whatsapp" },
      { id: "calls", label: "Calls & evidence", icon: <PhoneCall className="h-4 w-4" />, perm: "view.calls" },
      { id: "share", label: "Share with advisers", icon: <Link2 className="h-4 w-4" />, perm: "view.share" },
      { id: "aibrief", label: "AI review bridge", icon: <Sparkles className="h-4 w-4" />, perm: "view.aibrief" },
    ],
  },
  {
    label: "Intelligence",
    tabs: [
      { id: "familyvoice", label: "Family voice hub", icon: <HeartHandshake className="h-4 w-4" />, perm: "view.familyvoice" },
      { id: "dcpi", label: "Care index (DCPI)", icon: <Gauge className="h-4 w-4" />, perm: "view.dcpi" },
      { id: "recommendations", label: "Recommendations", icon: <Lightbulb className="h-4 w-4" />, perm: "view.recommendations" },
    ],
  },
  {
    label: "Oversight & assurance",
    tabs: [
      { id: "carehub", label: "Care Hub & legal", icon: <Gavel className="h-4 w-4" />, perm: "view.carehub" },
      { id: "alerts", label: "Alerts", icon: <Siren className="h-4 w-4" />, perm: "view.alerts" },
      { id: "audit", label: "Records audit", icon: <ShieldCheck className="h-4 w-4" />, perm: "view.records_audit" },
      { id: "social", label: "Social & comms", icon: <UsersRound className="h-4 w-4" />, perm: "view.social" },
      { id: "council", label: "Council ASC watch", icon: <Landmark className="h-4 w-4" />, perm: "view.council" },
      { id: "apicatalog", label: "API & data catalog", icon: <Database className="h-4 w-4" />, perm: "view.api_catalog" },
    ],
  },
  {
    label: "Workspace & tools",
    tabs: [
      { id: "assistant", label: "AI assistant", icon: <Bot className="h-4 w-4" />, perm: "view.ai" },
      { id: "downloads", label: "Downloads", icon: <Download className="h-4 w-4" />, perm: "view.downloads" },
      { id: "governance", label: "Access & audit", icon: <UserCog className="h-4 w-4" />, perm: "view.access_audit" },
      { id: "deploy", label: "Deploy & sync", icon: <Rocket className="h-4 w-4" />, perm: "view.deploy" },
    ],
  },
];

const ALL_TABS: TabPerm[] = TAB_GROUPS.flatMap((g) => g.tabs);

export default function Home() {
  const [record, setRecord] = useState<CareRecord | null>(null);
  const [docs, setDocs] = useState<DocInfo[] | null>(null);
  const [wellbeing, setWellbeing] = useState<WellbeingData | null>(null);
  const [analytics, setAnalytics] = useState<FlagsAnalytics | null>(null);
  const [conditions, setConditions] = useState<ConditionItem[] | null>(null);
  const [recs, setRecs] = useState<RecommendationItem[] | null>(null);
  const [sections, setSections] = useState<SectionsData | null>(null);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [catalog, setCatalog] = useState<ApiCatalogData | null>(null);
  const [mum, setJane] = useState<MumInfo | null>(null);
  const [callsData, setCallsData] = useState<CallsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("dashboard");
  const [watchKw, setWatchKw] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  // identity / governance
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [actorId, setActorId] = useState<string | null>(null);
  const actor = useMemo<SystemUser | null>(() => {
    if (users.length === 0) return null;
    if (actorId) {
      const u = users.find((x) => x.id === actorId);
      if (u) return u;
    }
    return effectiveUser(users);
  }, [users, actorId]);

  // alerting
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alertState, setAlertState] = useState<AlertState>({});

  // family hub stores
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [sheets, setSheets] = useState<VisitSheet[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [availability, setAvailability] = useState<AvailabilityStore | null>(null);
  const [mumContacts, setJaneContacts] = useState<MumContact[]>([]);
  const [mumWellbeing, setJaneWellbeing] = useState<MumWellbeingEntry[]>([]);
  const [waSettings, setWaSettings] = useState<WaSettings | null>(null);
  const [waMessages, setWaMessages] = useState<WaMessage[]>([]);
  const [waProcessed, setWaProcessed] = useState<Record<string, boolean>>({});
  const [emailRoute, setEmailRoute] = useState<EmailRouteSettings | null>(null);

  // batch-11 stores (tracker, medication reconciliation) — hydrated after mount
  const [tracker, setTracker] = useState<TrackerStore | null>(null);
  const [exits, setExits] = useState<TrackerExit[]>([]);
  const [medRecon, setMedRecon] = useState<MedReconStore>(defaultMedRecon());
  const [medExceptions, setMedExceptions] = useState<MedException[]>([]);

  const actorRef = useRef<SystemUser | null>(null);
  actorRef.current = actor;

  const auditEvent = useCallback(
    (action: SysAuditAction, target: string, detail: string, severity: "info" | "notice" | "warning" = "info") => {
      const a = actorRef.current;
      if (!a) return;
      logEvent({ actor: a.name, actorRole: ROLES[a.role].label, action, target, detail, severity });
    },
    []
  );

  useEffect(() => {
    setUsers(loadUsers());
    setRules(loadRules());
    setAlertState(loadAlertState());
    setTasks(loadTasks());
    setShopping(loadShopping());
    setSheets(loadSheets());
    setEvents(loadEvents());
    setAvailability(loadAvailability());
    setJaneContacts(loadJaneContacts());
    setJaneWellbeing(loadJaneWellbeing());
    setWaSettings(loadWaSettings());
    setWaMessages(loadWaCache());
    setWaProcessed(loadWaProcessed());
    setEmailRoute(loadEmailRoute());
    setTracker(loadTracker());
    setExits(loadExits());
    setMedRecon(loadMedRecon());
    setMedExceptions(loadMedExceptions());
  }, []);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("care-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paths = [
          "/data/record.json",
          "/data/documents.json",
          "/data/wellbeing.json",
          "/data/flags_analytics.json",
          "/data/conditions.json",
          "/data/recommendations.json",
          "/data/sections17_117.json",
          "/data/audit.json",
          "/data/api_catalog.json",
          "/data/mum.json",
          "/data/calls.json",
        ];
        const [r, d, w, fa, c, rec, sec, au, ac, jn, ca] = await Promise.all(paths.map((p) => fetch(p)));
        if (!r.ok || !d.ok) throw new Error("Failed to load record data");
        if (!cancelled) {
          setRecord(await r.json());
          setDocs(await d.json());
          if (w.ok) setWellbeing(await w.json());
          if (fa.ok) setAnalytics(await fa.json());
          if (c.ok) setConditions(await c.json());
          if (rec.ok) setRecs(await rec.json());
          if (sec.ok) setSections(await sec.json());
          if (au.ok) setAudit(await au.json());
          if (ac.ok) setCatalog(await ac.json());
          if (jn.ok) setJane(await jn.json());
          if (ca.ok) setCallsData(await ca.json());
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = (t: string, kw?: string) => {
    if (kw !== undefined) setWatchKw(kw);
    setTab(t);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const switchUser = (id: string) => {
    setCurrentUserId(id);
    setActorId(id);
    const u = users.find((x) => x.id === id);
    if (u && !can(u, (ALL_TABS.find((t) => t.id === tab)?.perm ?? "view.overview"))) {
      setTab("dashboard");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const changeUsers = (next: SystemUser[]) => {
    setUsers(next);
    saveUsers(next);
  };
  const changeRules = (next: AlertRule[]) => {
    setRules(next);
    saveRules(next);
  };
  const changeAlertState = (next: AlertState) => {
    setAlertState(next);
    saveAlertState(next);
  };

  // ----- family hub setters (persist + audit handled by components)
  const changeTasks = (next: MyTask[]) => {
    setTasks(next);
    saveTasks(next);
  };
  const changeShopping = (next: ShoppingItem[]) => {
    setShopping(next);
    saveShopping(next);
  };
  const changeSheets = (next: VisitSheet[]) => {
    setSheets(next);
    saveSheets(next);
  };
  const changeEvents = (next: CalEvent[]) => {
    setEvents(next);
    saveEvents(next);
  };
  const changeAvailability = (next: AvailabilityStore) => {
    setAvailability(next);
    saveAvailability(next);
  };
  const changeJaneContacts = (next: MumContact[]) => {
    setJaneContacts(next);
    saveJaneContacts(next);
  };
  const changeJaneWellbeing = (next: MumWellbeingEntry[]) => {
    setJaneWellbeing(next);
    saveJaneWellbeing(next);
  };
  const changeWaSettings = (next: WaSettings) => {
    setWaSettings(next);
    saveWaSettings(next);
  };
  const mergeWaMessages = useCallback((incoming: WaMessage[]) => {
    setWaMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) {
        map.set(m.id, { ...m, source: m.source ?? "poll" });
      }
      const merged = [...map.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 300);
      saveWaCache(merged);
      return merged;
    });
  }, []);
  const changeWaProcessed = (next: Record<string, boolean>) => {
    setWaProcessed(next);
    saveWaProcessed(next);
  };
  const changeEmailRoute = (next: EmailRouteSettings) => {
    setEmailRoute(next);
    saveEmailRoute(next);
  };

  const changeTracker = (next: TrackerStore) => {
    setTracker(next);
    saveTracker(next);
  };
  const changeExits = (next: TrackerExit[]) => {
    setExits(next);
    saveExits(next);
  };
  const changeMedRecon = (next: MedReconStore) => {
    setMedRecon(next);
    saveMedRecon(next);
  };
  const changeMedExceptions = (next: MedException[]) => {
    setMedExceptions(next);
    saveMedExceptions(next);
  };

  const logout = async () => {
    auditEvent("auth.logout", "portal session", `${actorRef.current?.name ?? "user"} signed out of the portal`);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.assign("/login");
  };

  const toggleTaskFromDashboard = (t: MyTask) => {
    if (!actorRef.current) return;
    const next = tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString().slice(0, 10) : undefined } : x));
    changeTasks(next);
    auditEvent(t.done ? "task.reopen" : "task.complete", t.title, `${t.done ? "re-opened" : "completed"} from the dashboard by ${actorRef.current.name}`, "notice");
  };

  const coverage = useMemo(() => {
    if (!record || record.hist.length === 0) return "";
    const first = record.hist[record.hist.length - 1]?.date;
    const last = record.hist[0]?.date;
    const opts = { day: "2-digit", month: "short", year: "numeric" } as const;
    return `${new Date(first + "T00:00:00").toLocaleDateString("en-GB", opts)} — ${new Date(
      last + "T00:00:00"
    ).toLocaleDateString("en-GB", opts)}`;
  }, [record]);

  const liveAlerts = useMemo(() => {
    if (!record || rules.length === 0) return [];
    return evaluateAlerts(record, wellbeing, rules, alertState, {
      tasks,
      mumContacts,
      contactDaily: callsData?.contactDaily,
      trackerExits: exits,
    });
  }, [record, wellbeing, rules, alertState, tasks, mumContacts, callsData, exits]);
  const newAlerts = liveAlerts.filter((a) => a.status !== "resolved" && a.status !== "ack");

  const visibleTabs = useMemo(
    () => (actor ? ALL_TABS.filter((t) => can(actor, t.perm)) : []),
    [actor]
  );

  const medRefusedPerWeek = useMemo(() => {
    if (!record) return undefined;
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    return record.med_events.filter((m) => m.date >= cutoff).length;
  }, [record]);

  const NavList = ({ onPick }: { onPick?: () => void }) => (
    <nav aria-label="Portal sections" className="space-y-4">
      {TAB_GROUPS.map((g) => {
        const tabs = g.tabs.filter((t) => visibleTabs.some((v) => v.id === t.id));
        if (tabs.length === 0) return null;
        return (
          <div key={g.label}>
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-teal-700/80 dark:text-teal-300/70">
              {g.label}
            </p>
            <div className="space-y-0.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { navigate(t.id); onPick?.(); }}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    tab === t.id
                      ? "bg-teal-800 font-semibold text-white shadow-sm dark:bg-teal-700"
                      : "text-teal-950 hover:bg-teal-100 dark:text-teal-100 dark:hover:bg-teal-900/40"
                  }`}
                >
                  <span className={tab === t.id ? "text-white" : "text-teal-700 dark:text-teal-400"}>{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-teal-50/40 px-6 text-center">
        <HeartPulse className="h-10 w-10 text-teal-700" />
        <h1 className="text-xl font-semibold text-teal-900">Family Care Hub</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The record data could not be loaded ({error}). Check that public/data/record.json exists
          and refresh the page.
        </p>
      </main>
    );
  }

  if (!record || !docs || !actor || !availability || !waSettings || !emailRoute || !tracker) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-teal-50/40 px-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-700" />
        <h1 className="text-xl font-semibold text-teal-900">Family Care Hub</h1>
        <p className="text-sm text-muted-foreground">Loading the family hub…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-teal-50/40 lg:flex-row">
      {/* ---------------- sidebar (desktop) ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-teal-100 bg-white/80 px-3 py-4 backdrop-blur lg:flex dark:border-teal-900 dark:bg-[#071a16]/80">
        <div className="mb-4 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-800">
            <HeartPulse className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold leading-tight text-teal-900 dark:text-teal-100">Family Care Hub</h1>
            <p className="truncate text-[10px] text-muted-foreground">Dad &amp; Mum first · {coverage}</p>
          </div>
        </div>
        <div className="flex-1">
          <NavList />
        </div>
        <p className="mt-4 px-2 text-[10px] leading-snug text-muted-foreground">
          Acting as <span className="font-semibold text-teal-800 dark:text-teal-300">{actor.name}</span> · every action is
          audit-logged · contains personal data.
        </p>
      </aside>

      {/* ---------------- main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="sticky top-0 z-20 border-b border-teal-100 bg-white/95 backdrop-blur dark:border-teal-900 dark:bg-[#071a16]/95">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <Button size="sm" variant="outline" className="lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="min-w-0 lg:hidden">
              <h1 className="truncate text-base font-bold leading-tight text-teal-900 dark:text-teal-100">Family Care Hub</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                Dad &amp; Mum first · acting as {actor.name}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {/* notification bell */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="relative"
                    aria-label={`Alerts: ${newAlerts.length} new`}
                  >
                    <Bell className="h-4 w-4" />
                    {newAlerts.length > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                        {newAlerts.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Siren className="h-4 w-4 text-teal-700" />
                      Alerts
                      {newAlerts.length > 0 && (
                        <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-800">
                          {newAlerts.length} new
                        </Badge>
                      )}
                    </p>
                    {liveAlerts.filter((a) => a.status !== "resolved").length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        All watch rules are quiet — nothing needs attention right now.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {liveAlerts
                          .filter((a) => a.status !== "resolved")
                          .slice(0, 5)
                          .map((a) => (
                            <button
                              key={a.key}
                              className="w-full rounded-lg border p-2 text-left text-xs hover:bg-teal-50 dark:hover:bg-teal-950/40"
                              onClick={() => navigate("alerts")}
                            >
                              <span className="font-medium">{a.label}</span>
                              <span className="block text-muted-foreground">{a.message}</span>
                              {a.status === "ack" && (
                                <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                                  acknowledged
                                </span>
                              )}
                            </button>
                          ))}
                        {liveAlerts.filter((a) => a.status !== "resolved").length > 5 && (
                          <p className="text-[11px] text-muted-foreground">
                            +{liveAlerts.filter((a) => a.status !== "resolved").length - 5} more
                          </p>
                        )}
                      </div>
                    )}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("alerts")}>
                      Open alerts centre
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                onClick={toggleTheme}
                size="sm"
                variant="outline"
                aria-label={dark ? "Switch to light mode" : "Switch to light mode"}
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">{dark ? "Light" : "Dark"}</span>
              </Button>
              {can(actor, "action.export") && (
                <Button
                  onClick={() => navigate("downloads")}
                  className="bg-teal-800 hover:bg-teal-700"
                  size="sm"
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  <span className="hidden sm:inline">Downloads &amp; AI bundle</span>
                  <span className="sm:hidden">Export</span>
                </Button>
              )}
              <Button
                onClick={logout}
                size="sm"
                variant="outline"
                aria-label="Sign out of the portal"
                title="Sign out (session cookie cleared on this device)"
              >
                <LogOut className="h-4 w-4" />
                <span className="ml-1.5 hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        {/* content */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6">
          <Tabs value={tab} onValueChange={setTab}>
            {/* ---------------- family hub ---------------- */}
            <TabsContent value="dashboard">
              <Dashboard
                record={record}
                wellbeing={wellbeing}
                mum={mum}
                tasks={tasks}
                shopping={shopping}
                mumContacts={mumContacts}
                mumWellbeing={mumWellbeing}
                events={events}
                waMessages={waMessages}
                waProcessed={waProcessed}
                liveAlerts={liveAlerts}
                actor={actor}
                onNavigate={navigate}
                onToggleTask={toggleTaskFromDashboard}
              />
            </TabsContent>
            <TabsContent value="mytasks">
              <MyTasks
                record={record}
                actor={actor}
                tasks={tasks}
                onTasksChange={changeTasks}
                shopping={shopping}
                onShoppingChange={changeShopping}
                sheets={sheets}
                onSheetsChange={changeSheets}
                onAudit={auditEvent}
              />
            </TabsContent>
            <TabsContent value="calendar">
              <MyCalendar
                record={record}
                actor={actor}
                tasks={tasks}
                events={events}
                onEventsChange={changeEvents}
                proposals={availability.proposals}
                mumContacts={mumContacts}
                onAudit={auditEvent}
              />
            </TabsContent>
            <TabsContent value="lpa">
              <Lpa
                actor={actor}
                availability={availability}
                onAvailabilityChange={changeAvailability}
                onAudit={auditEvent}
              />
            </TabsContent>
            <TabsContent value="life360">
              <Life360Panel
                actorName={actor.name}
                tracker={tracker}
                onTrackerChange={changeTracker}
                exits={exits}
                onExitsChange={changeExits}
                onAudit={auditEvent}
              />
            </TabsContent>

            {/* ---------------- dad's care record ---------------- */}
            <TabsContent value="overview">
              <Overview record={record} />
            </TabsContent>
            <TabsContent value="visits">
              <Visits record={record} />
            </TabsContent>
            <TabsContent value="medication">
              <Medication record={record} />
              <div className="mt-6">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Reconciliation &amp; governance (Systems Review P2)
                </h2>
                <MedRecon
                  store={medRecon}
                  onStoreChange={changeMedRecon}
                  exceptions={medExceptions}
                  onExceptionsChange={changeMedExceptions}
                  freeTextHits={record.med_events
                    .filter((e) => /no medication|blister|duplicate|split/i.test(e.comments || ""))
                    .map((e) => ({ date: e.date, comments: e.comments }))}
                  onAudit={auditEvent}
                />
              </div>
            </TabsContent>
            <TabsContent value="watchlist">
              {analytics ? (
                <Watchlist record={record} analytics={analytics} initialKw={watchKw} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading flag analytics…</p>
              )}
            </TabsContent>
            <TabsContent value="wellbeing">
              {wellbeing ? (
                <Wellbeing data={wellbeing} onNavigate={navigate} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading well-being analytics…</p>
              )}
            </TabsContent>
            <TabsContent value="conditions">
              {conditions && sections ? (
                <Conditions conditions={conditions} sections={sections} onNavigate={navigate} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading conditions…</p>
              )}
            </TabsContent>
            <TabsContent value="schedule">
              <Schedule record={record} showContacts={can(actor, "data.contacts")} />
            </TabsContent>
            <TabsContent value="documents">
              <Documents docs={docs} />
            </TabsContent>
            <TabsContent value="kiosk">
              <div className="rounded-xl border bg-gradient-to-br from-teal-900 to-[#0B1B26] p-6 text-white shadow-lg">
                <h2 className="flex items-center gap-2 text-lg font-bold"><MonitorSmartphone className="h-5 w-5 text-teal-300" /> &quot;My Day&quot; — Dad&apos;s own tablet view</h2>
                <p className="mt-2 max-w-2xl text-sm text-teal-100/90">
                  A dementia-friendly kiosk for Dad: today&apos;s visits with huge icons, tap-to-choose boards for dinner,
                  drinks, outfit and activities, the family photo wall, calming anchors, and one giant call button. His
                  choices flow straight back into this portal (and the audit trail) as &quot;My Day choice received&quot;.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href="/kiosk" target="_blank" rel="noreferrer">
                    <Button className="bg-white text-teal-900 hover:bg-teal-50">
                      Open My Day view <span aria-hidden> →</span>
                    </Button>
                  </a>
                  <p className="self-center text-xs text-teal-200/80">
                    Best on the wall-mounted tablet · full-screen · offline-friendly shell planned for the Cloudflare build.
                  </p>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-teal-100/80 sm:grid-cols-3">
                  <p className="rounded-lg bg-white/10 p-2.5">7:1 contrast core flows · ~200% type · no dead-ends (WCAG 2.2 AA posture)</p>
                  <p className="rounded-lg bg-white/10 p-2.5">Choices are never wrong — exploring is safe by design</p>
                  <p className="rounded-lg bg-white/10 p-2.5">Carers see the same board notes in the visit briefing</p>
                </div>
              </div>
            </TabsContent>

            {/* ---------------- mum ---------------- */}
            <TabsContent value="mum">
              <MumCare
                actor={actor}
                mum={mum}
                contacts={mumContacts}
                onContactsChange={changeJaneContacts}
                wellbeing={mumWellbeing}
                onWellbeingChange={changeJaneWellbeing}
                onAudit={auditEvent}
              />
            </TabsContent>

            {/* ---------------- connect ---------------- */}
            <TabsContent value="whatsapp">
              <WhatsAppHub
                actor={actor}
                settings={waSettings}
                onSettingsChange={changeWaSettings}
                messages={waMessages}
                onMessagesChange={mergeWaMessages}
                waProcessed={waProcessed}
                onWaProcessedChange={changeWaProcessed}
                shopping={shopping}
                onShoppingChange={changeShopping}
                tasks={tasks}
                onTasksChange={changeTasks}
                onEventsAdd={(e) => changeEvents([e as CalEvent, ...events])}
                onAudit={auditEvent}
                emailRoute={emailRoute}
                onEmailRouteChange={changeEmailRoute}
              />
            </TabsContent>
            <TabsContent value="share">
              <Share actorName={actor.name} onAudit={auditEvent} />
            </TabsContent>
            <TabsContent value="calls">
              {callsData ? (
                <Calls data={callsData} actorName={actor.name} onAudit={auditEvent} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading the calls log…</p>
              )}
            </TabsContent>
            <TabsContent value="aibrief">
              <AiBrief
                record={record}
                tasks={tasks}
                shopping={shopping}
                mumContacts={mumContacts}
                mumWellbeing={mumWellbeing}
                actorName={actor.name}
                onTasksChange={changeTasks}
                onShoppingChange={changeShopping}
                onAudit={auditEvent}
              />
            </TabsContent>

            {/* ---------------- intelligence ---------------- */}
            <TabsContent value="familyvoice">
              <FamilyVoice actorName={actor.name} onAudit={auditEvent} />
            </TabsContent>
            <TabsContent value="dcpi">
              <DcpiPanel actorName={actor.name} onAudit={auditEvent} medRefusedPerWeek={medRefusedPerWeek} />
            </TabsContent>
            <TabsContent value="recommendations">
              {recs ? (
                <Recommendations recs={recs} onNavigate={navigate} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading recommendations…</p>
              )}
            </TabsContent>

            {/* ---------------- oversight & assurance ---------------- */}
            <TabsContent value="carehub">
              <CareHub
                actorName={actor.name}
                canManage={can(actor, "action.legal_manage")}
                clientName={record.client.name}
                clientDob={record.client.dob}
                onAudit={auditEvent}
                onNavigate={navigate}
              />
            </TabsContent>
            <TabsContent value="alerts">
              <AlertsCentre
                record={record}
                wellbeing={wellbeing}
                actor={actor}
                onNavigate={navigate}
                rules={rules}
                onRulesChange={changeRules}
                alertState={alertState}
                onAlertStateChange={changeAlertState}
                alertExtra={{ tasks, mumContacts }}
              />
            </TabsContent>
            <TabsContent value="audit">
              <Audit audit={audit} onNavigate={navigate} />
            </TabsContent>
            <TabsContent value="social">
              <Social
                record={record}
                audit={audit}
                onNavigate={navigate}
                showContacts={can(actor, "data.contacts")}
                canEditComms={can(actor, "action.comms_edit")}
                onAudit={auditEvent}
              />
            </TabsContent>
            <TabsContent value="council">
              <Council record={record} docs={docs} mumContacts={mumContacts} onAudit={auditEvent} />
            </TabsContent>
            <TabsContent value="apicatalog">
              <ApiCatalog catalog={catalog} />
            </TabsContent>

            {/* ---------------- workspace & tools ---------------- */}
            <TabsContent value="assistant">
              <Assistant record={record} audit={audit} recs={recs} onAudit={auditEvent} />
            </TabsContent>
            <TabsContent value="downloads">
              <Downloads docs={docs} canExport={can(actor, "action.export")} onAudit={auditEvent} />
            </TabsContent>
            <TabsContent value="governance">
              <Governance
                actor={actor}
                users={users}
                onSwitchUser={switchUser}
                onUsersChange={changeUsers}
              />
            </TabsContent>
            <TabsContent value="deploy">
              <Deploy actorName={actor.name} onAudit={auditEvent} />
            </TabsContent>
          </Tabs>
        </main>

        {/* sticky footer */}
        <footer className="mt-auto border-t border-teal-100 bg-white/80 dark:border-teal-900 dark:bg-[#071a16]/80">
          <div className="mx-auto max-w-6xl px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
            Family care hub for Dad — the care agency, the care portal portal export) and Mum —
            Mum's care home, email/phone protocol) · the well-being of both parents and your convenience and control as
            family lead shape every layout decision here · contains personal data — handle with care.
          </div>
        </footer>
      </div>

      {/* ---------------- mobile nav sheet ---------------- */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto bg-white p-4 dark:bg-[#071a16]">
          <SheetTitle className="sr-only">Portal navigation</SheetTitle>
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-bold text-teal-900 dark:text-teal-100">
              <HeartPulse className="h-4 w-4 text-teal-700" /> Family Care Hub
            </p>
            <Button size="icon" variant="ghost" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <NavList />
        </SheetContent>
      </Sheet>
    </div>
  );
}
