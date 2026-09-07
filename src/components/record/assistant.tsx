"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Settings2,
  Mail,
  Copy,
  Check,
  Sparkles,
  Loader2,
  CircleCheck,
  CircleX,
  RefreshCcw,
  FileQuestion,
  ClipboardList,
  KeyRound,
  CloudCog,
  ListChecks,
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
import { type CareRecord, type AuditData, type RecommendationItem } from "@/lib/record";
import {
  PROVIDER_META,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  isConfigured,
  chat,
  testConnection,
  gatewayEndpoint,
  recordDigest,
  emailMessages,
  carePlanMessages,
  qaMessages,
  type AISettings,
  type ProviderId,
} from "@/lib/ai/engine";
import type { SysAuditAction } from "@/lib/auditlog";

// ------------------------------------------------------- email recipients
const RECIPIENTS: Record<
  string,
  { label: string; context: string; addresses: string }
> = {
  office: {
    label: "the care agency office (care actions)",
    context:
      "Agency that must act: adopt the amended care plan, correct rota problems, confirm training. Ask for a named responsible person and written response.",
    addresses: "Record holds no office email — send via the portal or call; ask for the registered manager's email.",
  },
  records: {
    label: "Records team / DPO (corrections & access)",
    context:
      "UK GDPR Article 16 rectification and Article 15 access: wrong next of kin, missing Alzheimer's diagnosis, contaminated communication log, missing Alex. One-month statutory deadline.",
    addresses: "Ask the office for the Data Protection Officer's email.",
  },
  gp: {
    label: "GP — the GP surgery (clinical)",
    context:
      "Clinical items: confirm Alzheimer's diagnosis/stage in writing, Risperidone 6-weekly review (NICE NG97), pain review, anticoagulation monitoring. Consent to share with the agency.",
    addresses: "the GP surgery 01632 960001 (recorded in the portal).",
  },
  cmht: {
    label: "Mental health team — the mental-health team",
    context:
      "Delusional disorder review, Risperidone questions, memory-clinic follow-up, brief the carers on dementia strategies.",
    addresses: "the mental-health team 01632 960003 (the mental-health worker, mental health worker — as recorded).",
  },
  social: {
    label: "Council Adult Social Care (assessment/review)",
    context:
      "Care Act 2014: s9 needs assessment, s24 plan review, s42 safeguarding if serious. Reference the amended care plan and diagnosis gap.",
    addresses: "See council.example.gov.uk for the adults' first-contact team.",
  },
  alex: {
    label: "Family — Alex (son)",
    context: "Private family summary of the latest findings and what you are asking each service to do.",
    addresses: "Your own address book.",
  },
  next_of_kin: {
    label: "Family — Contact A & Contact B",
    context: "Family update with corrections: Contact A is NOT next of kin; the record is being corrected.",
    addresses: "Contact A 07700 900001 · Contact B 07700 900002 (as recorded).",
  },
};

// ------------------------------------------------------- care plan sections
const CP_SECTIONS: Record<string, { label: string; brief: string; changes: string }> = {
  memory: {
    label: "Memory & cognition support plan (new)",
    brief:
      "There is NO dementia-specific support plan today. Write one suitable for a man with Alzheimer's living alone with 4 visits/day, consistent carers preferred.",
    changes: [
      "Memantine 20 mg daily; Risperidone 500 mcg AM / 1 mg PM (variable, do-not-swap warning)",
      "11 distinct carer notes describe confusion (re-dressing in pyjamas, believing the lunch call never happened)",
      "Support plan only says 'cognitive function and memory preservation' generically; risk assessment rates cognitive impairment LOW",
      "Actions agreed: orientation cues, routine consistency, announce arrival, validation approach, record capacity refusals, memory-clinic follow-up",
    ].join("\n- "),
  },
  medication: {
    label: "Medication support plan (amended)",
    brief: "Amend the medication plan around the antipsychotic variability and eMAR recording failures.",
    changes: [
      "Risperidone 500 mcg in the morning and 1 mg at night — NOT interchangeable; blister packs look identical",
      "74 eMAR app-failure events; paper MAR audit required within 48 hours",
      "PRN declines to be recorded with reason (Lorazepam, Nefopam)",
      "6-weekly Risperidone review per NICE NG97",
    ].join("\n- "),
  },
  hearing: {
    label: "Hearing & communication support plan (amended)",
    brief: "Hearing aids were the single biggest flag theme; communication underpins all other care.",
    changes: [
      "67 flagged notes mention hearing aids (flat batteries, not charged, not inserted)",
      "Hearing-aid check becomes a recorded task at every morning call",
      "Carers to face Dad, reduce background noise, write key words down",
      "Hearing loss worsens apparent confusion — link to the memory plan",
    ].join("\n- "),
  },
  food: {
    label: "Food, fluid & nutrition support plan (amended)",
    brief: "Food refusals are common; make escalation explicit.",
    changes: [
      "426 food-decline notes; malnutrition risk already flagged alongside cognitive impairment",
      "New trigger: 2+ consecutive days of refused meals → same-day office escalation + GP",
      "Preferred foods list to be kept current with Alex's shopping list",
      "Weigh-in monthly; record drinks offered at each call",
    ].join("\n- "),
  },
  escalation: {
    label: "Escalation trigger watch list (amended)",
    brief: "A one-page trigger list the office and carers must act on, with who to contact.",
    changes: [
      "New triggers: sudden confusion increase (possible UTI/delirium), 2 days refused meals, hearing aids unresolvable >2 days, pain score uncontrolled",
      "Contact order: carer → office → Alex (son, primary next of kin after rectification) → GP",
      "Every trigger event logged with outcome",
    ].join("\n- "),
  },
};

