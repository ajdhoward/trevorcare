"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Database,
  FileWarning,
  Brain,
  UserSearch,
  History,
  ChevronDown,
  ChevronRight,
  Quote,
  ExternalLink,
  Pill,
  AlertTriangle,
  CircleAlert,
  CircleCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDate, type AuditData, type IncorrectInfoItem } from "@/lib/record";

const SEV_STYLE: Record<string, string> = {
  High: "border-red-200 bg-red-100 text-red-800",
  Medium: "border-amber-200 bg-amber-100 text-amber-800",
  Low: "border-teal-200 bg-teal-100 text-teal-800",
};
const SEV_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  High: AlertTriangle,
  Medium: CircleAlert,
  Low: CircleCheck,
};
const WEIGHT_STYLE: Record<string, string> = {
  Strong: "border-red-200 bg-red-100 text-red-800",
  Supporting: "border-amber-200 bg-amber-100 text-amber-800",
  Mixed: "border-teal-200 bg-teal-100 text-teal-800",
  Absent: "border-zinc-300 bg-zinc-200 text-zinc-700",
};

function NoteQuote({ date, note }: { date: string; note: string }) {
  return (
    <div className="rounded-md border bg-background/60 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Quote className="h-3 w-3" /> {fmtDate(date)}
      </div>
      <p className="text-[12.5px] leading-relaxed text-foreground/85">&ldquo;{note}&rdquo;</p>
    </div>
  );
}

