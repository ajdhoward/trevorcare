"use client";

// LPA & joint availability — everything the two attorneys (Alex + Pat)
// need to have in place for financial and health/welfare duties, plus the
// convenience tool: Pat links her calendar (ICS), the engine suggests
// days both are free, and one click proposes/confirm a joint slot.

import { useMemo, useState } from "react";
import {
  CalendarCheck2, CheckSquare, Coins, ExternalLink, Heart, Link2, Loader2,
  RefreshCw, Send, Square, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import type { SysAuditAction } from "@/lib/auditlog";
import {
  type AvailabilityStore, type JointProposal, type SlotKey,
  SLOTS, suggestJointSlots, day3, fmtShortDate, loadLpaChecks, saveLpaChecks,
  uid, todayStr,
} from "@/lib/family";
import {
  LPA_ITEMS, LPA_ASSIGNEE_LABELS, type LpaAssignee,
} from "@/lib/lpa";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PURPOSES = [
  "Visit Dad together",
  "Visit Mum at Mum's care home",
  "LPA — financial task (fees/bank)",
  "Care-plan review meeting",
  "GP / medication review",
];

export default function Lpa({
  actor, availability, onAvailabilityChange, onAudit,
}: {
  actor: SystemUser;
  availability: AvailabilityStore;
  onAvailabilityChange: (a: AvailabilityStore) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const canAvail = can(actor, "action.availability");
  const today = todayStr();

  // ---------------- checklists
  const [checks, setChecks] = useState<Record<string, { done: boolean; assignee: LpaAssignee }>>(() => loadLpaChecks());
  const setCheck = (id: string, patch: Partial<{ done: boolean; assignee: LpaAssignee }>) => {
    const next = { ...checks, [id]: { done: checks[id]?.done ?? false, assignee: checks[id]?.assignee ?? LPA_ITEMS.find((i) => i.id === id)?.assignee ?? "shared", ...patch } };
    setChecks(next);
    saveLpaChecks(next);
    const item = LPA_ITEMS.find((i) => i.id === id);
    if (item) onAudit("lpa.item.toggle", item.text.slice(0, 60), patch.assignee ? `assignee → ${LPA_ASSIGNEE_LABELS[patch.assignee]}` : `marked ${next[id].done ? "done" : "not done"} by ${actor.name}`);
  };
  const finDone = LPA_ITEMS.filter((i) => i.area === "financial" && checks[i.id]?.done).length;
  const heaDone = LPA_ITEMS.filter((i) => i.area === "health" && checks[i.id]?.done).length;
  const finTotal = LPA_ITEMS.filter((i) => i.area === "financial").length;
  const heaTotal = LPA_ITEMS.filter((i) => i.area === "health").length;

  // ---------------- availability editing
  const setWeekly = (who: "alex" | "pat", day: string, slot: SlotKey, on: boolean) => {
    if (!canAvail) return;
    const prof = { ...availability[who] };
    const cur = prof.weekly[day] ?? [];
    const next = on ? [...cur, slot] : cur.filter((s) => s !== slot);
    prof.weekly = { ...prof.weekly, [day]: next };
    prof.updatedAt = today;
    onAvailabilityChange({ ...availability, [who]: prof });
    onAudit("avail.update", `${prof.name} · ${day} ${slot}`, `availability updated by ${actor.name}`);
  };

  // ---------------- ICS link
  const [icsUrl, setIcsUrl] = useState(availability.pat.icsUrl ?? "");
  const [icsBusy, setIcsBusy] = useState(false);
  const [icsMsg, setIcsMsg] = useState<string | null>(null);
  const linkIcs = async () => {
    if (!canAvail) return;
    setIcsBusy(true);
    setIcsMsg(null);
    try {
      const res = await fetch("/api/ics", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: icsUrl }),
      });
      const data = (await res.json()) as { ok?: boolean; busy?: { start: string; end: string; recurring: boolean }[]; count?: number; error?: string };
      if (!res.ok || !data.ok) {
        setIcsMsg(data.error || "Could not read that calendar.");
      } else {
        const dates = new Set<string>();
        for (const b of data.busy ?? []) {
          const s = new Date(b.start + "T00:00:00");
          const e = new Date(b.end + "T00:00:00");
          for (let d = s; d <= e && dates.size < 400; d.setDate(d.getDate() + 1)) {
            dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          }
        }
        const pat = { ...availability.pat, icsUrl, icsBusyDates: [...dates], icsEventCount: data.count, icsFetchedAt: today, updatedAt: today };
        onAvailabilityChange({ ...availability, pat });
        setIcsMsg(`Linked — ${data.count} calendar event(s) found; ${dates.size} busy day(s) will be avoided.`);
        onAudit("avail.ics", "Pat calendar", `ICS linked: ${data.count} events, ${dates.size} busy days`, "notice");
      }
    } catch (e) {
      setIcsMsg(String(e));
    } finally {
      setIcsBusy(false);
    }
  };

  // ---------------- suggestions + proposals
  const suggestions = useMemo(() => suggestJointSlots(availability, 4).slice(0, 12), [availability]);
  const confirmed = availability.proposals.filter((p) => p.status === "confirmed");
  const proposed = availability.proposals.filter((p) => p.status === "proposed");

  const propose = (date: string, slot: SlotKey, purpose: string) => {
    if (!canAvail) return;
    const p: JointProposal = {
      id: uid("p"), date, slot, purpose, proposedBy: actor.name.split(" ")[0],
      proposedAt: today, status: "proposed",
    };
    onAvailabilityChange({ ...availability, proposals: [p, ...availability.proposals] });
    onAudit("joint.propose", `${date} ${slot} — ${purpose}`, `proposed by ${p.proposedBy} — message ready to send to Pat`, "notice");
  };
  const setStatus = (p: JointProposal, status: JointProposal["status"]) => {
    if (!canAvail) return;
    const proposals = availability.proposals.map((x) => (x.id === p.id ? { ...x, status } : x));
    onAvailabilityChange({ ...availability, proposals });
    onAudit(status === "confirmed" ? "joint.confirm" : "joint.propose", `${p.date} ${p.slot} — ${p.purpose}`, `${status} by ${actor.name}`, "notice");
  };

  const proposalText = (p: JointProposal) =>
    `Hi Pat — can we do "${p.purpose}" on ${fmtShortDate(p.date)} (${SLOTS.find((s) => s.k === p.slot)?.time})? Proposed from the family care hub — confirm there or just reply here. — ${p.proposedBy}`;

  const copyText = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <div className="space-y-4">
      {/* header note */}
      <Card className="border-teal-200 dark:border-teal-900">
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <Users className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          <span>
            <span className="font-semibold">Attorneys:</span> Alex &amp; Pat — both LPAs
            (property &amp; financial affairs + health &amp; welfare). Everything below is joint by design.
          </span>
          <Badge variant="outline" className="ml-auto">{confirmed.length} confirmed joint slot{confirmed.length === 1 ? "" : "s"}</Badge>
        </CardContent>
      </Card>

      {/* ---------------- joint availability ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
            <CalendarCheck2 className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            Joint availability · next 4 weeks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <AvailabilityGrid
              title="Alex" subtitle={availability.alex.role}
              weekly={availability.alex.weekly} disabled={!canAvail}
              onToggle={(day, slot, on) => setWeekly("alex", day, slot, on)}
            />
            <div className="space-y-3">
              <AvailabilityGrid
                title="Pat" subtitle={availability.pat.role}
                weekly={availability.pat.weekly} disabled={!canAvail}
                onToggle={(day, slot, on) => setWeekly("pat", day, slot, on)}
              />
              {/* ICS link */}
              <div className="rounded-lg border bg-teal-50/50 p-3 dark:bg-teal-950/20">
                <Label className="flex items-center gap-1.5 text-xs font-semibold">
                  <Link2 className="h-3.5 w-3.5" /> Link Pat&apos;s calendar (easiest for her)
                </Label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  In Google Calendar: Settings → the calendar → “Secret address in iCal format”. Outlook/iCloud
                  publish a similar .ics link. Paste it here — busy days are then avoided in suggestions. She never
                  needs to log in.
                </p>
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                    value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} disabled={!canAvail}
                  />
                  <Button size="sm" variant="outline" disabled={icsBusy || !icsUrl.startsWith("https")} onClick={linkIcs}>
                    {icsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
                {availability.pat.icsFetchedAt && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Linked {availability.pat.icsFetchedAt} · {availability.pat.icsEventCount ?? 0} events · {availability.pat.icsBusyDates?.length ?? 0} busy days
                  </p>
                )}
                {icsMsg && <p className="mt-1.5 text-[11px] font-medium text-teal-800 dark:text-teal-300">{icsMsg}</p>}
              </div>
            </div>
          </div>

          {/* suggestions */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Days you are both free
            </p>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No mutual slots in the next four weeks — widen the grids above, or check the ICS link.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <div key={s.date} className="rounded-lg border px-2.5 py-1.5 text-sm">
                    <span className="font-medium">{fmtShortDate(s.date)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{day3(s.date)}</span>
                    <span className="ml-2 flex flex-wrap gap-1">
                      {s.slots.map((k) => (
                        <Select key={k} value={""} onValueChange={(purpose) => propose(s.date, k, purpose)}>
                          <SelectTrigger size="sm" className="h-6 gap-1 px-2 text-xs">
                            <Send className="h-3 w-3" /> {SLOTS.find((x) => x.k === k)?.label}
                          </SelectTrigger>
                          <SelectContent>
                            {PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* proposals */}
          {(proposed.length > 0 || confirmed.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proposals &amp; commitments</p>
              {[...proposed, ...confirmed].slice(0, 10).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span>
                    <span className="font-medium">{fmtShortDate(p.date)} · {SLOTS.find((s) => s.k === p.slot)?.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.purpose} — proposed by {p.proposedBy}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {p.status === "proposed" ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        awaiting Pat
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                        confirmed
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => copyText(proposalText(p))} aria-label="Copy proposal message">
                      <Send className="h-3.5 w-3.5" /> copy message
                    </Button>
                    {p.status === "proposed" && canAvail && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(p, "confirmed")}>confirm</Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- checklists ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LpaChecklist
          area="financial" title="Property & financial affairs" icon={<Coins className="h-4 w-4 text-teal-700 dark:text-teal-300" />}
          items={LPA_ITEMS.filter((i) => i.area === "financial")}
          checks={checks} onSet={setCheck}
          progress={{ done: finDone, total: finTotal }}
        />
        <LpaChecklist
          area="health" title="Health & welfare" icon={<Heart className="h-4 w-4 text-rose-500" />}
          items={LPA_ITEMS.filter((i) => i.area === "health")}
          checks={checks} onSet={setCheck}
          progress={{ done: heaDone, total: heaTotal }}
        />
      </div>
    </div>
  );
}

function AvailabilityGrid({
  title, subtitle, weekly, disabled, onToggle,
}: {
  title: string;
  subtitle: string;
  weekly: Record<string, SlotKey[]>;
  disabled: boolean;
  onToggle: (day: string, slot: SlotKey, on: boolean) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mb-2 text-xs text-muted-foreground">{subtitle} — tap slots she/he is normally free</p>
      <table className="w-full text-sm">
        <tbody>
          {WEEK.map((day) => (
            <tr key={day}>
              <td className="w-12 py-0.5 text-xs text-muted-foreground">{day}</td>
              {SLOTS.map((s) => {
                const on = (weekly[day] ?? []).includes(s.k);
                return (
                  <td key={s.k} className="px-0.5 py-0.5">
                    <button
                      disabled={disabled}
                      aria-label={`${title} ${day} ${s.label}`}
                      onClick={() => onToggle(day, s.k, !on)}
                      className={`w-full rounded border px-1 py-0.5 text-[10px] transition-colors ${
                        on
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-border bg-transparent text-muted-foreground hover:border-teal-400"
                      }`}
                    >
                      {s.label.slice(0, 4)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LpaChecklist({
  area, title, icon, items, checks, onSet, progress,
}: {
  area: string;
  title: string;
  icon: React.ReactNode;
  items: typeof LPA_ITEMS;
  checks: Record<string, { done: boolean; assignee: LpaAssignee }>;
  onSet: (id: string, patch: Partial<{ done: boolean; assignee: LpaAssignee }>) => void;
  progress: { done: number; total: number };
}) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
          {icon} {title}
          <Badge variant="outline" className="ml-auto">{progress.done}/{progress.total}</Badge>
        </CardTitle>
        <Progress value={pct} className="mt-1 h-1.5" />
      </CardHeader>
      <CardContent className="max-h-[26rem] space-y-2 overflow-y-auto">
        {items.map((item) => {
          const st = checks[item.id] ?? { done: false, assignee: item.assignee };
          return (
            <div key={item.id} className={`rounded-md border px-2.5 py-2 ${st.done ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""}`}>
              <div className="flex items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={st.done}
                  aria-label={`Toggle: ${item.text}`}
                  onCheckedChange={(v) => onSet(item.id, { done: v === true })}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium leading-snug ${st.done ? "line-through opacity-70" : ""}`}>{item.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.why}</p>
                  <p className="mt-0.5 text-[11px] italic text-muted-foreground">{item.ref}</p>
                </div>
                <Select value={st.assignee} onValueChange={(v) => onSet(item.id, { assignee: v as LpaAssignee })}>
                  <SelectTrigger size="sm" className="h-7 w-28 shrink-0 text-xs">{LPA_ASSIGNEE_LABELS[st.assignee]}</SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alex">Alex</SelectItem>
                    <SelectItem value="pat">Pat</SelectItem>
                    <SelectItem value="shared">Shared</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
