"use client";

// Care Hub & legal — the statutory toolkit from the Systems Review:
//   Case file (verdict, evidence base, core metrics) · tickable next actions
//   Knowledge briefings & runbooks · statutory dossier generator (s42 / s117 /
//   Best Interests / handoff protocol letters with escalation clocks) · the
//   multi-agency handoff register with 4h/24h escalation clocks.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpenCheck, Check, ClipboardList, Copy, Gavel, Landmark, Lock,
  ScrollText, Send, TimerReset, TriangleAlert, UserCheck,
} from "lucide-react";
import {
  type CaseAction, type DispatchRecord, type HandoffAcceptance, type HandoffEntry,
  type LetterTemplate, addDispatch, clockState, handoffEscalationState, HANDOFF_AGENCIES,
  loadActionDone, loadDispatches, loadHandoffs, mergeActions, saveActionDone,
  saveDispatches, saveHandoffs,
} from "@/lib/carehub";
import type { SysAuditAction } from "@/lib/auditlog";

interface CareHubData {
  generated: string;
  caseFile: {
    title: string;
    subtitle: string;
    verdict: string;
    placementPreference: string;
    evidenceBase: string[];
    coreMetrics: { label: string; value: string; detail: string }[];
    provenance: string;
  };
  actions: CaseAction[];
  briefings: { id: string; title: string; tag: string; body: string[] }[];
  runbooks: { id: string; title: string; steps: string[] }[];
  letters: LetterTemplate[];
}

interface CareHubProps {
  actorName: string;
  canManage: boolean;
  clientName: string;
  clientDob: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
  onNavigate: (tab: string) => void;
}

function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function LetterVars({ vars }: { vars: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(vars).map(([k, v]) => (
        <Badge key={k} variant="outline" className="text-[10px]">
          <span className="font-mono">{k}</span> = {v}
        </Badge>
      ))}
    </div>
  );
}