export default function Audit({
  audit,
  onNavigate,
}: {
  audit: AuditData | null;
  onNavigate: (tab: string) => void;
}) {
  const [openVerbatim, setOpenVerbatim] = useState(false);
  const [openDq, setOpenDq] = useState<string | null>("DQ-1");
  const [showAllAdam, setShowAllAdam] = useState(false);

  if (!audit) {
    return <p className="text-sm text-muted-foreground">Loading the records audit…</p>;
  }

  const kinField = audit.provenance.fields.find((f) => f.source.includes("contacts"));
  const alexQuotes = showAllAdam ? audit.alex.quotes : audit.alex.quotes.slice(0, 4);

  const dqToggle = (id: string) => setOpenDq((v) => (v === id ? null : id));

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/50">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-amber-900">Records audit — provenance, accuracy &amp; the Alzheimer&apos;s question</h2>
            <p className="text-xs text-muted-foreground">
              Where every field comes from, what is wrong in the record, whether the portal shows
              Dad&apos;s Alzheimer&apos;s, and who changed what. Generated {fmtDate(audit.generated)} from
              the full-text of the portal API data and all 23 agency documents.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onNavigate("social")}>
            Letter templates →
          </Button>
        </CardContent>
      </Card>

      {/* provenance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Database className="h-4 w-4 text-teal-700" />
            Where the information comes from
          </CardTitle>
          <p className="text-[13px] leading-relaxed text-foreground/85">{audit.provenance.headline_answer}</p>
          <p className="text-xs text-muted-foreground">
            {audit.provenance.portal} · {audit.provenance.account} · {audit.provenance.pulled}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/60 text-left">
                  <th className="px-3 py-2 font-semibold">Field in this interface</th>
                  <th className="px-3 py-2 font-semibold">Source (the care portal portal API)</th>
                  <th className="px-3 py-2 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {audit.provenance.fields.map((f) => (
                  <tr key={f.field} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 font-medium text-teal-900">{f.field}</td>
                    <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{f.source}</td>
                    <td className="px-3 py-2 leading-relaxed text-foreground/85">{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {kinField?.verbatim ? (
            <div>
              <button
                onClick={() => setOpenVerbatim((v) => !v)}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-teal-800"
              >
                {openVerbatim ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Verbatim contacts payload (exactly what the agency holds)
              </button>
              {openVerbatim && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg border bg-background/60 p-3 text-[11.5px] leading-relaxed">
                  {JSON.stringify(kinField.verbatim, null, 2)}
                </pre>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* API scope */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Database className="h-4 w-4 text-teal-700" />
            {audit.provenance.api_scope.question}
          </CardTitle>
          <p className="text-[13px] leading-relaxed text-foreground/85">{audit.provenance.api_scope.answer}</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-semibold text-emerald-800">Yes — the API returns more than the UI shows</div>
            <ul className="mt-1.5 space-y-1">
              {audit.provenance.api_scope.extra_you_can_get.map((x, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <div className="text-xs font-semibold text-red-800">No — hidden behind office/staff roles</div>
            <ul className="mt-1.5 space-y-1">
              {audit.provenance.api_scope.not_exposed_to_family_role.map((x, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* incorrect information log */}
      <Card className="border-red-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <FileWarning className="h-4 w-4 text-red-600" />
            Incorrect information log
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {audit.incorrect_info.filter((d) => d.severity === "High").length} High ·{" "}
            {audit.incorrect_info.filter((d) => d.severity === "Medium").length} Medium ·{" "}
            {audit.incorrect_info.filter((d) => d.severity === "Low").length} Low — every known error in
            the record, with the correction route. Use the Social &amp; comms tab to send the
            rectification letters and keep the reply trail here.
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {audit.incorrect_info.map((d: IncorrectInfoItem) => {
            const Icon = SEV_ICON[d.severity];
            const open = openDq === d.id;
            return (
              <div key={d.id} className="rounded-lg border">
                <button onClick={() => dqToggle(d.id)} className="flex w-full items-start gap-3 px-3.5 py-3 text-left">
                  <Badge variant="outline" className={`mt-0.5 shrink-0 text-[11px] ${SEV_STYLE[d.severity]}`}>
                    <Icon className="mr-1 h-3 w-3" />
                    {d.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{d.id}</span>
                      <span className="text-[13.5px] font-semibold text-foreground">{d.item}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Status: {d.status}
                    </div>
                  </div>
                  {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
                {open && (
                  <div className="space-y-2.5 border-t px-3.5 py-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
                        <div className="text-xs font-semibold text-red-800">What the record says</div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">{d.recorded}</p>
                      </div>
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
                        <div className="text-xs font-semibold text-emerald-800">Reality / what the family says</div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">{d.reality}</p>
                      </div>
                    </div>
                    {d.also && (
                      <p className="text-[12.5px] leading-relaxed text-foreground/85">
                        <strong>Also:</strong> {d.also}
                      </p>
                    )}
                    {d.actions.length > 0 && (
                      <ul className="space-y-1">
                        {d.actions.map((a, i) => (
                          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Alzheimer's investigation */}
      <Card className="border-violet-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-violet-900">
            <Brain className="h-4 w-4 text-violet-700" />
            Alzheimer&apos;s — does the portal data show it, and do carers know?
          </CardTitle>
          <p className="text-[13px] leading-relaxed text-foreground/85">{audit.alzheimer.short_answer}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-md border p-2.5 text-[13px]">
              <Pill className="h-4 w-4 shrink-0 text-violet-600" />
              <span>
                <strong>Memantine 20 mg</strong> — active since {fmtDate(audit.alzheimer.med_spans.memantine?.from || "")}
                {" "}(Alzheimer&apos;s-specific, NICE TA217)
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md border p-2.5 text-[13px]">
              <Pill className="h-4 w-4 shrink-0 text-violet-600" />
              <span>
                <strong>Risperidone 500 mcg–1 mg</strong> — active since {fmtDate(audit.alzheimer.med_spans.risperidone?.from || "")}
                {" "}(dementia-related distress, NICE NG97)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/60 text-left">
                  <th className="px-3 py-2 font-semibold">Signal</th>
                  <th className="px-3 py-2 font-semibold">Weight</th>
                  <th className="px-3 py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.alzheimer.signals.map((s, i) => (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="px-3 py-2 font-medium">{s.type}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`text-[11px] ${WEIGHT_STYLE[s.weight] || ""}`}>
                        {s.weight}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 leading-relaxed text-foreground/85">{s.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Memory clinic in the notes
              </div>
              {audit.alzheimer.note_quotes.memory_clinic.map((q, i) => (
                <NoteQuote key={i} date={q.date} note={q.note} />
              ))}
              {audit.alzheimer.note_quotes.memory_clinic.length === 0 && (
                <p className="text-xs text-muted-foreground">No notes found.</p>
              )}
              <div className="pt-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Dementia nurse in the notes
              </div>
              {audit.alzheimer.note_quotes.dementia_nurse.map((q, i) => (
                <NoteQuote key={i} date={q.date} note={q.note} />
              ))}
              {audit.alzheimer.note_quotes.dementia_nurse.length === 0 && (
                <p className="text-xs text-muted-foreground">No notes found.</p>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Confusion episodes recorded by carers (sample)
              </div>
              {audit.alzheimer.note_quotes.confusion.slice(0, 4).map((q, i) => (
                <NoteQuote key={i} date={q.date} note={q.note} />
              ))}
            </div>
          </div>

          <div className="rounded-md border border-violet-200 bg-violet-50/70 p-3">
            <div className="text-xs font-semibold text-violet-900">Verdict</div>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{audit.alzheimer.verdict}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-teal-900">Staff awareness — what the record shows</div>
              <ul className="space-y-1">
                {audit.alzheimer.staff_awareness.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-teal-900">Do this next</div>
              <ul className="space-y-1">
                {audit.alzheimer.actions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    {s}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onNavigate("social")}>
                Open the GP confirmation letter template →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alex */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <UserSearch className="h-4 w-4 text-teal-700" />
            Alex — mentioned, but missing from the record
          </CardTitle>
          <p className="text-[13px] leading-relaxed text-foreground/85">{audit.alex.answer}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="text-[11px]">
              {audit.alex.mentions_in_notes} carer notes mention him
            </Badge>
            <Badge variant="outline" className={`text-[11px] ${audit.alex.in_contacts ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-red-200 bg-red-100 text-red-800"}`}>
              {audit.alex.in_contacts ? "In contacts list" : "NOT in the contacts list"}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              “Next of Kin 1” slot: empty
            </Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {alexQuotes.map((q, i) => (
              <NoteQuote key={i} date={q.date} note={q.note} />
            ))}
          </div>
          {audit.alex.quotes.length > 4 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAllAdam((v) => !v)}>
              {showAllAdam ? "Show fewer" : `Show all ${audit.alex.quotes.length} mentions`}
            </Button>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Fix route: include Alex in the Article 16 rectification letter (Social &amp; comms tab)
            as the correct next of kin, and ask the office to confirm who should be contacted
            first out-of-hours.
          </p>
        </CardContent>
      </Card>

      {/* change attribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <History className="h-4 w-4 text-teal-700" />
            Who changed the next-of-kin information?
          </CardTitle>
          <p className="text-[13px] leading-relaxed text-foreground/85">{audit.change_attribution.answer}</p>
        </CardHeader>
        <CardContent>
          <div className="mb-1 text-xs font-semibold text-teal-900">Ways to find out</div>
          <ul className="space-y-1">
            {audit.change_attribution.routes.map((r, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/90">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {r}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
