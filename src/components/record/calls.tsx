"use client";

// Calls & evidence tab — the family call archive as a first-class evidence
// surface. Searchable transcripts, evidence highlights, audited copying, and
// the contact-volume early-warning panel (Systems Review §5.1).

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowDownLeft, ArrowUpRight, Check, Copy, FileAudio, PhoneCall, Search,
  Siren, TriangleAlert,
} from "lucide-react";
import {
  type CallsData, type CallLogEntry, CATEGORIES, RESPONSE_LADDER, spikeStatus,
} from "@/lib/calls";
import type { SysAuditAction } from "@/lib/auditlog";

interface CallsProps {
  data: CallsData;
  actorName: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

export default function Calls({ data, actorName, onAudit }: CallsProps) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.calls]
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) * -1)
      .filter((c) => (cat === "all" ? true : c.category === cat))
      .filter((c) =>
        q === ""
          ? true
          : c.subject.toLowerCase().includes(q) ||
            c.party.toLowerCase().includes(q) ||
            c.transcript.toLowerCase().includes(q) ||
            c.highlights.some((h) => h.toLowerCase().includes(q))
      );
  }, [data.calls, query, cat]);

  const spike = useMemo(() => spikeStatus(data.contactDaily, 3), [data.contactDaily]);

  const totals = useMemo(() => {
    const inbound = data.contactDaily.reduce((a, d) => a + d.inbound, 0);
    const days = data.contactDaily.length || 1;
    const maxDay = [...data.contactDaily].sort((a, b) => b.inbound - a.inbound)[0];
    return {
      inbound,
      mean: Math.round((inbound / days) * 10) / 10,
      maxDay,
      escalated: data.calls.filter((c) => c.escalated).length,
    };
  }, [data]);

  const copyTranscript = async (c: CallLogEntry) => {
    const text = [
      `CALL LOG — ${fmtDate(c.date)} ${c.time} (${c.direction} · ${c.durationMin} min)`,
      `Party: ${c.party} (${c.number})`,
      `Subject: ${c.subject}`,
      "",
      "TRANSCRIPT EXCERPT:",
      c.transcript,
      "",
      "EVIDENCE HIGHLIGHTS:",
      ...c.highlights.map((h) => `• ${h}`),
      "",
      `Copied by ${actorName} from the family care hub · ${new Date().toLocaleString("en-GB")} · sample data`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
      onAudit("calls.copy", `${c.date} ${c.party}`, "call transcript + evidence highlights copied to clipboard", "notice");
    } catch {
      /* clipboard unavailable */
    }
  };

  const maxBar = Math.max(...data.contactDaily.map((d) => d.inbound), 1);

  return (
    <div className="space-y-4">
      {/* summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <PhoneCall className="h-8 w-8 text-teal-700" />
            <div>
              <p className="text-2xl font-bold leading-none">{data.counts.callsLogged}</p>
              <p className="text-xs text-muted-foreground">calls logged (sample subset of {data.counts.archiveTotal})</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold leading-none">{totals.mean}</p>
            <p className="text-xs text-muted-foreground">mean inbound contacts/day ({data.coverage.from.slice(5)} → {data.coverage.to.slice(5)})</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold leading-none">{totals.escalated}</p>
            <p className="text-xs text-muted-foreground">calls flagged as multi-agency escalations</p>
          </CardContent>
        </Card>
        <Card className={spike.spikeDay ? "border-rose-300 bg-rose-50/50 dark:bg-rose-950/20" : ""}>
          <CardContent className="p-4">
            <p className="text-2xl font-bold leading-none">{spike.spikeDay ? spike.spikeDay.inbound : totals.maxDay?.inbound ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              peak inbound day{spike.spikeDay ? ` — ${spike.spikeDay.date} (documented spike)` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* early-warning panel */}
      <Card className="border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-amber-900">
            <Siren className="h-4 w-4 text-amber-700" /> Early warning — inbound contact-volume spike
          </CardTitle>
          <CardDescription>
            Family contact volume is a leading indicator, not noise (Systems Review §5.1). A rule fires
            when inbound contacts exceed <strong>3× the trailing 14-day mean</strong> (floor 2/day), with
            composite confirmation against pain flags, confusion flags, visit gaps and tracker exits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-20 items-end gap-[3px]" aria-hidden>
            {data.contactDaily.map((d) => {
              const isSpike = d.inbound >= 18;
              const h = Math.max(6, Math.round((d.inbound / maxBar) * 100));
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.inbound} inbound / ${d.outbound} outbound${d.note ? ` — ${d.note}` : ""}`}
                  className={`flex-1 rounded-t ${isSpike ? "bg-rose-500" : "bg-teal-600/70"}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="border-rose-400 bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              documented spike: {spike.spikeDay ? `${spike.spikeDay.inbound} calls on ${spike.spikeDay.date}` : "none in window"}
            </Badge>
            <span>{spike.spikeDay?.note || "The spike day sits far beyond any threshold and would have fired the rule hours before the day's peak."}</span>
          </div>
          <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
            {RESPONSE_LADDER.map((r) => (
              <p key={r.step} className="rounded-lg border bg-white/70 p-2 dark:bg-transparent">
                <span className="font-semibold text-foreground/80">{r.step}:</span> {r.detail}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* search + filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileAudio className="h-4 w-4 text-teal-700" /> Calls &amp; evidence log
          </CardTitle>
          <CardDescription>{data.note}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts, parties, subjects, highlights…"
                className="pl-8"
                aria-label="Search the call log"
              />
            </div>
            <Tabs value={cat} onValueChange={setCat}>
              <TabsList className="flex h-9 w-full flex-wrap gap-1 sm:w-auto">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c} className="text-xs">
                    {c.replace("Adult social care", "ASC").replace("Community health", "Health")}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No calls match “{query}”.</p>
            )}
            {filtered.map((c) => (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={c.direction === "inbound" ? "outline" : "secondary"} className="gap-1 text-[11px]">
                    {c.direction === "inbound" ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {c.direction}
                  </Badge>
                  <span className="text-sm font-semibold">{fmtDate(c.date)} · {c.time}</span>
                  <span className="text-sm text-muted-foreground">{c.party}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.number}</span>
                  <Badge variant="outline" className="text-[10px]">{c.category}</Badge>
                  <Badge variant="outline" className="text-[10px]">{c.durationMin} min</Badge>
                  {c.escalated && (
                    <Badge className="border-rose-200 bg-rose-100 text-[10px] text-rose-800" variant="outline">
                      <TriangleAlert className="mr-1 h-3 w-3" /> escalation
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() => copyTranscript(c)}
                  >
                    {copiedId === c.id ? (
                      <><Check className="mr-1 h-3 w-3 text-emerald-600" /> Copied</>
                    ) : (
                      <><Copy className="mr-1 h-3 w-3" /> Copy</>
                    )}
                  </Button>
                </div>
                <p className="mt-1.5 text-sm font-medium">{c.subject}</p>
                <p className="mt-1 text-sm leading-relaxed text-foreground/85">{c.transcript}</p>
                {c.highlights.length > 0 && (
                  <ul className="mt-2 space-y-0.5 rounded-lg bg-teal-50/60 p-2.5 text-xs text-foreground/80 dark:bg-teal-950/20">
                    {c.highlights.map((h, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="font-bold text-teal-700">•</span> {h}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <p className="rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 text-xs text-muted-foreground dark:bg-teal-950/20">
            Provenance: sample data (depersonalised). Copying is audit-logged — every exported excerpt
            becomes part of the family&apos;s contemporaneous evidence trail. The family&apos;s phone
            bill is clinical telemetry; log every call.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
