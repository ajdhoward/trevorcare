"use client";

// Family calendar — month grid combining every source: Dad's rota visits,
// my task due-dates, joint commitments with Pat, Mum's care cadence,
// WhatsApp-suggested appointments and manual family events. Day click shows
// the agenda; export downloads a real .ics for phone sync.

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { CareRecord } from "@/lib/record";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import type { SysAuditAction } from "@/lib/auditlog";
import {
  type MyTask, type CalEvent, type TaskFor, type JointProposal,
  type MumContact, SOURCE_META, buildIcs, todayStr, uid, type EventSource,
} from "@/lib/family";
import { fmtDate } from "@/lib/record";

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface CalRow {
  id: string;
  date: string;
  time?: string;
  title: string;
  source: EventSource;
  who: TaskFor;
  details?: string;
}

export default function MyCalendar({
  record, actor, tasks, events, onEventsChange, proposals, mumContacts, onAudit,
}: {
  record: CareRecord;
  actor: SystemUser;
  tasks: MyTask[];
  events: CalEvent[];
  onEventsChange: (e: CalEvent[]) => void;
  proposals: JointProposal[];
  mumContacts: MumContact[];
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const today = todayStr();
  const canManage = can(actor, "action.task_manage");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [hidden, setHidden] = useState<Record<EventSource, boolean>>({
    task: false, joint: false, mum: false, visit: false, whatsapp: false, manual: false,
  });
  const [manual, setManual] = useState<{ title: string; date: string; time: string; who: TaskFor }>({
    title: "", date: today, time: "", who: "family",
  });

  // ---------- build all rows
  const rows = useMemo<CalRow[]>(() => {
    const out: CalRow[] = [];
    for (const t of tasks) {
      if (t.done) continue;
      out.push({
        id: `task-${t.id}`, date: t.due,
        title: t.title, source: "task", who: t.forWhom,
        details: `${t.assignee === "either" ? "either attorney" : t.assignee}`,
      });
    }
    for (const e of events) {
      out.push({ id: `ev-${e.id}`, date: e.date, time: e.time, title: e.title, source: e.source, who: e.who, details: e.details });
    }
    for (const p of proposals.filter((x) => x.status !== "declined")) {
      out.push({
        id: `prop-${p.id}`, date: p.date,
        title: `Joint slot — ${p.purpose}`, source: "joint", who: "both",
        details: `proposed by ${p.proposedBy} · ${p.status}`,
      });
    }
    for (const c of mumContacts.filter((c) => c.followUp && c.followUpBy)) {
      out.push({ id: `jc-${c.id}`, date: c.followUpBy!, title: `Follow up Mum's care: ${c.who || "Mum's care home"}`, source: "mum", who: "mum", details: c.summary });
    }
    for (const u of record.upcoming) {
      out.push({ id: `uv-${u.date}-${u.times}-${u.carer}`, date: u.date, time: u.times.split("–")[0]?.trim(), title: `Dad's visit — ${u.carer}`, source: "visit", who: "dad", details: u.times });
    }
    return out;
  }, [tasks, events, proposals, mumContacts, record.upcoming]);

  const visible = rows.filter((r) => !hidden[r.source]);

  // ---------- month grid
  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
    const cellsArr: { iso: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) cellsArr.push({ iso: null });
    for (let d = 1; d <= daysInMonth; d++) cellsArr.push({ iso: iso(new Date(month.y, month.m, d)) });
    while (cellsArr.length % 7 !== 0) cellsArr.push({ iso: null });
    return cellsArr;
  }, [month]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalRow[]>();
    for (const r of visible) {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date)!.push(r);
    }
    return m;
  }, [visible]);

  const monthLabelStr = new Date(month.y, month.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const shiftMonth = (n: number) => {
    const d = new Date(month.y, month.m + n, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };

  const agenda = (visible.filter((r) => r.date === selected) ?? []).sort(
    (a, b) => (a.time || "").localeCompare(b.time || "")
  );

  const addManual = () => {
    if (!manual.title.trim() || !canManage) return;
    const e: CalEvent = {
      id: uid("e"), date: manual.date, time: manual.time || undefined,
      title: manual.title.trim(), source: "manual", who: manual.who,
    };
    onEventsChange([e, ...events]);
    onAudit("cal.event.add", e.title, `${e.date}${e.time ? " " + e.time : ""} added by ${actor.name}`);
    setManual({ ...manual, title: "", time: "" });
  };
  const deleteEvent = (row: CalRow) => {
    if (!row.id.startsWith("ev-") || !canManage) return;
    const id = row.id.slice(3);
    onEventsChange(events.filter((e) => e.id !== id));
    onAudit("cal.event.delete", row.title, `removed by ${actor.name}`, "warning");
  };

  const exportIcs = () => {
    const ics = buildIcs(
      visible.map((r) => ({ id: r.id.replace(/[^a-z0-9-]/gi, "-"), date: r.date, time: r.time, title: r.title, source: r.source, who: r.who, details: r.details }))
    );
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "family-family-care.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* filters + export */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show:</span>
          {(Object.keys(SOURCE_META) as EventSource[]).map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Checkbox
                checked={!hidden[s]}
                onCheckedChange={(v) => setHidden({ ...hidden, [s]: v !== true })}
                aria-label={`Toggle ${SOURCE_META[s].label}`}
              />
              <span className={`inline-block h-2 w-2 rounded-full ${SOURCE_META[s].dot}`} />
              {SOURCE_META[s].label}
            </label>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" onClick={exportIcs}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Download .ics
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        {/* month grid */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <CalendarDays className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              {monthLabelStr}
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() }); setSelected(today); }}>
                  Today
                </Button>
                <Button size="sm" variant="outline" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
              {DAY_HEADERS.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((c, i) => {
                if (!c.iso) return <div key={i} className="min-h-16 rounded-md bg-muted/30 sm:min-h-20" />;
                const list = byDate.get(c.iso) ?? [];
                const isToday = c.iso === today;
                const isSel = c.iso === selected;
                return (
                  <button
                    key={c.iso}
                    onClick={() => setSelected(c.iso!)}
                    aria-label={`Day ${c.iso}, ${list.length} items`}
                    className={`min-h-16 rounded-md border p-1 text-left align-top transition-colors sm:min-h-20 ${
                      isSel ? "border-teal-600 ring-1 ring-teal-600" : "hover:border-teal-300"
                    } ${isToday ? "bg-teal-50/70 dark:bg-teal-950/30" : ""}`}
                  >
                    <span className={`text-[11px] font-bold ${isToday ? "text-teal-800 dark:text-teal-300" : "text-muted-foreground"}`}>
                      {Number(c.iso.slice(8))}
                    </span>
                    <span className="mt-0.5 space-y-0.5">
                      {list.slice(0, 3).map((r) => (
                        <span key={r.id} className={`block truncate rounded px-1 text-[10px] leading-tight ${SOURCE_META[r.source].chip} border`}>
                          {r.title}
                        </span>
                      ))}
                      {list.length > 3 && <span className="block text-[10px] text-muted-foreground">+{list.length - 3} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* agenda + add */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-teal-900 dark:text-teal-200">{fmtDate(selected)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {agenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled for this day.</p>
              ) : (
                agenda.map((r) => (
                  <div key={r.id} className="rounded-md border px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${SOURCE_META[r.source].chip} rounded border px-1.5 py-0.5`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_META[r.source].dot}`} />
                        {SOURCE_META[r.source].label}
                      </span>
                      {r.time && <span className="text-xs text-muted-foreground">{r.time}</span>}
                      {canManage && rowDeletable(r) && (
                        <Button size="sm" variant="ghost" aria-label="Remove event" onClick={() => deleteEvent(r)}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium">{r.title}</p>
                    {r.details && <p className="text-xs text-muted-foreground">{r.details}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {canManage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-teal-900 dark:text-teal-200">
                  <Plus className="mr-1 inline h-4 w-4 text-teal-700" /> Add family event
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="ev-title">Title</Label>
                  <Input id="ev-title" placeholder="e.g. Visit to Mum / pay fees" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="ev-date">Date</Label>
                    <Input id="ev-date" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ev-time">Time (optional)</Label>
                    <Input id="ev-time" type="time" value={manual.time} onChange={(e) => setManual({ ...manual, time: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Who&apos;s it for</Label>
                  <Select value={manual.who} onValueChange={(v) => setManual({ ...manual, who: v as TaskFor })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="family">Family / admin</SelectItem>
                      <SelectItem value="dad">Dad</SelectItem>
                      <SelectItem value="mum">Mum</SelectItem>
                      <SelectItem value="both">Both parents</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" className="w-full bg-teal-800 hover:bg-teal-700" disabled={!manual.title.trim()} onClick={addManual}>
                  Add to calendar
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-3 text-xs text-muted-foreground">
              <Badge variant="outline" className="mb-1.5">Phone sync</Badge>
              <p>
                “Download .ics” gives you a real calendar file with everything currently shown — open it on your
                phone to add the family care calendar alongside your own. Task due-dates and joint commitments are
                included automatically.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function rowDeletable(r: CalRow): boolean {
  return r.id.startsWith("ev-");
}
