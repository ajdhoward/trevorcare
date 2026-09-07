"use client";

import { useMemo, useState } from "react";
import {
  Lightbulb,
  Mail,
  Copy,
  Check,
  FileDown,
  RefreshCcw,
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  ClipboardList,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type RecommendationItem } from "@/lib/record";
import { chat, loadSettings, isConfigured, emailMessages, recordDigest } from "@/lib/ai/engine";

const PRIORITY_STYLE: Record<string, string> = {
  High: "border-red-200 bg-red-100 text-red-800",
  Medium: "border-amber-200 bg-amber-100 text-amber-800",
  Low: "border-teal-200 bg-teal-100 text-teal-800",
};

const PRIORITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  High: AlertTriangle,
  Medium: CircleAlert,
  Low: CircleCheck,
};

const RECIPIENTS: Record<string, { label: string; hint: string }> = {
  office: {
    label: "the care agency office",
    hint: "Ask the agency to act on the selected recommendations and adopt the updated care plan.",
  },
  gp: {
    label: "GP (the GP surgery)",
    hint: "Clinical items: pain review, medication questions, cognition pathway, anticoagulant monitoring.",
  },
  cmht: {
    label: "Mental health team (the mental-health team)",
    hint: "Delusional disorder review, Risperidone questions, respite continuity.",
  },
  family: {
    label: "Family update",
    hint: "A one-page summary for Alex, Contact B or the wider family with the latest findings.",
  },
};

