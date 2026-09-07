"use client";

// Family command centre — the landing tab. Built around the family member:
// both parents at a glance, my responsibilities next, then the feeds
// (shopping, WhatsApp, alerts). Everything deep-links into its tab.

import { useMemo } from "react";
import {
  Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, HeartPulse,
  ListChecks, Mail, MessageSquareText, Phone, Plus, ShoppingBasket, Users, ClipboardList,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { CareRecord, WellbeingData } from "@/lib/record";
import { fmtDate, fmtDateRange } from "@/lib/record";
import type { FiringAlert } from "@/lib/alerts";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import {
  type MyTask, type ShoppingItem, type MumContact, type MumWellbeingEntry,
  type CalEvent, type WaMessage, type MumInfo,
  taskBucket, daysBetween, todayStr, TASK_FOR_LABELS,
} from "@/lib/family";

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
  return Math.max(0, diff);
}

export default function Dashboard({
  record, wellbeing, mum, tasks, shopping, mumContacts, mumWellbeing, events,
  waMessages, waProcessed, liveAlerts, actor, onNavigate, onToggleTask,
}: {
  record: CareRecord;
  wellbeing: WellbeingData | null;
  mum: MumInfo | null;
  tasks: MyTask[];
  shopping: ShoppingItem[];
  mumContacts: MumContact[];
  mumWellbeing: MumWellbeingEntry[];
  events: CalEvent[];
  waMessages: WaMessage[];
  waProcessed: Record<string, boolean>;
  liveAlerts: FiringAlert[];
  actor: SystemUser;
  onNavigate: (tab: string) => void;
  onToggleTask: (t: MyTask) => void;
}) {
  const today = todayStr();
  const canTasks = can(actor, "action.task_manage");
  const canJane = can(actor, "view.mum");

  // ----- dad (from the record)
  const todaysVisits = record.upcoming.filter((u) => u.date === today);
  const weekVisits = record.upcoming.filter((u) => u.date >= today && u.date <= addIsoDays(today, 7));
  const last7 = record.med_daily.filter((d) => d.date <= today).slice(0, 7).filter((d) => d.total > 0 && d.cancelled < 2);
  const adherence7 = last7.length
    ? Math.round(last7.reduce((a, d) => a + (d.given / d.total) * 100, 0) / last7.length)
    : null;
  const latestFlag = record.flags[0];

  // ----- mum (from family stores)
  const lastContact = [...mumContacts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const gapDays = daysSince(lastContact?.date);
  const lastWb = [...mumWellbeing].sort((a, b) => b.date.localeCompare(a.date))[0];
  const mumTasksOpen = tasks.filter((t) => !t.done && (t.forWhom === "mum" || t.forWhom === "both"));

  // ----- my responsibilities (7 days)
  const myNext = tasks
    .filter((t) => !t.done && t.due <= addIsoDays(today, 7))
    .slice()
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 6);
  const myEventsNext = events
    .filter((e) => e.date >= today && e.date <= addIsoDays(today, 7))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""))
    .slice(0, 6);
  const overdueCount = tasks.filter((t) => taskBucket(t, today) === "overdue").length;

  // ----- feeds
  const shoppingNeeded = shopping.filter((s) => s.needed);
  const unprocessedWa = waMessages.filter((m) => m.source !== "email" && !waProcessed[m.id]);
  const liveNonResolved = liveAlerts.filter((a) => a.status !== "resolved");

  const quickActions: { label: string; icon: React.ReactNode; tab: string; perm?: boolean }[] = [
    { label: "Add a task", icon: <Plus className="h-4 w-4" />, tab: "mytasks", perm: canTasks },
    { label: "Shopping list", icon: <ShoppingBasket className="h-4 w-4" />, tab: "mytasks" },
    { label: "Log contact with Mum", icon: <Phone className="h-4 w-4" />, tab: "mum", perm: canJane },
    { label: "Joint slot with Pat", icon: <Users className="h-4 w-4" />, tab: "lpa" },
    { label: "WhatsApp groups", icon: <MessageSquareText className="h-4 w-4" />, tab: "whatsapp" },
    { label: "Draft an email", icon: <Mail className="h-4 w-4" />, tab: "assistant" },
  ];

  return (
    <div className="space-y-4">
      {/* greeting strip */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-teal-900 dark:text-teal-200">
            Good {greetingTime()}, {actor.name.split(" ")[0]}
          </h2>
          <p className="text-sm text-muted-foreground">
            {fmtDateRange(today)} · everything for both parents and your responsibilities, in one place.
          </p>
        </div>
        {overdueCount > 0 && (
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            <AlertTriangle className="mr-1 h-3 w-3" /> {overdueCount} task{overdueCount === 1 ? "" : "s"} overdue
          </Badge>
        )}
      </div>

      {/* parents */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-teal-200 dark:border-teal-900">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <HeartPulse className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Dad
              <Badge variant="outline" className="ml-auto border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200">
                at home · the care agency
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Well-being" value={wellbeing ? `${Math.round(wellbeing.current.score)}` : "—"} sub={wellbeing?.current.band.label ?? ""} />
              <Metric label="Meds (7d)" value={adherence7 !== null ? `${adherence7}%` : "—"} sub="adherence" />
              <Metric label="Visits today" value={String(todaysVisits.length)} sub={`${weekVisits.length} this week`} />
            </div>
            <Separator />
            <div className="space-y-1.5 text-sm">
              {todaysVisits.length === 0 ? (
                <p className="text-muted-foreground">No upcoming visits shown in the rota for today — the schedule tab has the weekly package.</p>
              ) : (
                todaysVisits.slice(0, 3).map((v, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                    <span className="font-medium">{v.times}</span>
                    <span className="text-muted-foreground">{v.carer}</span>
                  </div>
                ))
              )}
            </div>
            {latestFlag && (
              <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-semibold">Latest watch note ({fmtDate(latestFlag.date)}):</span> “{latestFlag.notes.slice(0, 130)}…”
              </p>
            )}
            <Button size="sm" variant="outline" className="w-full" onClick={() => onNavigate("overview")}>
              Open Dad&apos;s full record <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        {canJane ? (
          <Card className="border-violet-200 dark:border-violet-900">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
                <HeartPulse className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                Mum
                <Badge variant="outline" className="ml-auto border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
                  Mum's care home
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Well-being" value={lastWb ? `${lastWb.score}/5` : "—"} sub={lastWb ? fmtDate(lastWb.date) : "no entries yet"} />
                <Metric
                  label="Last contact"
                  value={gapDays !== null ? `${gapDays}d` : "—"}
                  sub={lastContact ? lastContact.type : "log the first"}
                />
                <Metric label="Open tasks" value={String(mumTasksOpen.length)} sub="for Mum's care" />
              </div>
              <Separator />
              <div className="rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
                <p className="font-semibold">Email + phone protocol</p>
                <p className="mt-0.5">
                  {mum?.profile.monitoringModel ??
                    "No portal at the home — weekly call, monthly email, quarterly care-plan review; everything logged here."}
                </p>
                {gapDays !== null && gapDays > 7 && (
                  <p className="mt-1 font-medium">Cadence gap: {gapDays} days since the last logged contact — the alert engine has flagged this too.</p>
                )}
              </div>
              <Button size="sm" variant="outline" className="w-full" onClick={() => onNavigate("mum")}>
                Open Mum&apos;s care hub <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              Mum&apos;s care information is hidden for your role (data minimisation — managed in Access &amp; audit).
            </CardContent>
          </Card>
        )}
      </div>

      {/* responsibilities */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <ListChecks className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              My responsibilities · next 7 days
              {overdueCount > 0 && (
                <Badge variant="outline" className="ml-auto border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                  {overdueCount} overdue
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {myNext.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due in the next seven days — add tasks from the quick actions below.</p>
            ) : (
              myNext.map((t) => (
                <div key={t.id} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5">
                  {canTasks && (
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Complete: ${t.title}`}
                      onCheckedChange={() => onToggleTask(t)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(t.due)} · {TASK_FOR_LABELS[t.forWhom]} · {t.assignee === "either" ? "either attorney" : t.assignee === "alex" ? "Alex" : "Pat"}
                    </p>
                  </div>
                  {t.due < today && (
                    <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                      overdue
                    </Badge>
                  )}
                </div>
              ))
            )}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onNavigate("mytasks")}>
              All tasks & shopping list <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <CalendarClock className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Calendar · next 7 days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {myEventsNext.length === 0 ? (
              <p className="text-sm text-muted-foreground">No family events or joint slots this week yet.</p>
            ) : (
              myEventsNext.map((e) => (
                <div key={e.id} className="rounded-md border px-2.5 py-1.5 text-sm">
                  <span className="font-medium">{fmtDate(e.date)}{e.time ? ` · ${e.time}` : ""}</span>
                  <span className="block text-xs text-muted-foreground">{e.title}</span>
                </div>
              ))
            )}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onNavigate("calendar")}>
              Open the family calendar <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* feeds */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <ShoppingBasket className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Shopping list
              {shoppingNeeded.length > 0 && (
                <Badge variant="outline" className="ml-auto">{shoppingNeeded.length} needed</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {shoppingNeeded.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing needed right now. Carer visit sheets and the WhatsApp group add items here automatically.</p>
            ) : (
              shoppingNeeded.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{s.name}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">via {s.addedVia.replace("_", " ")}</span>
                </div>
              ))
            )}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onNavigate("mytasks")}>
              Manage list <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <MessageSquareText className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              WhatsApp
              {unprocessedWa.length > 0 && (
                <Badge variant="outline" className="ml-auto border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                  {unprocessedWa.length} new
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {unprocessedWa.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No new group messages. Connect Dad&apos;s existing group (and Mum&apos;s new one) in the WhatsApp tab — messages then feed the shopping list, tasks and review flags.
              </p>
            ) : (
              unprocessedWa.slice(0, 3).map((m) => (
                <div key={m.id} className="rounded-md border px-2.5 py-1.5 text-sm">
                  <p className="text-xs text-muted-foreground">{m.sender} · {fmtDate(m.ts.slice(0, 10))}</p>
                  <p className="line-clamp-2 text-xs">{m.body}</p>
                </div>
              ))
            )}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onNavigate("whatsapp")}>
              Open WhatsApp hub <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <AlertTriangle className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Alerts
              {liveNonResolved.length > 0 && (
                <Badge variant="outline" className="ml-auto border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                  {liveNonResolved.length} live
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {liveNonResolved.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> All watch rules quiet.
              </p>
            ) : (
              liveNonResolved.slice(0, 3).map((a) => (
                <button
                  key={a.key}
                  className="w-full rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
                  onClick={() => onNavigate("alerts")}
                >
                  <span className="font-medium">{a.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.message}</span>
                </button>
              ))
            )}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => onNavigate("alerts")}>
              Alerts centre <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* quick actions */}
      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <span className="mr-1 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="mr-1 h-3.5 w-3.5" /> Quick actions
          </span>
          {quickActions.filter((q) => q.perm !== false).map((q) => (
            <Button key={q.label} size="sm" variant="outline" onClick={() => onNavigate(q.tab)}>
              {q.icon} {q.label}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold leading-tight text-teal-900 dark:text-teal-200">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function greetingTime(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function addIsoDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
