"use client";

// Mum's care hub — Mum at Mum's care home, Council.
// The home has no portal, so oversight runs on:
//   · a structured email + phone protocol (weekly call, monthly email, quarterly review)
//   · a contact log (call/email/visit/video) with follow-ups that become tasks
//   · a family well-being tracker (1–5 scale + tags) with a trend chart
//   · ready-made email templates + the WhatsApp group plan

import { useMemo, useState } from "react";
import {
  Building2, ClipboardCheck, Copy, ExternalLink, Footprints, Mail, Phone, Plus, Trash2, Video,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import type { SysAuditAction } from "@/lib/auditlog";
import { fmtDate } from "@/lib/record";
import {
  type MumInfo, type MumContact, type MumWellbeingEntry,
  MUM_WB_TAGS, MUM_WB_SCALE,
  uid, daysBetween, todayStr,
} from "@/lib/family";

const TYPE_ICON: Record<MumContact["type"], React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  visit: <Footprints className="h-3.5 w-3.5" />,
  video: <Video className="h-3.5 w-3.5" />,
};

export default function Mum({
  actor, mum, contacts, onContactsChange, wellbeing, onWellbeingChange, onAudit,
}: {
  actor: SystemUser;
  mum: MumInfo | null;
  contacts: MumContact[];
  onContactsChange: (c: MumContact[]) => void;
  wellbeing: MumWellbeingEntry[];
  onWellbeingChange: (w: MumWellbeingEntry[]) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const today = todayStr();
  const canLog = can(actor, "action.mum_log");

  // ---------------- contact log
  const [form, setForm] = useState<{ date: string; type: MumContact["type"]; who: string; summary: string; followUp: boolean; followUpBy: string }>({
    date: today, type: "call", who: "", summary: "", followUp: false, followUpBy: "",
  });
  const addContact = () => {
    if (!form.summary.trim() || !canLog) return;
    const c: MumContact = {
      id: uid("jc"), date: form.date, type: form.type, who: form.who.trim(),
      summary: form.summary.trim(), followUp: form.followUp,
      followUpBy: form.followUp && form.followUp ? form.followUpBy : undefined,
      created: today,
    };
    onContactsChange([c, ...contacts]);
    onAudit("mum.log.add", `${c.type} · ${c.who || "Mum's care home"}`, c.summary.slice(0, 120), "notice");
    setForm({ ...form, who: "", summary: "", followUp: false, followUpBy: "" });
  };
  const deleteContact = (c: MumContact) => {
    if (!canLog) return;
    onContactsChange(contacts.filter((x) => x.id !== c.id));
    onAudit("mum.log.delete", `${c.type} · ${c.who || "Mum's care home"}`, `entry removed by ${actor.name}`, "warning");
  };

  const lastContact = [...contacts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const gapDays = lastContact ? Math.max(0, daysBetween(lastContact.date, today)) : null;
  const followUps = contacts.filter((c) => c.followUp && (!c.followUpBy || c.followUpBy >= today));

  // ---------------- wellbeing
  const [wb, setWb] = useState<{ date: string; score: number; tags: string[]; note: string }>({
    date: today, score: 4, tags: [], note: "",
  });
  const addWb = () => {
    if (!canLog) return;
    const e: MumWellbeingEntry = { id: uid("jw"), date: wb.date, score: wb.score, tags: wb.tags, note: wb.note.trim() };
    onWellbeingChange([e, ...wellbeing]);
    onAudit("mum.wellbeing.add", `${e.date} · ${e.score}/5`, [...e.tags, e.note].filter(Boolean).join("; ").slice(0, 120), "notice");
    setWb({ ...wb, tags: [], note: "" });
  };
  const chartData = useMemo(
    () => [...wellbeing].sort((a, b) => a.date.localeCompare(b.date)).map((w) => ({ date: w.date.slice(5), score: w.score })),
    [wellbeing]
  );
  const avg5 = wellbeing.length ? (wellbeing.reduce((a, w) => a + w.score, 0) / wellbeing.length).toFixed(1) : null;

  // ---------------- templates
  const [tplOpen, setTplOpen] = useState<string | null>(null);
  const openTpl = mum?.emailTemplates.find((t) => t.id === tplOpen) ?? null;

  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  const mailto = (subject: string, body: string) =>
    `mailto:${mum?.profile.careHome.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const home = mum?.profile.careHome;

  return (
    <div className="space-y-4">
      {/* profile */}
      <Card className="border-violet-200 dark:border-violet-900">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            <p className="text-base font-bold text-teal-900 dark:text-teal-200">
              {mum?.profile.name ?? "Mum"} — {mum?.profile.setting ?? "Mum's care home, Council"}
            </p>
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
              no portal — email + phone protocol
            </Badge>
            {gapDays !== null && (
              <Badge variant="outline" className={gapDays > 7
                ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"}>
                last contact {gapDays === 0 ? "today" : `${gapDays}d ago`}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{mum?.profile.monitoringModel}</p>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <HomeField label="Phone" value={home?.phone} placeholder="Add from the admission pack" />
            <HomeField label="Email" value={home?.email} placeholder="Add from the admission pack" />
            <HomeField label="Manager" value={home?.manager} placeholder="Add name" />
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Website</p>
              {home?.web && (
                <a href={home.web} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-teal-800 underline dark:text-teal-300">
                  the care-home group — Mum's care home <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{home?.fillNote}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* protocol */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <ClipboardCheck className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Contact protocol &amp; call checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 space-y-3 overflow-y-auto">
            <div className="space-y-1.5">
              {(mum?.protocol.cadence ?? []).map((c, i) => (
                <div key={i} className="flex gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <Badge variant="outline" className="shrink-0">{c.freq}</Badge>
                  <div>
                    <p className="font-medium">{c.what}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border bg-teal-50/50 p-2.5 dark:bg-teal-950/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly call checklist</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {(mum?.protocol.questionsChecklist ?? []).map((q, i) => <li key={i}>• {q}</li>)}
              </ul>
            </div>
            <div className="rounded-md border p-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Escalation ladder</p>
              <ol className="mt-1 space-y-0.5 text-sm">
                {(mum?.protocol.escalation ?? []).map((e, i) => <li key={i}>{e}</li>)}
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* contact log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <Phone className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Contact log
              <Badge variant="outline" className="ml-auto">{contacts.length} entries</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canLog && (
              <div className="space-y-2 rounded-lg border bg-teal-50/50 p-3 dark:bg-teal-950/20">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="jc-date">Date</Label>
                    <Input id="jc-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as MumContact["type"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="call">Phone call</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="visit">Visit</SelectItem>
                        <SelectItem value="video">Video call</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="jc-who">Who at the home</Label>
                    <Input id="jc-who" placeholder="e.g. Sarah (senior on duty)" value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="jc-summary">What was said / found</Label>
                  <Textarea id="jc-summary" rows={2} value={form.summary} placeholder="Summary of the conversation…" onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={form.followUp} onCheckedChange={(v) => setForm({ ...form, followUp: v === true })} />
                    Follow-up needed
                  </label>
                  {form.followUp && (
                    <Input type="date" className="w-40" value={form.followUpBy} onChange={(e) => setForm({ ...form, followUpBy: e.target.value })} aria-label="Follow-up by date" />
                  )}
                  <Button size="sm" className="ml-auto bg-teal-800 hover:bg-teal-700" disabled={!form.summary.trim()} onClick={addContact}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Log it
                  </Button>
                </div>
              </div>
            )}
            {followUps.length > 0 && (
              <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {followUps.length} open follow-up{followUps.length === 1 ? "" : "s"} — create tasks for them in My tasks if they need a slot.
              </p>
            )}
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts logged yet — the weekly call checklist above gives you the first script.</p>
              ) : (
                [...contacts].sort((a, b) => b.date.localeCompare(a.date)).map((c) => (
                  <div key={c.id} className="rounded-md border px-2.5 py-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 text-xs font-medium">{TYPE_ICON[c.type]} {c.type}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(c.date)}{c.who ? ` · ${c.who}` : ""}</span>
                      {c.followUp && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                          follow-up{c.followUpBy ? ` by ${fmtDate(c.followUpBy)}` : ""}
                        </Badge>
                      )}
                      {canLog && (
                        <Button size="sm" variant="ghost" className="ml-auto" aria-label="Remove entry" onClick={() => deleteContact(c)}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs">{c.summary}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* wellbeing tracker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              Well-being tracker
              {avg5 && <Badge variant="outline" className="ml-auto">average {avg5}/5 across {wellbeing.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-40">
              {chartData.length >= 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-8 text-center text-sm text-muted-foreground">Add at least two entries to see the trend.</p>
              )}
            </div>
            {canLog && (
              <div className="space-y-2 rounded-lg border bg-teal-50/50 p-3 dark:bg-teal-950/20">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="jw-date">Date</Label>
                    <Input id="jw-date" type="date" value={wb.date} onChange={(e) => setWb({ ...wb, date: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Score</Label>
                    <Select value={String(wb.score)} onValueChange={(v) => setWb({ ...wb, score: Number(v) })}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MUM_WB_SCALE.map((s) => (
                          <SelectItem key={s.score} value={String(s.score)}>{s.score} — {s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MUM_WB_TAGS.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                      <Checkbox checked={wb.tags.includes(t)} onCheckedChange={(v) => setWb({ ...wb, tags: v === true ? [...wb.tags, t] : wb.tags.filter((x) => x !== t) })} />
                      {t}
                    </label>
                  ))}
                </div>
                <Input placeholder="Note (optional) — what you observed…" value={wb.note} onChange={(e) => setWb({ ...wb, note: e.target.value })} />
                <Button size="sm" className="bg-teal-800 hover:bg-teal-700" onClick={addWb}>Add entry</Button>
              </div>
            )}
            <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {MUM_WB_SCALE.map((s) => (
                <p key={s.score}><span className="font-semibold text-foreground">{s.score} — {s.label}:</span> {s.desc}</p>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* email templates + whatsapp plan */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <Mail className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Email templates &amp; WhatsApp plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(mum?.emailTemplates ?? []).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                <span className="font-medium">{t.title}</span>
                <Button size="sm" variant="outline" onClick={() => setTplOpen(t.id)}>Open</Button>
              </div>
            ))}
            <div className="rounded-md border bg-teal-50/50 p-2.5 dark:bg-teal-950/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mum&apos;s WhatsApp group (to create)
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm">
                {(mum?.protocol.whatsappPlan ?? []).map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* template dialog */}
      <Dialog open={!!openTpl} onOpenChange={(o) => !o && setTplOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {openTpl && (
            <>
              <DialogHeader>
                <DialogTitle>{openTpl.title}</DialogTitle>
                <DialogDescription>Send to {home?.email || "the home's address"} — replace the [bracketed] bits first.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <div className="rounded-md border p-2 text-xs">
                  <p className="font-semibold">Subject: {openTpl.subject}</p>
                </div>
                <Textarea rows={12} value={openTpl.body} readOnly className="font-mono text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(openTpl.body)}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copy body
                  </Button>
                  <a href={mailto(openTpl.subject, openTpl.body)} className="flex-1">
                    <Button size="sm" className="w-full bg-teal-800 hover:bg-teal-700">
                      <Mail className="mr-1 h-3.5 w-3.5" /> Open in email app
                    </Button>
                  </a>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HomeField({ label, value, placeholder }: { label: string; value?: string; placeholder: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
      {value ? <p className="text-sm font-medium">{value}</p> : <p className="text-sm italic text-muted-foreground">{placeholder}</p>}
    </div>
  );
}