export default function Recommendations({
  recs,
  onNavigate,
  auditDigest,
}: {
  recs: RecommendationItem[];
  onNavigate: (tab: string) => void;
  auditDigest?: string | null;
}) {
  const [filter, setFilter] = useState<"All" | "High" | "Medium" | "Low">("All");
  const [selected, setSelected] = useState<string[]>(recs.filter((r) => r.priority === "High").map((r) => r.id));
  const [recipient, setRecipient] = useState("office");
  const [copied, setCopied] = useState(false);
  const [aiBody, setAiBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  const shown = useMemo(
    () => recs.filter((r) => filter === "All" || r.priority === filter),
    [recs, filter]
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const chosen = recs.filter((r) => selected.includes(r.id));

  const subject = useMemo(
    () => `Dad - care record review: ${chosen.length} recommendation${chosen.length === 1 ? "" : "s"} (September 2026)`,
    [chosen]
  );

  const body = useMemo(() => {
    const lines: string[] = [];
    lines.push("Hello,");
    lines.push("");
    lines.push(
      recipient === "gp"
        ? "Following a review of Dad's complete domiciliary care record (Oct 2025 - Sep 2026, DOB 01/01/1947, address 1 Sample Road, Market Town AB1 2CD), I would like to raise the following:"
        : recipient === "cmht"
        ? "Following a review of Dad's complete care record (Oct 2025 - Sep 2026), I would like to raise the following with the team supporting his mental health:"
        : recipient === "family"
        ? "Here is a summary of the latest review of Dad's care records (Oct 2025 - Sep 2026) and what we should be asking for:"
        : "Following a review of Dad's complete care record (Oct 2025 - Sep 2026), we would like to ask you to action the following recommendations and confirm your plan for each:"
    );
    lines.push("");
    chosen.forEach((r, i) => {
      lines.push(`${i + 1}. [${r.priority.toUpperCase()}] ${r.title}`);
      lines.push(`   Why: ${r.rationale}`);
      r.actions.forEach((a) => lines.push(`   Action: ${a}`));
      lines.push(`   Evidence: ${r.evidence_refs}`);
      lines.push("");
    });
    lines.push("The updated care plan (6 September 2026) covering these points is attached / available on request.");
    lines.push("");
    lines.push("Thank you,");
    lines.push("Dad's family");
    lines.push("Alex (son) — [your phone] · Contact B 07700 900002");
    return lines.join("\n");
  }, [chosen, recipient]);

  const displayBody = aiBody || body;

  const draftWithAI = async () => {
    setDrafting(true);
    setDraftNote("");
    try {
      const settings = loadSettings();
      if (!isConfigured(settings)) {
        setDraftNote(
          "AI engine not configured — showing the built-in template. Open the AI assistant tab to add a provider (keys stay in your browser)."
        );
        setAiBody("");
        return;
      }
      const r = RECIPIENTS[recipient];
      const text = await chat(
        settings,
        emailMessages({
          digest: recordDigest(null, null, recs) + (auditDigest ? `\n\n[AUDIT]\n${auditDigest}` : ""),
          recipientLabel: r.label,
          recipientContext: r.hint,
          subject,
          points: chosen.map((x) => `${x.title} — ${x.rationale} Actions: ${x.actions.join("; ")} Evidence: ${x.evidence_refs}`),
          tone: "firm, courteous, factual",
          senderName: "Alex (son)",
        })
      );
      setAiBody(text);
    } catch (e) {
      setDraftNote(`AI drafting failed: ${(e as Error).message} — template shown instead.`);
      setAiBody("");
    } finally {
      setDrafting(false);
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(displayBody)}`;

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${displayBody}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/50">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600">
            <Lightbulb className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-amber-900">
              Recommendations from the full-record review
            </h2>
            <p className="text-xs text-muted-foreground">
              {recs.filter((r) => r.priority === "High").length} High ·{" "}
              {recs.filter((r) => r.priority === "Medium").length} Medium ·{" "}
              {recs.filter((r) => r.priority === "Low").length} Low — each with the evidence that
              generated it and concrete actions. Tick recommendations to build an email.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* priority filter */}
      <div className="flex flex-wrap gap-1.5">
        {(["All", "High", "Medium", "Low"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filter === p
                ? "border-teal-700 bg-teal-800 text-white"
                : "border-border bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-800"
            }`}
          >
            {p === "All" ? `All (${recs.length})` : `${p} (${recs.filter((r) => r.priority === p).length})`}
          </button>
        ))}
      </div>

      {/* recommendation cards */}
      <div className="space-y-3">
        {shown.map((r) => {
          const Icon = PRIORITY_ICON[r.priority];
          const checked = selected.includes(r.id);
          return (
            <Card key={r.id} className={checked ? "border-teal-400 shadow-sm" : ""}>
              <CardContent className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(r.id)}
                    className="mt-1"
                    aria-label={`Include ${r.title} in email`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {r.id}
                      </span>
                      <span className="text-[15px] font-bold text-teal-900">{r.title}</span>
                      <Badge variant="outline" className={`text-[11px] ${PRIORITY_STYLE[r.priority]}`}>
                        <Icon className="mr-1 h-3 w-3" />
                        {r.priority}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] text-muted-foreground">
                        {r.category}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">{r.rationale}</p>
                    <div className="mt-2 rounded-md border border-teal-200 bg-teal-50/60 p-2.5">
                      <div className="text-xs font-semibold text-teal-900">Actions</div>
                      <ul className="mt-1 space-y-1">
                        {r.actions.map((a, i) => (
                          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-foreground/90">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        <strong>Evidence:</strong> {r.evidence_refs}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* email generator */}
      <Card className="border-teal-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Mail className="h-4 w-4 text-teal-700" />
            Generate an email
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick a recipient and the recommendations above — the email drafts itself with the
            evidence included. No email addresses are stored in the record, so send from your own
            mailbox: open in your mail app or copy the text.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Recipient" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RECIPIENTS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="border-teal-200 bg-white text-xs text-teal-900">
              {chosen.length} selected
            </Badge>
            <span className="text-xs text-muted-foreground">{RECIPIENTS[recipient].hint}</span>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border bg-teal-50/40 p-3">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Subject: {subject}</div>
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{displayBody}</pre>
          </div>
          {draftNote && <p className="text-xs leading-relaxed text-amber-700">{draftNote}</p>}
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-teal-800 hover:bg-teal-700">
              <a href={mailto}>
                <Mail className="mr-1.5 h-4 w-4" />
                Open in email app
              </a>
            </Button>
            <Button variant="outline" onClick={copyBody}>
              {copied ? (
                <>
                  <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy email text
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
            {aiBody && (
              <Button variant="ghost" onClick={() => { setAiBody(""); setDraftNote(""); }}>
                Back to template
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelected(recs.map((r) => r.id))}>
              Select all
            </Button>
            <Button variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
          <div className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
            Useful addresses from the record: the GP surgery 01632 960001 · District Nurses
            01632 960002 · the mental-health team (the mental-health worker, mental health worker) 01632 960003 ·
            the local pharmacy 01632 960006. Family: Contact B 07700 900002. Note: Contact A is recorded
            as next of kin in the portal but this is being corrected (Records audit tab) — Alex
            Family (son) is the primary family contact.
          </div>
        </CardContent>
      </Card>

      {/* care plan regeneration */}
      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-teal-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-violet-900">
            <RefreshCcw className="h-4 w-4 text-violet-700" />
            Regenerated care plan (6 September 2026)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] leading-relaxed text-foreground/85">
            The original care plan (support plans reviewed 15 April 2026) has been regenerated with
            every change the data review supports, so the agency can adopt it directly. It is a
            7-page PDF covering: well-being snapshot, conditions table, all four daily routines, the
            twelve person-centred support plans with amber <em>Update September 2026</em> amendment
            boxes, the escalation trigger watch list, the twelve recommendations, and the Mental
            Health Act / Mental Capacity Act notes.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              "Hearing-aid check becomes a recorded task at every morning call (67 flags)",
              "Pain location recorded with every report; GP pain review requested (96 pain flags)",
              "Food & fluid: 2+ days of refused meals is now a same-day escalation trigger (426 decline notes)",
              "Variable-dose Risperidone (500 mcg AM / 1 mg PM) highlighted with do-not-swap warning",
              "Shower-pole repair verification and OT referral added to the environment plan",
              "eMAR app failures to be reported and paper MAR audited within 48 hours (74 events)",
            ].map((t) => (
              <div key={t} className="flex gap-2 rounded-md border border-violet-200 bg-white p-2.5 text-[13px]">
                <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
                {t}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-violet-700 hover:bg-violet-600">
              <a
                href={`/downloads/documents/${encodeURIComponent("Care Plan - Dad (updated 06-09-2026).pdf")}`}
                download
              >
                <FileDown className="mr-1.5 h-4 w-4" />
                Download updated care plan (PDF)
              </a>
            </Button>
            <Button asChild variant="outline">
              <a
                href={`/downloads/documents/${encodeURIComponent("Care Plan - Dad (generated 05-09-2026).pdf")}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Compare: previous version (05-09-2026)
              </a>
            </Button>
            <Button variant="ghost" onClick={() => onNavigate("documents")}>
              All documents →
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Next step for the family: send it to the care agency office with recommendation R9
            selected above, and ask for it to be re-issued to all regular carers and the respite
            service before the October 2026 review.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
