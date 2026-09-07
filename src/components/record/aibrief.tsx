"use client";

// AI review bridge — exports a single AI-efficient brief covering BOTH parents
// (compact markdown + embedded JSON), specifies the feedback contract, and
// ingests the AI's reply by paste or file upload; items can then be applied
// into the live stores (tasks, shopping, review queue) with audit entries.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BadgeCheck, Bot, ClipboardPaste, Download, FileUp, Inbox, Sparkles, Trash2 } from "lucide-react";
import type { CareRecord } from "@/lib/record";
import { type MyTask, type ShoppingItem, type MumContact, type MumWellbeingEntry } from "@/lib/family";
import { type FeedbackItem, extractFeedbackItems, FEEDBACK_KIND_LABEL } from "@/lib/feedback";
import { dcpiScore, dcpiBand, type DcpiInputs, abcStore, checkInStore } from "@/lib/haven360";
import type { SysAuditAction } from "@/lib/auditlog";
import { uid } from "@/lib/family";

export interface AiBriefProps {
  record: CareRecord;
  tasks: MyTask[];
  shopping: ShoppingItem[];
  mumContacts: MumContact[];
  mumWellbeing: MumWellbeingEntry[];
  actorName: string;
  onTasksChange: (t: MyTask[]) => void;
  onShoppingChange: (s: ShoppingItem[]) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

interface FeedbackRow {
  id: string;
  title: string;
  source: string;
  status: string;
  createdAt: string;
  parsed: FeedbackItem[];
}

const CONTRACT = `Return your findings as one or more fenced JSON blocks. Allowed item kinds:

\`\`\`json
[
  {"kind": "task_add", "title": "Book hearing-aid review", "detail": "why", "person": "dad", "due": "2026-09-20"},
  {"kind": "shopping_add", "item": "Bleach", "person": "dad"},
  {"kind": "recommendation", "title": "…", "priority": "High", "rationale": "…", "actions": ["…"]},
  {"kind": "note", "text": "…", "severity": "warning"},
  {"kind": "correction", "field": "next_of_kin", "value": "…", "evidence": "…"},
  {"kind": "question", "title": "…", "detail": "…"}
]
\`\`\`

Rules: person is dad | mum | family. priority is High | Medium | Low. severity is info | warning | urgent. Quote evidence from the brief for every recommendation. Do not invent data that is not in the brief.`;

export default function AiBrief({ record, tasks, shopping, mumContacts, mumWellbeing, actorName, onTasksChange, onShoppingChange, onAudit }: AiBriefProps) {
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRows = async () => {
    try {
      const res = await fetch("/api/ai/ingest");
      const json = await res.json();
      setRows(json.feedback ?? []);
    } catch {
      /* offline */
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const brief = useMemo(() => {
    const flags30 = record.flags.filter((f) => f.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const themeCount = new Map<string, number>();
    for (const f of flags30) for (const k of f.kw) themeCount.set(k, (themeCount.get(k) ?? 0) + 1);
    const topThemes = [...themeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const medExceptions30 = record.med_events.filter((m) => m.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).length;
    const absences30 = record.absences.filter((a) => a.from >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).length;
    const abc = abcStore.load();
    const lastCheckin = checkInStore.load()[0];
    const dcpiInputs: DcpiInputs = { ...{ wandering: 2, disorientation: 3, weightLoss: 3, hydrationDays: 4, medsRefused: 2, nightDisturbance: 3, burnout: lastCheckin?.burnout ?? 4 } };
    const dcpi = dcpiScore(dcpiInputs);
    const dcpiB = dcpiBand(dcpi);
    const openTasks = tasks.filter((t) => !t.done);
    const mumW = mumWellbeing[0];

    const md: string[] = [];
    md.push("# Family family — AI care review brief");
    md.push("");
    md.push(`Generated ${new Date().toLocaleString("en-GB")} by the Family Care Hub for ${actorName}.`);
    md.push("Purpose: independent review of how Dad (dad, home care) and Mum (mum, residential care) are being looked after, with actionable feedback the family can apply directly in the portal.");
    md.push("");
    md.push("## Dad — Dad (home care, the care agency, Council)");
    md.push(`- Record coverage: ${record.hist.length.toLocaleString("en-GB")} visits, ${record.flags.length.toLocaleString("en-GB")} flagged notes, ${record.med_events.length.toLocaleString("en-GB")} medication exceptions (full history Oct 2025 → Sep 2026).`);
    md.push(`- Current medication: ${record.meds.length} active items incl. Memantine 20mg and Risperidone 0.5-1mg (dementia-signposting — see known issues).`);
    md.push(`- Last 30 days: ${topThemes.map(([k, n]) => `${k} (${n})`).join(", ") || "no flagged themes"}; ${medExceptions30} dose exceptions; ${absences30} absence/cancellation rows.`);
    md.push(`- DCPI (family-computed): ${dcpi}/100 — ${dcpiB.label}. ${dcpiB.advice}`);
    md.push(`- Open family tasks: ${openTasks.length}${openTasks.length ? " — " + openTasks.slice(0, 8).map((t) => t.title).join("; ") : ""}.`);
    md.push(`- Known data-quality issues: DQ-1 next-of-kin lists Contact A (niece-in-law) — family-verified wrong, Kin-1 slot empty; Alzheimer's never named in the record despite Memantine/Risperidone/memory-clinic evidence (DQ log in Records audit tab).`);
    md.push(`- Family ABC episodes logged: ${abc.length}; last check-in burnout: ${lastCheckin?.burnout ?? "n/a"}/10 (confidential).`);
    md.push("");
    md.push("## Mum — Mum's care home, the care-home group, Council)");
    md.push(`- Family contact log entries: ${mumContacts.length}${mumContacts[0] ? `, most recent ${mumContacts[0].date} (${mumContacts[0].type})` : ""}.`);
    md.push(`- Family well-being tracker: ${mumWellbeing.length} entries${mumW ? `, latest score ${mumW.score}/5 on ${mumW.date}` : ""}.`);
    md.push("- The care home has no portal — contact protocol is email/phone/WhatsApp (templates in Mum's care tab); no independent care data is available to the family, which is itself a finding to address.");
    md.push("");
    md.push("## Data you may reference (available in the full bundle, not attached here)");
    md.push("- Care_Record_Workbook_Sample.xlsx (formatted master), CSV extracts (10 files), insights/*.json (well-being, flag analytics, conditions, recommendations, records audit, API catalog), care plan PDF, 15+ policies.");
    md.push("");
    md.push("## Feedback contract — how to answer");
    md.push(CONTRACT);
    md.push("");
    md.push("Known issues to check specifically: next-of-kin accuracy; Alzheimer's diagnosis provenance; declining-care pattern and safeguarding thresholds; s17/s117 applicability; medication exception clusters; visit-consistency vs package.");
    return md.join("\n");
  }, [record, tasks, mumContacts, mumWellbeing, actorName]);

  const download = () => {
    const blob = new Blob([brief], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AI_review_brief_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    onAudit("export.file", "AI review brief", `AI-efficient brief exported (${brief.length.toLocaleString("en-GB")} chars) covering both parents + feedback contract`);
  };

  const ingest = async (text: string, source: "paste" | "file", fileName = "") => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source, fileName, title: `AI review — ${new Date().toLocaleDateString("en-GB")}` }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ingest failed.");
      onAudit("feedback.ingest", "AI feedback", `${json.items.length} structured item(s) ingested from ${source}${fileName ? ` (${fileName})` : ""}`, "notice");
      setPaste("");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File) => {
    const text = await f.text();
    await ingest(text, "file", f.name);
  };

  const applyItem = (rowId: string, it: FeedbackItem) => {
    if (it.kind === "task_add") {
      const t: MyTask = {
        id: uid("task"), title: it.title ?? "AI-suggested task", notes: it.detail,
        forWhom: (it.person as MyTask["forWhom"]) ?? "family", category: "other",
        due: it.due ?? new Date().toISOString().slice(0, 10), assignee: "alex", done: false,
        created: new Date().toISOString().slice(0, 10), source: "manual",
      };
      onTasksChange([t, ...tasks]);
    } else if (it.kind === "shopping_add" && it.item) {
      const s: ShoppingItem = {
        id: uid("shop"), name: it.item, addedBy: "AI review", addedVia: "manual",
        needed: true, created: new Date().toISOString().slice(0, 10), forWhom: (it.person as ShoppingItem["forWhom"]) ?? "dad",
      };
      onShoppingChange([s, ...shopping]);
    } else {
      const t: MyTask = {
        id: uid("task"), title: `Review AI ${FEEDBACK_KIND_LABEL[it.kind].toLowerCase()}: ${it.title ?? it.item ?? (it.detail ?? "").slice(0, 60)}`,
        notes: [it.rationale, it.evidence ? `Evidence: ${it.evidence}` : "", it.detail].filter(Boolean).join("\n"),
        forWhom: "family", category: "review", due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        assignee: "alex", done: false, created: new Date().toISOString().slice(0, 10), source: "manual",
      };
      onTasksChange([t, ...tasks]);
    }
    onAudit("feedback.apply", FEEDBACK_KIND_LABEL[it.kind], `Applied: ${(it.title ?? it.item ?? it.detail ?? "").slice(0, 90)}`, "notice");
    void rowId;
  };

  const setStatus = async (row: FeedbackRow, status: string) => {
    await fetch("/api/ai/ingest", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, status }),
    });
    await loadRows();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-5 w-5 text-teal-700" /> AI review brief — both parents, feedback loop closed</CardTitle>
          <CardDescription>
            One efficient, AI-shaped export covering how Mum and Dad are cared for, the known issues, and the exact JSON
            contract for the AI&apos;s reply. Paste the reply back here (or upload its file) and apply each finding straight into
            the portal. Full guide: <code>docs/AI-REVIEW-GUIDE.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea readOnly value={brief} className="min-h-72 font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={download} className="bg-teal-800 hover:bg-teal-700"><Download className="mr-1.5 h-4 w-4" /> Download brief (.md)</Button>
            <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(brief); } catch { /* ignore */ } }}>
              <ClipboardPaste className="mr-1.5 h-4 w-4" /> Copy brief
            </Button>
            <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(CONTRACT); }}><Bot className="mr-1.5 h-4 w-4" /> Copy feedback contract</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Inbox className="h-4 w-4 text-teal-700" /> Bring the AI&apos;s feedback in</CardTitle>
          <CardDescription>Paste the AI reply or upload its file — structured JSON items are detected automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} className="min-h-28 font-mono text-xs" placeholder="Paste the AI's full reply here — fenced ```json blocks are parsed…" />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => ingest(paste, "paste")} disabled={busy || !paste.trim()} className="bg-teal-800 hover:bg-teal-700">Ingest feedback</Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <FileUp className="h-4 w-4" /> Upload .md / .json
              <input type="file" accept=".md,.markdown,.json,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
            </label>
            {error && <span className="text-sm text-rose-600">{error}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Feedback inbox</CardTitle>
          <CardDescription>Apply items into the portal, or dismiss. Every application is audited.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && <p className="text-xs text-muted-foreground">No AI feedback ingested yet.</p>}
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{row.title} <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">{row.source}</Badge></p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={row.status === "applied" ? "border-emerald-300 text-emerald-700" : row.status === "dismissed" ? "text-muted-foreground" : "border-amber-300 text-amber-700"}>
                    {row.status}
                  </Badge>
                  {row.status === "received" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setStatus(row, "applied")}><BadgeCheck className="mr-1 h-3.5 w-3.5" /> Mark applied</Button>
                      <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setStatus(row, "dismissed")}><Trash2 className="mr-1 h-3.5 w-3.5" /> Dismiss</Button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {row.parsed.length === 0 && <p className="text-xs text-muted-foreground">No structured items detected — the raw text is stored for reference.</p>}
                {row.parsed.map((it, i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{FEEDBACK_KIND_LABEL[it.kind]}{it.priority && it.kind === "recommendation" ? ` · ${it.priority}` : ""}</p>
                      <p className="text-xs">{it.title ?? it.item ?? it.detail ?? ""}{it.rationale ? ` — ${it.rationale.slice(0, 140)}` : ""}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => applyItem(row.id, it)}>Apply → portal</Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
