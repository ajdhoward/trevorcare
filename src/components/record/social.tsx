"use client";

import { useEffect, useMemo, useState } from "react";
import {
  UsersRound,
  Phone,
  BookOpenCheck,
  MessageSquarePlus,
  Trash2,
  Mail,
  Copy,
  Check,
  Sparkles,
  CalendarClock,
  Loader2,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate, type CareRecord, type AuditData } from "@/lib/record";
import {
  chat,
  loadSettings,
  isConfigured,
  emailMessages,
  rectificationMessages,
  recordDigest,
} from "@/lib/ai/engine";
import type { SysAuditAction } from "@/lib/auditlog";
import { Lock } from "lucide-react";

// ---------------------------------------------------------------- types
interface LogEntry {
  id: string;
  date: string;
  channel: string;
  party: string;
  subject: string;
  summary: string;
  outcome: string;
  followUp: string;
}

interface CustomContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}

const LOG_LS = "care-comms-log-v1";
const CONTACT_LS = "care-custom-contacts-v1";

const CHANNELS = ["Phone", "Email", "Letter", "Meeting / visit", "Portal message", "Other"];

// ------------------------------------------------------- framework routing
const FRAMEWORKS: { route: string; use: string; include: string[] }[] = [
  {
    route: "Care Act 2014 s9 — needs assessment",
    use: "Ask Council Council to (re)assess Dad's needs — e.g. after a diagnosis change or increased confusion.",
    include: ["Dad's details & consent (or 'best interests' if declined)", "What has changed, with dates", "Risks if needs are not reassessed"],
  },
  {
    route: "Care Act 2014 s24 — care & support plan review",
    use: "Request a formal review of the current package (the record shows amendments but request a dated review meeting).",
    include: ["Request a review meeting with the care manager present", "Attach the updated care plan (Downloads tab)", "Ask for written outcomes"],
  },
  {
    route: "Care Act 2014 s42 — safeguarding concern",
    use: "Report abuse/neglect or serious service failure: unexplained injuries, repeated missed medication, ignored refusals.",
    include: ["What happened, when, who was involved", "Immediate risk & who is at risk", "What you want to happen (enquiry under s42)"],
  },
  {
    route: "Care Act 2014 s10 — carer's assessment",
    use: "For family members providing regular care — an assessment of their own needs is a legal right.",
    include: ["Who provides what care", "Impact on work/health", "What support would help"],
  },
  {
    route: "Mental Capacity Act 2005",
    use: "Refusals or decisions linked to memory loss: ask how capacity was assessed and how best-interests decisions were recorded.",
    include: ["The specific decision in question", "Request the capacity assessment record", "Ask how carers record consent/best-interests day-to-day"],
  },
  {
    route: "UK GDPR Art 15 / Art 16",
    use: "Art 15: subject access (all data held incl. change history). Art 16: rectification of wrong next of kin, missing diagnosis, etc.",
    include: ["Data subject's details (client id 000)", "Exact items to correct", "One-month statutory response window"],
  },
  {
    route: "Complaints route",
    use: "Agency complaints process first (see Policy 402 / handbook), then Council Council commissioning, then CQC (cqc.org.uk — 'report a concern').",
    include: ["What went wrong with dates", "Effect on Dad", "What resolution you expect"],
  },
  {
    route: "Duty of Candour (Policy 125)",
    use: "When harm has occurred, the provider must be open and tell you — quote this policy when asking for incident explanations.",
    include: ["The incident and date", "Request the notification meeting", "Ask what has changed as a result"],
  },
  {
    route: "Mental Health Act s17 / s117",
    use: "Only applies to patients detained under the MHA (s17 leave) or discharged from detention (s117 aftercare). Dad's record shows no MHA detention — the Conditions tab carries the full check.",
    include: ["n/a — cross-reference only"],
  },
];

// --------------------------------------------------------- letter templates
interface Template {
  id: string;
  label: string;
  to: string;
  context: string;
  subject: string;
  body: (now: string) => string;
}

const trev = "Dad, DOB 01/01/1947, 1 Sample Road, Market Town AB1 2CD (the care agency client id 000)";

