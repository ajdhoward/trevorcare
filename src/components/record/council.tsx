"use client";

// Council Adult Social Care data-point — feeds the council ASC policy sources in,
// runs contravention checks (statutory duty → portal data → status), gives the
// escalation ladder with real the council routes, and lets the family paste council
// policy text in to extract trackable commitments.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Landmark, ListChecks, ScrollText, Send, ShieldAlert, Upload } from "lucide-react";
import type { CareRecord, DocInfo } from "@/lib/record";
import type { MumContact } from "@/lib/family";
import type { SysAuditAction } from "@/lib/auditlog";
import { uid } from "@/lib/haven360";

export interface CouncilProps {
  record: CareRecord;
  docs: DocInfo[];
  mumContacts: MumContact[];
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

interface CheckDef {
  id: string;
  title: string;
  dutyRef: string;
  severity: string;
  dataKey: string;
  howComputed: string;
  guidance: string;
}

interface CouncilData {
  council: Record<string, string>;
  policySources: { id: string; title: string; url: string; note: string; topic: string }[];
  duties: { id: string; ref: string; title: string; requires: string; portalEvidence: string }[];
  checks: CheckDef[];
  escalationLadder: { step: number; who: string; route: string; when: string }[];
  aiNote: string;
}

type Status = "pass" | "watch" | "breach" | "unknown";

const K_POLICY = "h360-roth-policies";
interface PolicyCommitment { id: string; source: string; text: string; added: string; done: boolean }

const fmt = new Intl.NumberFormat("en-GB");

export default function Council({ record, docs, mumContacts, onAudit }: CouncilProps) {
  const [data, setData] = useState<CouncilData | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [commitments, setCommitments] = useState<PolicyCommitment[]>([]);
  const [checkTs, setCheckTs] = useState<string>("");

  useEffect(() => {
    fetch("/data/council.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
    const id = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(K_POLICY);
        if (raw) setCommitments(JSON.parse(raw));
      } catch {
        /* ignore */
      }
      setCheckTs(new Date().toLocaleString("en-GB"));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const today = new Date();
  const cutoff = (days: number) => new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);

  const metrics = useMemo(() => {
    const inLast = (d: string, days: number) => d >= cutoff(days);
    const absences30 = record.absences.filter((a) => inLast(a.from, 30)).length;
    const medExceptions30 = record.med_events.filter((m) => inLast(m.date, 30)).length;
    const declined30 = record.flags.filter(
      (f) => inLast(f.date, 30) && /declin|refus|won'?t|not taken|denied/i.test(f.notes + " " + f.kw.join(" "))
    ).length;
    const carePlanDoc = docs
      .filter((d) => /care plan|support plan/i.test(d.file))
      .sort((a, b) => (a.file < b.file ? 1 : -1))[0]?.file ?? "";
    const advocacyMention = docs.some((d) => /advocacy|advocate|IMCA/i.test(d.file));
    const lastJane = mumContacts[0]?.date ?? "";
    return { absences30, medExceptions30, declined30, carePlanDoc, advocacyMention, lastJane };
  }, [record, docs, mumContacts]);

  const evaluate = (id: string): { status: Status; evidence: string } => {
    switch (id) {
      case "chk-plan-review":
        return {
          status: /updated 0?6-0?9-2026|generated 0?5-0?9-2026|april 2026/i.test(metrics.carePlanDoc) ? "pass" : "watch",
          evidence: `Newest plan on file: ${metrics.carePlanDoc || "none found"}. Care Act s.9 review is due at least annually for progressing dementia.`,
        };
      case "chk-missed-visits":
        return {
          status: metrics.absences30 >= 6 ? "breach" : metrics.absences30 >= 3 ? "watch" : "pass",
          evidence: `${fmt.format(metrics.absences30)} absence/cancellation rows in the last 30 days (watch ≥3, breach ≥6 without explanation).`,
        };
      case "chk-med-errors":
        return {
          status: metrics.medExceptions30 >= 6 ? "breach" : metrics.medExceptions30 >= 3 ? "watch" : "pass",
          evidence: `${fmt.format(metrics.medExceptions30)} eMAR dose exceptions in the last 30 days (watch ≥3, breach ≥6 or any same-medicine cluster).`,
        };
      case "chk-declined-care":
        return {
          status: metrics.declined30 >= 8 ? "breach" : metrics.declined30 >= 4 ? "watch" : "pass",
          evidence: `${fmt.format(metrics.declined30)} declined/refused-care flagged notes in the last 30 days — a sustained pattern is an s.42 enquiry trigger.`,
        };
      case "chk-nok-accuracy":
        return {
          status: "breach",
          evidence: "DQ-1 confirmed: portal lists Contact A (niece-in-law) as next of kin against the family's verified position, and the Kin-1 slot is empty. GDPR Art. 5(1)(d) accuracy + provider policy 129.",
        };
      case "chk-advocacy":
        return {
          status: metrics.advocacyMention ? "pass" : "watch",
          evidence: metrics.advocacyMention ? "Advocacy referenced in provider documents." : "No advocacy mention anywhere in the 24 portal documents — s.67 consideration should be documented.",
        };
      case "chk-family-involvement": {
        const recent = metrics.lastJane >= cutoff(14);
        return {
          status: recent ? "pass" : "watch",
          evidence: recent
            ? `Family communication active — Mum's log last entry ${metrics.lastJane}; WhatsApp ingest + comms log also contribute.`
            : "No family-communication evidence in the last 14 days — log contacts to build the involvement trail.",
        };
      }
      case "chk-charging":
        return {
          status: "unknown",
          evidence: "No billing/ledger data reaches the family portal (API catalog verdict: read-only, no billing endpoints). Check every council invoice; s.117 aftercare must never be charged.",
        };
      case "chk-mum-home": {
        if (!metrics.lastJane) return { status: "watch", evidence: "No contact logged yet — use Mum's care tab; watch at 7 days, breach at 14." };
        const days = Math.round((Date.now() - new Date(metrics.lastJane + "T00:00:00").getTime()) / 86400000);
        return {
          status: days >= 14 ? "breach" : days >= 7 ? "watch" : "pass",
          evidence: `${days} day(s) since the last logged contact with Mum's home (watch ≥7, breach ≥14).`,
        };
      }
      default:
        return { status: "unknown", evidence: "Check not computed." };
    }
  };

  const statusBadge = (s: Status) => {
    const map: Record<Status, { cls: string; label: string }> = {
      pass: { cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", label: "no contravention" },
      watch: { cls: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", label: "watch" },
      breach: { cls: "border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300", label: "potential breach" },
      unknown: { cls: "border-border text-muted-foreground", label: "no data — verify manually" },
    };
    return <Badge variant="outline" className={map[s].cls}>{map[s].label}</Badge>;
  };

  const ingestPolicy = () => {
    const text = policyText.trim();
    if (!text) return;
    const keywords = /must |should |will |ensure|review|safeguard|assessment|advocacy|charging|complaint|within \d+ (days|weeks)|annually|direct payment/gi;
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
    const hits = new Set<string>();
    for (const s of sentences) {
      keywords.lastIndex = 0;
      if (keywords.test(s)) hits.add(s.trim());
      if (hits.size >= 12) break;
    }
    const added: PolicyCommitment[] = [...hits].map((t) => ({
      id: uid("pc"), source: "Pasted council policy text", text: t, added: new Date().toISOString().slice(0, 10), done: false,
    }));
    const next = [...added, ...commitments].slice(0, 80);
    setCommitments(next);
    try {
      localStorage.setItem(K_POLICY, JSON.stringify(next));
    } catch { /* ignore */ }
    onAudit("policy.ingest", "the council policy text", `${added.length} commitment(s) extracted from ${text.length.toLocaleString("en-GB")} pasted characters`, "notice");
    setPolicyText("");
  };

  const toggleCommitment = (id: string) => {
    const next = commitments.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
    setCommitments(next);
    try {
      localStorage.setItem(K_POLICY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const runCheck = () => {
    const breach = data ? data.checks.filter((c) => evaluate(c.id).status === "breach").length : 0;
    onAudit("council.check", "the council ASC compliance", `Compliance check run — ${breach} potential breach(es), ${data?.checks.length ?? 0} checks evaluated`, breach ? "warning" : "info");
    setCheckTs(new Date().toLocaleString("en-GB"));
  };

  if (!data) return <p className="text-sm text-muted-foreground">Loading Council ASC policy register…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-5 w-5 text-teal-700" /> Council Adult Social Care — policy feed &amp; contravention watch</CardTitle>
          <CardDescription>
            {data.council.name} commissions and monitors Dad&apos;s home care and Mum&apos;s placement. This data-point feeds the council&apos;s
            policy routes in, maps statutory duties to portal evidence, and flags where practice may be contravening them.
            CQC rates the council&apos;s own ASC as <strong>Good</strong> (first assurance inspection, March 2026) — cite that when asking
            them to act. {data.council.verified}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Safeguarding (s.42)</p>
            <p className="mt-1 text-sm font-bold">{data.council.safeguardingPhone}</p>
            <a className="mt-1 flex items-center gap-1 text-xs text-teal-700 underline dark:text-teal-300" href={data.council.reportConcernUrl} target="_blank" rel="noreferrer">
              Report a concern about an adult <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Complaints</p>
            <p className="mt-1 break-all text-sm font-bold">{data.council.complaintsEmail}</p>
            <p className="text-xs text-muted-foreground">or text {data.council.complaintsText} · Healthwatch Council helps you write it</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Out of hours</p>
            <p className="mt-1 text-xs">{data.council.emergency}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm"><ListChecks className="h-4 w-4 text-teal-700" /> Contravention checks — duty vs portal evidence</CardTitle>
          <div className="flex items-center gap-2">
            {checkTs && <span className="text-[11px] text-muted-foreground">last run {checkTs}</span>}
            <Button size="sm" variant="outline" onClick={runCheck}><ScrollText className="mr-1 h-3.5 w-3.5" /> Run all checks</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.checks.map((c) => {
            const r = evaluate(c.id);
            return (
              <div key={c.id} className="rounded-lg border p-3">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.dutyRef} · severity: {c.severity}</p>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <p className="mt-1.5 text-xs">{r.evidence}</p>
                <p className="mt-1 text-[11px] text-muted-foreground"><strong>If it fails:</strong> {c.guidance}</p>
              </div>
            );
          })}
          <p className="pt-1 text-[11px] text-muted-foreground">{data.aiNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4 text-teal-700" /> Escalation ladder — real the council routes</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5">
            {data.escalationLadder.map((s) => (
              <li key={s.step} className="flex flex-col gap-0.5 rounded-lg border p-2.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-800 text-xs font-bold text-white">{s.step}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.who}</p>
                  <p className="text-xs text-muted-foreground">{s.route} · use when: {s.when}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">the council policy sources (feed)</CardTitle>
            <CardDescription>Open each, or paste policy text below to extract trackable commitments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.policySources.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block rounded-lg border p-2.5 hover:border-teal-400">
                <p className="flex items-center gap-1 text-sm font-medium">{p.title} <ExternalLink className="h-3 w-3 text-teal-700" /></p>
                <p className="text-xs text-muted-foreground">{p.note}</p>
              </a>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Upload className="h-4 w-4 text-teal-700" /> Policy ingest — paste council policy text</CardTitle>
            <CardDescription>
              Sentences containing commitment language (&quot;must&quot;, &quot;within 28 days&quot;, &quot;review annually&quot;…) become tracked
              obligations you can tick off — so their policies work for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} className="min-h-28" placeholder="Paste the council policy text, complaint responses, care contract clauses…" />
            <Button size="sm" onClick={ingestPolicy} disabled={!policyText.trim()} className="bg-teal-800 hover:bg-teal-700"><Send className="mr-1.5 h-3.5 w-3.5" /> Extract commitments</Button>
            {commitments.length > 0 && (
              <div className="max-h-64 space-y-1.5 overflow-y-auto pt-1">
                {commitments.map((c) => (
                  <button key={c.id} onClick={() => toggleCommitment(c.id)} className="w-full rounded-lg border p-2 text-left hover:border-teal-400">
                    <p className={`text-xs ${c.done ? "text-muted-foreground line-through" : ""}`}>{c.text}</p>
                    <p className="text-[10px] text-muted-foreground">{c.source} · added {c.added}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Duties → where the portal answers them</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            {data.duties.map((d) => (
              <div key={d.id} className="rounded-lg border p-2.5">
                <p className="text-sm font-medium">{d.title} <span className="text-xs font-normal text-muted-foreground">({d.ref})</span></p>
                <p className="mt-0.5 text-xs">{d.requires}</p>
                <p className="mt-0.5 text-[11px] text-teal-700 dark:text-teal-300">Portal evidence: {d.portalEvidence}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