export default function CareHub({ actorName, canManage, clientName, clientDob, onAudit, onNavigate }: CareHubProps) {
  const [data, setData] = useState<CareHubData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // stores
  const [actions, setActions] = useState<CaseAction[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffEntry[]>([]);

  // letter state
  const [letterId, setLetterId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [detentionKnown, setDetentionKnown] = useState<"unknown" | "confirmed" | "none">("unknown");
  const [preferredHome, setPreferredHome] = useState("the preferred home (edit me)");

  // handoff form
  const [hAgency, setHAgency] = useState("");
  const [hContact, setHContact] = useState("");
  const [hMethod, setHMethod] = useState<HandoffEntry["method"]>("phone");
  const [hSubject, setHSubject] = useState("");
  const [hAccepted, setHAccepted] = useState<HandoffAcceptance>("pending");
  const [hNotes, setHNotes] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/data/carehub.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as CareHubData;
        setData(json);
        setActions(mergeActions(json.actions, loadActionDone()));
        setLetterId(json.letters[0]?.id ?? "");
      } catch (e) {
        setError(String(e));
        return;
      }
      setDispatches(loadDispatches());
      setHandoffs(loadHandoffs());
    })();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const letter: LetterTemplate | undefined = useMemo(
    () => data?.letters.find((l) => l.id === letterId) ?? data?.letters[0],
    [data, letterId]
  );

  const detentionParagraph =
    detentionKnown === "confirmed"
      ? "His detention history under section 3 has been verified; the s117 duty is therefore engaged in full."
      : detentionKnown === "none"
        ? "We understand there may be no record of a s3 detention; if so, please confirm that position in writing so the family can pursue alternative statutory routes. This request is made without prejudice to that verification."
        : "[Insert verified detention history here — verify with the records office before sending. If a s3 detention is confirmed, delete this bracket and keep the demand; if none is found, use the s42 and Best Interests routes instead.]";

  const letterVars: Record<string, string> = {
    client: clientName,
    dob: clientDob,
    attorney: `${actorName}, attorney under registered LPA`,
    today,
    clockDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    preferredHome,
    detentionParagraph,
  };

  const letterText = letter ? fillTemplate(letter.body, letterVars) : "";

  const toggleAction = (a: CaseAction) => {
    if (!canManage) return;
    const doneMap = loadActionDone();
    const next = !a.done;
    doneMap[a.id] = { done: next, doneAt: next ? new Date().toISOString().slice(0, 10) : undefined };
    saveActionDone(doneMap);
    setActions(mergeActions(data?.actions ?? [], doneMap));
    onAudit("carehub.action.toggle", a.title, next ? `marked complete (owner ${a.owner})` : "re-opened", "notice");
  };

  const copyLetter = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${letter?.recipient}\n\n${letterText}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onAudit("carehub.letter.copy", letter?.title ?? "letter", "statutory letter template copied to clipboard", "notice");
    } catch {
      /* clipboard unavailable */
    }
  };

  const markSent = () => {
    if (!letter || !canManage) return;
    const clockHours = letter.clockHours;
    const next = addDispatch(dispatches, {
      letterId: letter.id,
      letterTitle: letter.title,
      sentAt: new Date().toISOString(),
      sentBy: actorName,
      clockHours,
      clockExpires: new Date(Date.now() + clockHours * 3600000).toISOString(),
    });
    setDispatches(next);
    onAudit(
      "carehub.letter.dispatch",
      letter.title,
      clockHours > 0
        ? `marked as sent to ${letter.recipient} — ${clockHours} h acknowledgement clock started`
        : `marked as sent to ${letter.recipient}`,
      "notice"
    );
  };

  const markAcknowledged = (d: DispatchRecord) => {
    if (!canManage) return;
    const next = dispatches.map((x) =>
      x.id === d.id ? { ...x, acknowledgedAt: new Date().toISOString() } : x
    );
    setDispatches(next);
    saveDispatches(next);
    onAudit("carehub.letter.dispatch", d.letterTitle, "acknowledgement received — clock cleared", "info");
  };

  const addHandoff = () => {
    if (!canManage || !hAgency.trim() || !hSubject.trim()) return;
    const entry: HandoffEntry = {
      id: `h-${Date.now()}`,
      ts: new Date().toISOString(),
      agency: hAgency.trim(),
      contact: hContact.trim() || "—",
      method: hMethod,
      subject: hSubject.trim(),
      accepted: hAccepted,
      acceptedAt: hAccepted === "accepted" ? new Date().toISOString() : undefined,
      escalation: "none",
      notes: hNotes.trim() || undefined,
      loggedBy: actorName,
    };
    const next = [entry, ...handoffs];
    setHandoffs(next);
    saveHandoffs(next);
    onAudit("handoff.add", `${entry.agency} — ${entry.subject}`, `handoff logged (${entry.method}, ${entry.accepted})`, "notice");
    setHAgency("");
    setHContact("");
    setHSubject("");
    setHNotes("");
  };

  const updateHandoff = (id: string, patch: Partial<HandoffEntry>) => {
    if (!canManage) return;
    const next = handoffs.map((h) => (h.id === id ? { ...h, ...patch } : h));
    setHandoffs(next);
    saveHandoffs(next);
    const h = next.find((x) => x.id === id);
    onAudit("handoff.update", `${h?.agency} — ${h?.subject}`, patch.accepted ? `acceptance set to ${patch.accepted}` : "entry updated", "notice");
  };

  const exportHandoffs = () => {
    const rows = [["timestamp", "agency", "contact", "method", "subject", "accepted", "escalation", "notes", "loggedBy"]];
    for (const h of [...handoffs].sort((a, b) => a.ts.localeCompare(b.ts))) {
      rows.push([h.ts, h.agency, h.contact, h.method, h.subject, h.accepted, h.escalation, (h.notes ?? "").replace(/\s+/g, " "), h.loggedBy]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `handoff_register_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onAudit("export.file", `handoff_register_${today}.csv`, "handoff register exported (evidence chronology)", "notice");
  };

  if (error) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Care Hub data could not be loaded ({error}). Check that public/data/carehub.json exists.
        </CardContent>
      </Card>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading the care hub…</p>;

  const openCount = actions.filter((a) => !a.done).length;
  const runningClocks = dispatches.filter((d) => !d.acknowledgedAt && clockState(d).hoursLeft !== Infinity && !clockState(d).expired).length;
  const breachedClocks = dispatches.filter((d) => !d.acknowledgedAt && clockState(d).expired).length;
  const pendingHandoffs = handoffs.filter((h) => h.accepted === "pending" || h.accepted === "refused").length;

  return (
    <div className="space-y-4">
      <Card className="border-teal-300 bg-gradient-to-br from-teal-50 to-emerald-50/60">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-lg text-teal-900">
            <Gavel className="h-5 w-5 text-teal-700" /> Care Hub &amp; legal — the statutory toolkit
          </CardTitle>
          <CardDescription>
            Case file, next actions, briefings, the statutory dossier generator and the multi-agency
            handoff register — the portal operationalisation of the Systems Review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <p className="rounded-lg border bg-white/70 p-2.5 dark:bg-transparent"><span className="font-bold">{openCount}</span> open actions</p>
            <p className="rounded-lg border bg-white/70 p-2.5 dark:bg-transparent"><span className="font-bold">{runningClocks}</span> letter clocks running</p>
            <p className={`rounded-lg border bg-white/70 p-2.5 dark:bg-transparent ${breachedClocks ? "text-rose-700" : ""}`}><span className="font-bold">{breachedClocks}</span> clock(s) expired</p>
            <p className="rounded-lg border bg-white/70 p-2.5 dark:bg-transparent"><span className="font-bold">{pendingHandoffs}</span> handoffs awaiting acceptance</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="case" className="space-y-3">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="case" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" />Case file</TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" />Next actions</TabsTrigger>
          <TabsTrigger value="briefings" className="gap-1.5"><BookOpenCheck className="h-3.5 w-3.5" />Briefings &amp; runbooks</TabsTrigger>
          <TabsTrigger value="letters" className="gap-1.5"><Send className="h-3.5 w-3.5" />Statutory letters</TabsTrigger>
          <TabsTrigger value="handoffs" className="gap-1.5"><UserCheck className="h-3.5 w-3.5" />Handoff register</TabsTrigger>
        </TabsList>

        {/* ---------------- case file ---------------- */}
        <TabsContent value="case" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{data.caseFile.title}</CardTitle>
              <CardDescription>{data.caseFile.subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="rounded-lg border-l-4 border-teal-600 bg-teal-50/70 p-3 leading-relaxed dark:bg-teal-950/20">
                <span className="font-bold">Verdict. </span>{data.caseFile.verdict}
              </p>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence base</p>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {data.caseFile.evidenceBase.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.caseFile.coreMetrics.map((m) => (
                  <div key={m.label} className="rounded-xl border p-3">
                    <p className="text-lg font-bold leading-tight">{m.value}</p>
                    <p className="text-xs font-semibold">{m.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{m.detail}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold">Preferred placement:</span> {data.caseFile.placementPreference}
              </p>
              <p className="rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 text-xs text-muted-foreground dark:bg-teal-950/20">
                {data.caseFile.provenance}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- next actions ---------------- */}
        <TabsContent value="actions" className="space-y-2">
          {!canManage && (
            <p className="flex items-center gap-1.5 rounded-lg border p-2.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Read-only for your role — the family attorneys can tick these off.
            </p>
          )}
          {actions.map((a) => (
            <Card key={a.id} className={a.done ? "opacity-70" : ""}>
              <CardContent className="flex items-start gap-3 p-3.5">
                <Checkbox
                  id={`act-${a.id}`}
                  checked={!!a.done}
                  disabled={!canManage}
                  onCheckedChange={() => toggleAction(a)}
                  className="mt-0.5"
                  aria-label={a.done ? "Mark action open" : "Mark action complete"}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`act-${a.id}`} className={`cursor-pointer text-sm font-semibold ${a.done ? "line-through" : ""}`}>
                    {a.title}
                  </label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.detail}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant={a.priority === "P1" ? "destructive" : a.priority === "P2" ? "secondary" : "outline"} className="text-[10px]">
                      {a.priority}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{a.owner}</Badge>
                    <Badge variant="outline" className="text-[10px]">due {a.due}</Badge>
                    {a.done && <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-800">done {a.doneAt}</Badge>}
                    {a.linkTab && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onNavigate(a.linkTab!)}>
                        open {a.linkTab} →
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---------------- briefings & runbooks ---------------- */}
        <TabsContent value="briefings" className="space-y-2">
          <Accordion type="multiple" defaultValue={["b-mask"]} className="space-y-2">
            {data.briefings.map((b) => (
              <AccordionItem key={b.id} value={b.id} className="rounded-xl border px-4">
                <AccordionTrigger className="text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    {b.title}
                    <Badge variant="outline" className="text-[10px]">{b.tag}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm leading-relaxed text-foreground/90">
                  {b.body.map((p, i) => <p key={i}>{p}</p>)}
                </AccordionContent>
              </AccordionItem>
            ))}
            {data.runbooks.map((r) => (
              <AccordionItem key={r.id} value={r.id} className="rounded-xl border px-4">
                <AccordionTrigger className="text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    {r.title}
                    <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-800">runbook</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="ml-4 list-decimal space-y-1 text-sm leading-relaxed text-foreground/90">
                    {r.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>

        {/* ---------------- statutory letters ---------------- */}
        <TabsContent value="letters" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="h-4 w-4 text-teal-700" /> Statutory dossier generator
              </CardTitle>
              <CardDescription>
                Templated letters auto-populated from the case file. Copy to send from your own email,
                then mark as sent — the acknowledgement clock starts automatically and every escalation
                becomes part of the record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="letter-pick">Letter template</Label>
                  <Select value={letter?.id} onValueChange={setLetterId}>
                    <SelectTrigger id="letter-pick" className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {data.letters.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {letter?.key === "s117" && (
                  <div>
                    <Label htmlFor="detention">s3 detention history</Label>
                    <Select value={detentionKnown} onValueChange={(v) => setDetentionKnown(v as typeof detentionKnown)}>
                      <SelectTrigger id="detention" className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">To verify (bracket kept)</SelectItem>
                        <SelectItem value="confirmed">Confirmed — s117 engaged</SelectItem>
                        <SelectItem value="none">None found — confirm in writing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {letter?.key === "best-interests" && (
                  <div>
                    <Label htmlFor="home">Preferred placement</Label>
                    <Input id="home" value={preferredHome} onChange={(e) => setPreferredHome(e.target.value)} className="mt-1.5" />
                  </div>
                )}
              </div>

              {letter && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{letter.statute}</Badge>
                    <Badge variant="outline" className="text-[10px]">to: {letter.recipient}</Badge>
                    {letter.clockHours > 0 && <Badge variant="outline" className="text-[10px]">{letter.clockHours} h acknowledgement clock</Badge>}
                  </div>
                  <LetterVars vars={{ client: clientName, dob: clientDob, attorney: actorName, today, preferredHome }} />
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-teal-50/50 p-3 text-xs leading-relaxed text-foreground/90 dark:bg-teal-950/20">
{letterText}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="bg-teal-800 hover:bg-teal-700" onClick={copyLetter}>
                      {copied ? <><Check className="mr-1.5 h-3.5 w-3.5 text-emerald-300" /> Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy letter</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!canManage} onClick={markSent}>
                      <TimerReset className="mr-1.5 h-3.5 w-3.5" /> Mark as sent (start clock)
                    </Button>
                    {!canManage && <p className="self-center text-xs text-muted-foreground">Sending is limited to the family attorneys.</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Dispatch log &amp; escalation clocks</CardTitle>
              {breachedClocks > 0 && (
                <CardDescription className="flex items-center gap-1.5 text-rose-700">
                  <TriangleAlert className="h-3.5 w-3.5" /> {breachedClocks} clock(s) expired without acknowledgement — run the parallel escalation ladder (action {`#`}8).
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {dispatches.length === 0 && (
                <p className="text-xs text-muted-foreground">No letters dispatched yet. Mark a letter as sent to start its clock.</p>
              )}
              {dispatches.map((d) => {
                const cs = clockState(d);
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs">
                    <Send className="h-3.5 w-3.5 text-teal-700" />
                    <span className="font-semibold">{d.letterTitle}</span>
                    <span className="text-muted-foreground">sent {new Date(d.sentAt).toLocaleString("en-GB")} by {d.sentBy}</span>
                    {cs.label !== "no clock" && (
                      <Badge variant={cs.label === "acknowledged" ? "outline" : cs.expired ? "destructive" : "secondary"} className="text-[10px]">
                        {cs.label === "acknowledged" ? "acknowledged — clock cleared" : cs.label}
                      </Badge>
                    )}
                    {cs.label !== "acknowledged" && cs.label !== "no clock" && canManage && (
                      <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => markAcknowledged(d)}>
                        mark acknowledged
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- handoff register ---------------- */}
        <TabsContent value="handoffs" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-teal-700" /> Agency handoff register</span>
                <Button size="sm" variant="outline" onClick={exportHandoffs}>Export CSV</Button>
              </CardTitle>
              <CardDescription>
                Who was contacted, when, and whether the handoff was accepted — with the 4-working-hour
                and 24-hour escalation clocks running automatically (Systems Review, Table 2). What was
                &quot;I phoned three agencies that night&quot; becomes a time-stamped, exportable record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {canManage && (
                <div className="grid gap-2 rounded-xl border bg-teal-50/40 p-3 sm:grid-cols-2 dark:bg-teal-950/10">
                  <div>
                    <Label htmlFor="h-agency">Agency</Label>
                    <Select value={hAgency} onValueChange={setHAgency}>
                      <SelectTrigger id="h-agency" className="mt-1.5"><SelectValue placeholder="Pick agency" /></SelectTrigger>
                      <SelectContent>
                        {HANDOFF_AGENCIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="h-contact">Who was spoken to</Label>
                    <Input id="h-contact" value={hContact} onChange={(e) => setHContact(e.target.value)} className="mt-1.5" placeholder="name / role / 'voicemail'" />
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select value={hMethod} onValueChange={(v) => setHMethod(v as HandoffEntry["method"])}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["phone", "email", "voicemail", "letter", "form"] as const).map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Acceptance</Label>
                    <Select value={hAccepted} onValueChange={(v) => setHAccepted(v as HandoffAcceptance)}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="accepted">accepted</SelectItem>
                        <SelectItem value="refused">refused</SelectItem>
                        <SelectItem value="n/a">n/a</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="h-subject">Subject</Label>
                    <Input id="h-subject" value={hSubject} onChange={(e) => setHSubject(e.target.value)} className="mt-1.5" placeholder="what was requested" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="h-notes">Notes</Label>
                    <Textarea id="h-notes" value={hNotes} onChange={(e) => setHNotes(e.target.value)} className="mt-1.5 min-h-[60px]" placeholder="what was said, what was promised, reference numbers…" />
                  </div>
                  <div className="sm:col-span-2">
                    <Button size="sm" className="bg-teal-800 hover:bg-teal-700" disabled={!hAgency || !hSubject.trim()} onClick={addHandoff}>
                      Log handoff
                    </Button>
                  </div>
                </div>
              )}

              <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                {handoffs.map((h) => {
                  const esc = handoffEscalationState(h);
                  return (
                    <div key={h.id} className={`rounded-xl border p-3 text-sm ${esc.breach ? "border-rose-300 bg-rose-50/40 dark:bg-rose-950/10" : ""}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{h.agency}</span>
                        <Badge variant="outline" className="text-[10px]">{h.method}</Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${h.accepted === "accepted" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : h.accepted === "refused" ? "border-rose-300 bg-rose-50 text-rose-800" : ""}`}
                        >
                          {h.accepted}
                        </Badge>
                        <Badge variant={esc.breach ? "destructive" : "secondary"} className="text-[10px]">
                          <TimerReset className="mr-1 h-3 w-3" /> {esc.clockLabel}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{new Date(h.ts).toLocaleString("en-GB")} · logged by {h.loggedBy}</span>
                      </div>
                      <p className="mt-1 font-medium">{h.subject}</p>
                      <p className="text-xs text-muted-foreground">Contact: {h.contact}</p>
                      {h.notes && <p className="mt-1 text-xs leading-relaxed text-foreground/80">{h.notes}</p>}
                      {canManage && h.accepted !== "accepted" && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => updateHandoff(h.id, { accepted: "accepted", acceptedAt: new Date().toISOString() })}>
                            mark accepted
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => updateHandoff(h.id, { escalation: "service-manager" })}>
                            escalate → service manager
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => updateHandoff(h.id, { escalation: "s42" })}>
                            escalate → s42 route
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 text-xs text-muted-foreground dark:bg-teal-950/20">
                Provenance: family-logged (first-class data source). The register does not force agencies
                to care — it makes non-acceptance visible, time-stamped and escalatable. Entries persist
                in this browser; export the CSV into the evidence pack after significant events.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