const TEMPLATES: Template[] = [
  {
    id: "rectification",
    label: "Correct the record — next of kin (UK GDPR Art 16)",
    to: "the care agency office / records team",
    context: "Rectification request naming Alex as next of kin and asking for the change history.",
    subject: "Rectification request — next-of-kin details (UK GDPR Article 16)",
    body: () => `Dear the care agency (records / registered manager),

I am writing under Article 16 of the UK GDPR to request rectification of inaccurate personal data held about ${trev}.

1. Incorrect: "Next of Kin 2 — Contact A (Neice-in-law)" and "Next of Kin 3 — Contact B (Nephew)".
   Correction: Contact A is NOT Dad's next of kin. Dad's son, Alex, should be recorded as primary next of kin, with Contact B retained as a secondary contact. Please confirm the current emergency contact order for out-of-hours calls.

2. Also incorrect: the primary "Next of Kin 1" entry is empty, and "Neice-in-law" is misspelled.

Under Article 16 the data must be rectified without undue delay and within one month. Please:
- confirm in writing the changes made and the date made;
- provide the history of changes to the contacts record for the last 3 years (who requested/approved each change), or confirm under Article 15 if a copy of that data is required.

If any part of this request is refused, please state the reason and my right to complain to the ICO.

Yours faithfully,
[Your name]
[Relationship: son] · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
  {
    id: "sar",
    label: "Subject access request — everything held (UK GDPR Art 15)",
    to: "the care agency office / Data Protection Officer",
    context: "Access request for all data held about Dad, including amendment history and audit logs.",
    subject: "Subject access request (UK GDPR Article 15)",
    body: () => `Dear Data Protection Officer,

Please provide, under Article 15 UK GDPR, all personal data you hold about ${trev}, including:
- all profile and contact records, and the audit/history of changes to them;
- all visit notes, task and medication records;
- all risk assessments, support plans and care plans (including superseded versions);
- all incident, complaint and safeguarding records;
- the communication log for the past 3 years.

Please supply in a commonly used electronic format within one month. If any exemption is relied on, please specify it.

Yours faithfully,
[Your name] · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
  {
    id: "gp-diagnosis",
    label: "GP — confirm Alzheimer's diagnosis & share with carers",
    to: "the GP surgery (GP)",
    context: "Asks the GP to confirm the diagnosis, stage and plan so the agency's record can be corrected.",
    subject: "Dad (DOB 01/01/1947) — confirmation of Alzheimer's diagnosis for the care record",
    body: () => `Dear Dr / Practice Manager,

${trev}, receives domiciliary care from the care agency. His care record lists no dementia diagnosis (only "memory issues") and rates cognitive impairment LOW, yet it also records:
- Memantine 20 mg daily (ongoing since 06/10/2025);
- Risperidone 500 mcg–1 mg daily;
- memory-clinic and dementia-nurse involvement during 2026;
- repeated confusion episodes in carers' notes.

Please confirm in writing:
1. Dad's diagnosis and current stage;
2. the current treatment plan and review schedule for the Risperidone (NICE NG97 recommends review at least every 6 weeks when used for distress in dementia);
3. consent to share the diagnosis and key strategies with his care agency so the record can be corrected and carers briefed.

Dad's son Alex is happy to be contacted: [phone].

Yours faithfully,
[Your name] · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
  {
    id: "safeguarding",
    label: "Raise a safeguarding concern (Care Act 2014 s42)",
    to: "Council Council Adult Social Care / Safeguarding partnership",
    context: "Use for serious concerns. Keep entries factual; the comms log below keeps your trail.",
    subject: "Safeguarding concern — Dad (DOB 01/01/1947)",
    body: () => `Dear Safeguarding Team,

I wish to raise a concern under Section 42 of the Care Act 2014 regarding ${trev}, who has dementia (Alzheimer's) and lives alone with 4 visits/day.

Concern (replace with your specifics — include dates, times, and what happened):
[e.g. on (date) carers recorded … / medication was not given because … / Dad was found …]

Immediate risk: [what could happen if nothing changes].
Already raised with: [agency/GP] on [date] — response: [what was said].

Requested action: a s42 enquiry and a review of the care package, with written confirmation of outcomes.

Reporter: [Your name], son · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
  {
    id: "review",
    label: "Request a care & support review (Care Act 2014 s24 / s9)",
    to: "Council Council Adult Social Care (allocated care manager)",
    context: "Formal review request referencing the diagnosis gap and the amended care plan.",
    subject: "Request for care & support plan review — Dad",
    body: () => `Dear Care Manager,

Please arrange a review of my father's care and support plan under Sections 9 and 24 of the Care Act 2014. ${trev}.

Reasons:
1. The care record contains no dementia diagnosis although he takes Memantine (an Alzheimer's-specific medicine) and has had memory-clinic input — the cognitive-impairment risk is rated LOW, which understates his needs.
2. The family has prepared an amended care plan (7 pages, attached) covering hearing-aid support, pain monitoring, food-and-fluid escalation, Risperidone variability, and environment repairs.
3. Next-of-kin details in the record are wrong (being corrected under UK GDPR); please note Alex (son) is the primary contact.

Please confirm the review date and who will attend.

Yours faithfully,
[Your name] · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
  {
    id: "complaint",
    label: "Complaint about the care provider",
    to: "the care agency registered manager (then council commissioning / CQC)",
    context: "Structured complaint with the resolution you expect; escalate if unanswered.",
    subject: "Formal complaint — Dad (client id 000)",
    body: () => `Dear Registered Manager,

I wish to make a formal complaint about aspects of my father's care. ${trev}.

What went wrong (list each item with date, carer/office response):
1. [e.g. (date) — missed/short visit …]
2. [e.g. (date) — eMAR not completed …]

Effect on Dad: [impact].
What I expect: [apology / plan of remedial action / staff retraining / written confirmation of changes].
Please respond within 10 working days with a named contact and reference number. If unresolved I will escalate to Council Council commissioning and the CQC.

Yours faithfully,
[Your name] · [phone] · [email]
${fmtDate(new Date().toISOString().slice(0, 10))}`,
  },
];

// ---------------------------------------------------------------- component
export default function Social({
  record,
  audit,
  onNavigate,
  showContacts,
  canEditComms,
  onAudit,
}: {
  record: CareRecord;
  audit: AuditData | null;
  onNavigate: (tab: string) => void;
  showContacts: boolean;
  canEditComms: boolean;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [contacts, setContacts] = useState<CustomContact[]>([]);
  const [form, setForm] = useState<Omit<LogEntry, "id">>({
    date: today,
    channel: "Phone",
    party: "",
    subject: "",
    summary: "",
    outcome: "",
    followUp: "",
  });
  const [cForm, setCForm] = useState<Omit<CustomContact, "id">>({ name: "", role: "", phone: "", email: "" });
  const [templateId, setTemplateId] = useState("rectification");
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem(LOG_LS) || "[]") as LogEntry[];
      setLog(Array.isArray(l) ? l : []);
      const c = JSON.parse(localStorage.getItem(CONTACT_LS) || "[]") as CustomContact[];
      setContacts(Array.isArray(c) ? c : []);
    } catch {
      /* ignore */
    }
  }, []);

  const persistLog = (next: LogEntry[]) => {
    setLog(next);
    try {
      localStorage.setItem(LOG_LS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const persistContacts = (next: CustomContact[]) => {
    setContacts(next);
    try {
      localStorage.setItem(CONTACT_LS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const addEntry = () => {
    if (!canEditComms) return;
    if (!form.party.trim() || !form.subject.trim()) return;
    persistLog([{ ...form, id: `${Date.now()}` }, ...log].sort((a, b) => b.date.localeCompare(a.date)));
    onAudit(
      "comms.entry.add",
      `${form.channel} → ${form.party}`,
      `${form.subject}${form.outcome ? ` · outcome: ${form.outcome}` : ""}${form.followUp ? ` · follow-up: ${form.followUp}` : ""}`,
      "notice"
    );
    setForm({ date: today, channel: "Phone", party: "", subject: "", summary: "", outcome: "", followUp: "" });
  };

  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const tmplBody = useMemo(() => template.body(today), [template, today]);

  const mailto = `mailto:?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(draft || tmplBody)}`;

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${template.subject}\n\n${draft || tmplBody}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const draftWithAI = async () => {
    setDrafting(true);
    setDraftNote("");
    try {
      const settings = loadSettings();
      if (!isConfigured(settings)) {
        setDraftNote(
          "AI engine not configured — showing the built-in template instead. Open the AI assistant tab to add a provider."
        );
        setDraft("");
        return;
      }
      const digest = recordDigest(record, audit, null);
      const messages =
        template.id === "rectification"
          ? rectificationMessages({
              digest,
              senderName: "[Your name], son",
              items: [
                "Next of kin listed as Contact A (niece-in-law) / Contact B (nephew) — Contact A is NOT next of kin; son Alex should be primary next of kin",
                "The primary 'Next of Kin 1' entry is empty",
                "'Neice-in-law' is misspelled",
              ],
            })
          : emailMessages({
              digest,
              recipientLabel: template.to,
              recipientContext: template.context,
              subject: template.subject,
              points: [tmplBody.split("\n\n").slice(1).join("\n\n").slice(0, 1200)],
              tone: "firm, courteous, factual",
              senderName: "[Your name], son",
            });
      const text = await chat(settings, messages);
      setDraft(text);
      setDraftNote("Drafted with your AI provider — review names and placeholders before sending.");
    } catch (e) {
      setDraftNote(`AI drafting failed: ${(e as Error).message} — showing the built-in template instead.`);
      setDraft("");
    } finally {
      setDrafting(false);
    }
  };

  const mhContact = record.client.contacts.find((c) => c.contactType === "Other");
  const suggestions = [
    {
      icon: CalendarClock,
      text: "Ask the office who Dad's allocated social worker / care manager is, and log their name and number here.",
    },
    {
      icon: CalendarClock,
      text: `From the record: memory-clinic nurse visit on ${fmtDate(audit?.alzheimer.note_quotes.memory_clinic[0]?.date || "")} — log any follow-up you arrange.`,
    },
    {
      icon: CalendarClock,
      text: `From the record: family contacted a dementia nurse on ${fmtDate(audit?.alzheimer.note_quotes.dementia_nurse[0]?.date || "")} — log the outcome.`,
    },
    {
      icon: CalendarClock,
      text: "Log the date you send the Article 16 rectification letter, then diarise a chase after one month.",
    },
  ];

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="border-teal-300">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-800">
            <UsersRound className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-teal-900">Social care &amp; communications</h2>
            <p className="text-xs text-muted-foreground">
              Who is involved in Dad&apos;s social/mental-health care, a dated log of every
              communication with social care and the agency, and the statutory route each request
              should take. Log entries are stored in this browser.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* contacts */}
      {showContacts ? (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Phone className="h-4 w-4 text-teal-700" />
            Key contacts
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            No allocated social worker is named anywhere in the record — first action below. The
            mental-health worker entry is the agency&apos;s own wording (&ldquo;Other · the mental-health team · relationship: mental-health worker · address: Mental Health Worker&rdquo;).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {mhContact && (
              <div className="rounded-lg border p-3">
                <div className="text-[13px] font-semibold text-teal-900">
                  the mental-health team — mental health worker
                </div>
                <div className="text-xs text-muted-foreground">
                  {mhContact.relationship.trim()} · {mhContact.telNo1.trim()}
                </div>
              </div>
            )}
            {record.client.contacts
              .filter((c) => c.contactType === "Doctor" || c.contactType === "District Nurse")
              .map((c) => (
                <div key={c.contactType} className="rounded-lg border p-3">
                  <div className="text-[13px] font-semibold text-teal-900">
                    {c.name.trim()} ({c.contactType})
                  </div>
                  <div className="text-xs text-muted-foreground">{c.telNo1.trim()}</div>
                </div>
              ))}
          </div>

          {contacts.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {contacts.map((c) => (
                <div key={c.id} className="flex items-start gap-2 rounded-lg border border-dashed p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-teal-900">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.role}
                      {c.phone ? ` · ${c.phone}` : ""}
                      {c.email ? ` · ${c.email}` : ""}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove contact"
                    onClick={() => {
                      onAudit("comms.entry.delete", `custom contact: ${c.name}`, "removed from contact list", "warning");
                      persistContacts(contacts.filter((x) => x.id !== c.id));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* add custom contact */}
          <div className="rounded-lg border border-dashed p-3">
            <div className="mb-2 text-xs font-semibold text-teal-900">
              Add your own contact (social worker, care manager, advocate…)
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input placeholder="Name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} />
              <Input placeholder="Role" value={cForm.role} onChange={(e) => setCForm({ ...cForm, role: e.target.value })} />
              <Input placeholder="Phone" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} />
              <Input placeholder="Email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={!cForm.name.trim() || !canEditComms}
              onClick={() => {
                onAudit("comms.entry.add", `custom contact: ${cForm.name}`, `added to contact list (role: ${cForm.role || "unspecified"})`, "notice");
                persistContacts([...contacts, { ...cForm, id: `${Date.now()}` }]);
                setCForm({ name: "", role: "", phone: "", email: "" });
              }}
            >
              <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" /> Add contact
            </Button>
          </div>

          <div className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
            Worth logging: <strong>who is Dad&apos;s allocated social worker/care manager?</strong> The
            portal record has no social-worker entry — the only statutory involvement shown is the
            mental-health worker contact. If a care manager exists at Council Council, their name
            should be added to this interface via “Add your own contact”.
          </div>
        </CardContent>
      </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Contacts and next-of-kin details are hidden for your role (data minimisation — managed in Access &amp; audit).
          </CardContent>
        </Card>
      )}

      {/* comms log */}
      <Card className="border-teal-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <MessageSquarePlus className="h-4 w-4 text-teal-700" />
            Communication log — social care &amp; agency
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The portal&apos;s own communication log is unreliable (it returns another client&apos;s 2019
            entry — see the Records audit tab), so keep the authoritative family log here: every call,
            letter and email with the outcome and the next step.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* suggestions */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <Lightbulb className="h-3.5 w-3.5" /> Worth logging
            </div>
            <ul className="space-y-1">
              {suggestions.map((s, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                  <s.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {s.text}
                </li>
              ))}
            </ul>
          </div>

          {/* form */}
          <div className="grid gap-2 md:grid-cols-6">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="md:col-span-1" />
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
              <SelectTrigger className="md:col-span-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Who with (party)" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} className="md:col-span-2" />
            <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="md:col-span-2" />
            <Textarea
              placeholder="What was discussed / said"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              className="md:col-span-3"
              rows={2}
            />
            <Textarea
              placeholder="Outcome / commitment"
              value={form.outcome}
              onChange={(e) => setForm({ ...form, outcome: e.target.value })}
              className="md:col-span-2"
              rows={2}
            />
            <div className="flex items-start gap-2 md:col-span-1">
              <Input type="date" value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} aria-label="Follow-up date" />
            </div>
          </div>
          <Button size="sm" onClick={addEntry} disabled={!form.party.trim() || !form.subject.trim()}>
            <MessageSquarePlus className="mr-1.5 h-4 w-4" /> Add to log
          </Button>

          {/* entries */}
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">No entries yet — the log is stored in this browser.</p>
          ) : (
            <div className="space-y-2">
              {log.map((e) => (
                <div key={e.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {fmtDate(e.date)}
                    </Badge>
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {e.channel}
                    </Badge>
                    <span className="text-[13px] font-semibold text-teal-900">{e.party}</span>
                    <span className="text-[13px] text-foreground/85">— {e.subject}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-auto"
                      aria-label="Delete entry"
                      onClick={() => persistLog(log.filter((x) => x.id !== e.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {e.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">{e.summary}</p>}
                  {e.outcome && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">
                      <strong>Outcome:</strong> {e.outcome}
                    </p>
                  )}
                  {e.followUp && (
                    <p className="mt-1 text-xs text-amber-700">
                      <strong>Follow up:</strong> {fmtDate(e.followUp)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* framework routing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <BookOpenCheck className="h-4 w-4 text-teal-700" />
            Correct procedures &amp; frameworks — which route for which request
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Everything this interface asks for is mapped to the statute or policy that obliges a
            response. Quote the route in your letters — it is what turns a worry into a duty.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {FRAMEWORKS.map((f) => (
            <div key={f.route} className="rounded-lg border p-3">
              <div className="text-[13px] font-semibold text-teal-900">{f.route}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/85">
                <strong>Use for:</strong> {f.use}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {f.include.map((x, i) => (
                  <Badge key={i} variant="outline" className="text-[10.5px] font-normal text-muted-foreground">
                    {x}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* letter templates */}
      <Card className="border-teal-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Mail className="h-4 w-4 text-teal-700" />
            Letter &amp; email templates
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pre-filled from the record. &ldquo;Draft with AI&rdquo; rewrites the letter with your
            configured provider (AI assistant tab) — otherwise the statutory template is used.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setDraft(""); setDraftNote(""); }}>
              <SelectTrigger className="w-full max-w-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              To: {template.to}
            </Badge>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border bg-teal-50/40 p-3">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Subject: {template.subject}</div>
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{draft || tmplBody}</pre>
          </div>
          {draftNote && <p className="text-xs leading-relaxed text-amber-700">{draftNote}</p>}
          <div className="flex flex-wrap gap-2">
            <Button className="bg-teal-800 hover:bg-teal-700" asChild>
              <a
                href={mailto}
                onClick={() =>
                  onAudit("comms.letter", template.to, `letter “${template.subject}” opened in email app${draft ? " (AI-drafted)" : " (template)"}`, "notice")
                }
              >
                <Mail className="mr-1.5 h-4 w-4" /> Open in email app
              </a>
            </Button>
            <Button variant="outline" onClick={copyDraft}>
              {copied ? (
                <>
                  <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy letter
                </>
              )}
            </Button>
            <Button variant="outline" onClick={draftWithAI} disabled={drafting}>
              {drafting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Drafting…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Draft with AI
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={() => onNavigate("assistant")}>
              Engine settings →
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