// ---------------------------------------------------------------- component
interface ActivityItem {
  when: string;
  task: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export default function Assistant({
  record,
  audit,
  recs,
  onAudit,
}: {
  record: CareRecord;
  audit: AuditData | null;
  recs: RecommendationItem[] | null;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);

  const [rcpt, setRcpt] = useState("office");
  const [subject, setSubject] = useState("Dad — care record review: actions requested (September 2026)");
  const [points, setPoints] = useState("");
  const [tone, setTone] = useState("firm, courteous, factual");
  const [emailOut, setEmailOut] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState("");
  const [copiedEmail, setCopiedEmail] = useState(false);

  const [question, setQuestion] = useState("");
  const [qaOut, setQaOut] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [qaNote, setQaNote] = useState("");

  const [section, setSection] = useState("memory");
  const [cpOut, setCpOut] = useState("");
  const [cpBusy, setCpBusy] = useState(false);
  const [cpNote, setCpNote] = useState("");
  const [copiedCp, setCopiedCp] = useState(false);

  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    setSettings(loadSettings());
    setLoaded(true);
  }, []);

  const meta = PROVIDER_META[settings.provider];
  const configured = isConfigured(settings);
  const digest = useMemo(() => recordDigest(record, audit, recs), [record, audit, recs]);

  const pushActivity = (task: string, ok: boolean, ms: number, detail: string) =>
    setActivity((a) =>
      [{ when: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), task, ok, ms, detail }, ...a].slice(0, 6)
    );

  const doSave = () => {
    saveSettings(settings);
    setTestResult(null);
    pushActivity("Save settings", true, 0, `${settings.mode} · ${settings.provider}`);
    onAudit("ai.settings", `${settings.mode} · ${settings.provider}`, `engine settings saved (model: ${settings.model || "not set"}, temperature: ${settings.temperature}, max tokens: ${settings.maxTokens})`, "notice");
  };

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await testConnection(settings);
    setTestResult(r);
    pushActivity("Test connection", r.ok, r.latencyMs, r.message.slice(0, 80));
    setTesting(false);
  };

  const setProvider = (p: ProviderId) =>
    setSettings((s) => ({ ...s, provider: p, model: "" }));

  const generateEmail = async () => {
    setEmailBusy(true);
    setEmailNote("");
    const t0 = performance.now();
    try {
      const r = RECIPIENTS[rcpt];
      const pts = points
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (pts.length === 0) {
        setEmailNote("Add at least one point to cover (or load the recommendations / audit findings).");
        return;
      }
      const text = await chat(settings, emailMessages({ digest, recipientLabel: r.label, recipientContext: r.context, subject, points: pts, tone, senderName: "[Your name], son" }));
      setEmailOut(text);
      pushActivity("Email draft", true, Math.round(performance.now() - t0), `${r.label} · ${pts.length} points`);
      onAudit("ai.send", `email draft → ${r.label}`, `record digest (${digest.length} chars) sent to ${settings.provider} · ${pts.length} points`, "notice");
    } catch (e) {
      const msg = `${(e as Error).message}${(e as { hint?: string }).hint ? ` — ${(e as { hint?: string }).hint}` : ""}`;
      setEmailNote(msg);
      pushActivity("Email draft", false, Math.round(performance.now() - t0), msg.slice(0, 80));
    } finally {
      setEmailBusy(false);
    }
  };

  const generateQA = async () => {
    setQaBusy(true);
    setQaNote("");
    const t0 = performance.now();
    try {
      const text = await chat(settings, qaMessages({ digest, question }));
      setQaOut(text);
      pushActivity("Record Q&A", true, Math.round(performance.now() - t0), question.slice(0, 60));
      onAudit("ai.send", `record Q&A: “${question.slice(0, 60)}”`, `record digest (${digest.length} chars) sent to ${settings.provider}`, "notice");
    } catch (e) {
      const msg = `${(e as Error).message}${(e as { hint?: string }).hint ? ` — ${(e as { hint?: string }).hint}` : ""}`;
      setQaNote(msg);
      pushActivity("Record Q&A", false, Math.round(performance.now() - t0), msg.slice(0, 80));
    } finally {
      setQaBusy(false);
    }
  };

  const generateCp = async () => {
    setCpBusy(true);
    setCpNote("");
    const t0 = performance.now();
    try {
      const s = CP_SECTIONS[section];
      const text = await chat(settings, carePlanMessages({ digest, section: s.label, sectionBrief: s.brief, changes: s.changes }));
      setCpOut(text);
      pushActivity("Care plan section", true, Math.round(performance.now() - t0), s.label);
      onAudit("careplan.regenerate", s.label, `care-plan section regenerated via ${settings.provider}`, "notice");
    } catch (e) {
      const msg = `${(e as Error).message}${(e as { hint?: string }).hint ? ` — ${(e as { hint?: string }).hint}` : ""}`;
      setCpNote(msg);
      pushActivity("Care plan section", false, Math.round(performance.now() - t0), msg.slice(0, 80));
    } finally {
      setCpBusy(false);
    }
  };

  const copyTo = async (text: string, marker: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      marker(true);
      setTimeout(() => marker(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const mailtoEmail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailOut)}`;

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="border-teal-300">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-800">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-teal-900">AI assistant — your inference engine</h2>
            <p className="text-xs text-muted-foreground">
              Bring your own provider (OpenAI, Claude, Gemini, Cloudflare Workers AI, Groq, Ollama…)
              or deploy the bundled Cloudflare Worker. Keys are stored <strong>only in this
              browser</strong> and sent nowhere except the engine you choose.
            </p>
          </div>
          <Badge variant="outline" className={`text-[11px] ${configured ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-amber-200 bg-amber-100 text-amber-800"}`}>
            {configured ? `Engine ready — ${settings.mode === "worker" ? "Worker" : "Local proxy"}` : "Not configured"}
          </Badge>
        </CardContent>
      </Card>

      {/* settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Settings2 className="h-4 w-4 text-teal-700" />
            Engine settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Engine mode</label>
              <Select value={settings.mode} onValueChange={(v) => setSettings({ ...settings, mode: v as AISettings["mode"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="proxy">This app&apos;s proxy (/api/ai)</SelectItem>
                  <SelectItem value="worker">Cloudflare Worker (my own deployment)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Inference provider</label>
              <Select
                value={settings.provider}
                onValueChange={(v) => setProvider(v as ProviderId)}
                disabled={settings.mode === "worker" && false}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROVIDER_META).map(([k, v]) => (
                    <SelectItem key={k} value={k} disabled={v.workerOnly && settings.mode === "proxy"}>
                      {v.label}
                      {v.workerOnly ? " — Worker only" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {settings.mode === "worker" && (
            <div className="grid gap-3 rounded-lg border border-dashed p-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                  <CloudCog className="h-3.5 w-3.5" /> Worker URL
                </label>
                <Input
                  placeholder="https://care-record-ai-engine.<subdomain>.workers.dev"
                  value={settings.workerUrl}
                  onChange={(e) => setSettings({ ...settings, workerUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                  <KeyRound className="h-3.5 w-3.5" /> Shared key (optional)
                </label>
                <Input
                  type="password"
                  placeholder="ENGINE_SHARED_KEY, if you set one"
                  value={settings.workerKey}
                  onChange={(e) => setSettings({ ...settings, workerKey: e.target.value })}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground md:col-span-2">
                Deploy the bundled worker: <code className="rounded bg-muted px-1">cd cloudflare-worker && npm i && npx wrangler deploy</code>{" "}
                — full steps in cloudflare-worker/README.md. With the Workers-AI provider it needs
                no API key at all.
              </p>
            </div>
          )}

          {/* Cloudflare AI Gateway — optional, free; wired via the connect-ai-gateway wizard or here */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-foreground/80">
                Cloudflare AI Gateway (optional — free)
              </label>
              <Badge variant="outline" className="text-[10px]">
                {settings.gatewayId.trim() && settings.gatewayAccountId.trim()
                  ? "Routing through your gateway"
                  : "Direct to provider"}
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Account ID</label>
                <Input
                  placeholder="32-character account id"
                  value={settings.gatewayAccountId}
                  onChange={(e) => setSettings({ ...settings, gatewayAccountId: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Gateway name</label>
                <Input
                  placeholder="e.g. trevorcare"
                  value={settings.gatewayId}
                  onChange={(e) => setSettings({ ...settings, gatewayId: e.target.value })}
                />
              </div>
              {settings.provider === "openai-compatible" && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Gateway provider slug</label>
                  <Input
                    placeholder="groq · openrouter · deepseek…"
                    value={settings.gatewaySlug}
                    onChange={(e) => setSettings({ ...settings, gatewaySlug: e.target.value })}
                  />
                </div>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Set both fields to route this provider through
              <code className="mx-1 rounded bg-muted px-1">gateway.ai.cloudflare.com/v1/…</code>
              — central caching, rate limits and logs, at no cost. Your API key still travels only
              from this browser to the engine to the gateway. Prefer a guided setup? Run the
              <strong> “Connect Cloudflare AI Gateway” wizard </strong>
              (Wizard studio) — it fills these fields and tests the connection live.
            </p>
            {gatewayEndpoint(settings) && (
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-[10px]">{gatewayEndpoint(settings)}</pre>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Model</label>
              <Input
                placeholder={meta.placeholderModel}
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">API key {meta.workerOnly ? "(not needed)" : ""}</label>
              <Input
                type="password"
                disabled={meta.workerOnly}
                placeholder={meta.keyHint}
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              />
            </div>
            {(meta.needsBase || settings.provider === "openai-compatible") && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Base URL</label>
                <Input
                  placeholder="https://api.groq.com/openai/v1"
                  value={settings.baseUrl}
                  onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                />
              </div>
            )}
            {(meta.needsAccount || settings.provider === "cloudflare") && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Cloudflare account id</label>
                <Input
                  placeholder="32-character account id"
                  value={settings.cfAccountId}
                  onChange={(e) => setSettings({ ...settings, cfAccountId: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">
                Temperature: {settings.temperature.toFixed(1)}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })}
                className="w-full accent-teal-700"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Max output tokens</label>
              <Input
                type="number"
                min={64}
                max={4096}
                value={settings.maxTokens}
                onChange={(e) => setSettings({ ...settings, maxTokens: Number(e.target.value) || 1200 })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={doSave} className="bg-teal-800 hover:bg-teal-700">
              Save settings
            </Button>
            <Button variant="outline" onClick={doTest} disabled={testing || !loaded}>
              {testing ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Testing…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Test connection
                </>
              )}
            </Button>
            {testResult && (
              <span className="flex items-center gap-1.5 text-xs">
                {testResult.ok ? (
                  <CircleCheck className="h-4 w-4 text-emerald-600" />
                ) : (
                  <CircleX className="h-4 w-4 text-red-600" />
                )}
                <span className={testResult.ok ? "text-emerald-700" : "text-red-700"}>
                  {testResult.message} ({testResult.latencyMs} ms)
                </span>
              </span>
            )}
          </div>
          <p className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
            Privacy: the key never reaches this app&apos;s storage or logs — it lives in your
            browser&apos;s localStorage and is forwarded per-request to the endpoint above. For
            the strongest setup, deploy the Cloudflare worker with the Workers AI binding: the key
            never leaves Cloudflare.
          </p>
        </CardContent>
      </Card>

      {/* email generator */}
      <Card className="border-teal-300">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Mail className="h-4 w-4 text-teal-700" />
            Generate an email to a key contact
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The draft is written from the record digest (client facts, medication, audit findings,
            recommendations) — with the evidence and the action requested in every point.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Recipient</label>
              <Select value={rcpt} onValueChange={setRcpt}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RECIPIENTS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{RECIPIENTS[rcpt].addresses}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/80">Tone</label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="firm, courteous, factual">Firm, courteous, factual</SelectItem>
                  <SelectItem value="warm and collaborative">Warm and collaborative</SelectItem>
                  <SelectItem value="formal complaint register">Formal / complaint register</SelectItem>
                  <SelectItem value="plain and brief">Plain and brief</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground/80">Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-foreground/80">
                Points to cover (one per line)
              </label>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPoints(
                      (recs || [])
                        .filter((r) => r.priority === "High")
                        .map((r) => `${r.title} — ${r.rationale} Actions: ${r.actions.join(" ")}`)
                        .join("\n")
                    )
                  }
                >
                  <ListChecks className="mr-1 h-3.5 w-3.5" /> Load high-priority recommendations
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setPoints(
                      (audit?.incorrect_info || [])
                        .map((d) => `${d.id}: ${d.item} — recorded: ${d.recorded} — should be: ${d.reality}`)
                        .join("\n")
                    )
                  }
                >
                  <ListChecks className="mr-1 h-3.5 w-3.5" /> Load record corrections
                </Button>
              </div>
            </div>
            <Textarea rows={5} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generateEmail} disabled={emailBusy || !configured} className="bg-teal-800 hover:bg-teal-700">
              {emailBusy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Drafting…
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Draft with engine
                </>
              )}
            </Button>
            {emailOut && (
              <>
                <Button variant="outline" asChild>
                  <a href={mailtoEmail}>
                    <Mail className="mr-1.5 h-4 w-4" /> Open in email app
                  </a>
                </Button>
                <Button variant="outline" onClick={() => copyTo(emailOut, setCopiedEmail)}>
                  {copiedEmail ? (
                    <>
                      <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-4 w-4" /> Copy
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
          {emailNote && <p className="text-xs leading-relaxed text-amber-700">{emailNote}</p>}
          {emailOut && (
            <div className="max-h-80 overflow-y-auto rounded-lg border bg-teal-50/40 p-3">
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{emailOut}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Q&A */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <FileQuestion className="h-4 w-4 text-teal-700" />
            Ask the record
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Answers are grounded in the record digest — the assistant is instructed to flag anything
            it cannot verify rather than guess. For full-document questions, pair this with the AI
            review bundle (Downloads tab).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="e.g. How many times was the Risperidone not given, and when?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim() && !qaBusy) generateQA();
              }}
            />
            <Button onClick={generateQA} disabled={qaBusy || !question.trim() || !configured} className="shrink-0 bg-teal-800 hover:bg-teal-700">
              {qaBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Ask
            </Button>
          </div>
          {qaNote && <p className="text-xs leading-relaxed text-amber-700">{qaNote}</p>}
          {qaOut && (
            <div className="max-h-72 overflow-y-auto rounded-lg border bg-background/60 p-3">
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{qaOut}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* care plan regeneration */}
      <Card className="border-violet-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-violet-900">
            <ClipboardList className="h-4 w-4 text-violet-700" />
            Regenerate the care plan with any changes
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick a section; the engine writes the amended support plan text (commitments, evidence,
            review point) ready to send to the agency. Once adopted, re-run the bundle build to
            refresh the PDF in the Downloads tab.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger className="max-w-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CP_SECTIONS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="rounded-md bg-muted/50 p-2.5 text-[12.5px] leading-relaxed text-foreground/85">
            <strong>Change basis:</strong> {CP_SECTIONS[section].changes.split("\n").join(" · ")}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generateCp} disabled={cpBusy || !configured} className="bg-violet-700 hover:bg-violet-600">
              {cpBusy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Writing…
                </>
              ) : (
                <>
                  <RefreshCcw className="mr-1.5 h-4 w-4" /> Regenerate section
                </>
              )}
            </Button>
            {cpOut && (
              <Button variant="outline" onClick={() => copyTo(cpOut, setCopiedCp)}>
                {copiedCp ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-4 w-4" /> Copy text
                  </>
                )}
              </Button>
            )}
          </div>
          {cpNote && <p className="text-xs leading-relaxed text-amber-700">{cpNote}</p>}
          {cpOut && (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-violet-200 bg-violet-50/70 p-3">
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{cpOut}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* activity */}
      {activity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-teal-900">Engine activity (this session)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {activity.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{a.when}</span>
                {a.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <CircleX className="h-3.5 w-3.5 text-red-600" />
                )}
                <span className="font-semibold text-foreground/80">{a.task}</span>
                {a.ms > 0 && <span>{a.ms} ms</span>}
                <span className="min-w-0 truncate">{a.detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
