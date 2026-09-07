"use client";

// Deploy & sync command centre — the "Deploy to Cloudflare" button flow with
// guided decisions (URL, secrets, security), the AI Gateway wizard, GitHub
// sync (Workers Builds + workflow), and the AI-workspace ↔ repo bridge.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Cloud, CloudUpload, Copy, ExternalLink, GitBranch, Github, KeyRound, Link2, Rocket, ShieldCheck, Sparkles, Workflow,
  BadgeCheck,
} from "lucide-react";
import type { SysAuditAction } from "@/lib/auditlog";

export interface DeployProps {
  actorName: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

const K = "h360-deploy";

interface DeployState {
  repoUrl: string;
  checklist: Record<string, boolean>;
  gw: { accountId: string; gateway: string; provider: string; model: string };
}

const DEFAULTS: DeployState = {
  repoUrl: "",
  checklist: {},
  gw: { accountId: "", gateway: "haven360", provider: "openai", model: "gpt-4o" },
};

const CHECKS: { id: string; title: string; detail: string }[] = [
  { id: "access", title: "Cloudflare Access in front of the app", detail: "Zero Trust → Access → self-hosted app policy: only your email + Pat's. Even if someone gets the URL, they can't reach the app. Free for up to 50 users." },
  { id: "secrets", title: "All secrets set as Worker secrets", detail: "The Deploy button reads .dev.vars.example and prompts you for each value — AI provider key, Whapi token, shared engine key. Nothing goes in the repo." },
  { id: "d1-uk", title: "Data pinned to the UK", detail: "Create D1/R2 in a UK location hint (weur); Data Localisation Suite keeps requests in-jurisdiction. UK GDPR Art. 3 + storage limitation." },
  { id: "https", title: "TLS 1.3 only + HSTS", detail: "SSL/TLS → Edge certificates: minimum TLS 1.3, Always Use HTTPS, HSTS on. Workers domains are HTTPS by default." },
  { id: "turnstile", title: "Turnstile on public endpoints", detail: "Webhook + share endpoints get a Turnstile gate so bots can't hammer the ingest routes or brute-force share tokens." },
  { id: "least-priv", title: "Least-privilege API tokens", detail: "Wrangler/OAuth tokens used by the button are scoped to this Worker only; rotate after the deploy if you didn't create it yourself." },
  { id: "audit", title: "Audit chain exported after go-live", detail: "Export the hash-chained audit trail from Access & audit → keep a copy outside the platform. Cloudflare D1 keeps the production chain." },
  { id: "backup", title: "D1 Time Travel enabled", detail: "D1 has point-in-time recovery (default 7 days). Confirm it, and note the RPO ≤ 24h / RTO ≤ 4h targets in docs/SECURITY.md." },
];

function CopyRow({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      {label && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>}
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-10 font-mono text-xs">{text}</pre>
      <Button
        size="icon" variant="ghost"
        className="absolute right-1 top-6 h-7 w-7"
        aria-label="Copy"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}
      >
        {done ? <BadgeCheck className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function Deploy({ actorName, onAudit }: DeployProps) {
  const [state, setState] = useState<DeployState>(DEFAULTS);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(K);
        if (raw) setState({ ...DEFAULTS, ...(JSON.parse(raw) as DeployState) });
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const patch = (p: Partial<DeployState>) => {
    setState((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem(K, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const toggle = (id: string) => {
    const checklist = { ...state.checklist, [id]: !state.checklist[id] };
    patch({ checklist });
    if (!state.checklist[id]) onAudit("deploy.step", id, `Security checklist item completed: ${CHECKS.find((c) => c.id === id)?.title}`);
  };

  const repo = state.repoUrl.trim().replace(/\/+$/, "");
  const deployBtnUrl = useMemo(() => (repo ? `https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(repo)}` : ""), [repo]);
  const gwUrl = useMemo(
    () => (state.gw.accountId && state.gw.gateway ? `https://gateway.ai.cloudflare.com/v1/${state.gw.accountId.trim()}/${state.gw.gateway.trim()}/${state.gw.provider}` : ""),
    [state.gw]
  );

  const applyGateway = () => {
    try {
      const raw = localStorage.getItem("care-ai-settings-v1");
      const settings = raw ? JSON.parse(raw) : {};
      const next = {
        ...settings,
        provider: "openai-compatible",
        baseUrl: gwUrl,
        model: state.gw.model,
        mode: "proxy",
      };
      localStorage.setItem("care-ai-settings-v1", JSON.stringify(next));
      onAudit("ai.gateway", gwUrl, `AI Gateway wired into the engine: provider openai-compatible, model ${state.gw.model} — set your real API key in the AI assistant settings`, "notice");
      setStep(5);
    } catch { /* storage unavailable */ }
  };

  const steps = [
    { n: 1, title: "Push this portal to your GitHub", icon: <Github className="h-4 w-4" /> },
    { n: 2, title: "One-click Deploy to Cloudflare", icon: <Rocket className="h-4 w-4" /> },
    { n: 3, title: "Security checklist", icon: <ShieldCheck className="h-4 w-4" /> },
    { n: 4, title: "AI Gateway wizard", icon: <Sparkles className="h-4 w-4" /> },
    { n: 5, title: "GitHub ↔ Cloudflare regular sync", icon: <Workflow className="h-4 w-4" /> },
    { n: 6, title: "AI workspace ↔ repo bridge", icon: <Link2 className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Cloud className="h-5 w-5 text-teal-700" /> Deploy to Cloudflare — guided, security-first</CardTitle>
          <CardDescription>
            Everything needed to take this portal from this workspace to your own Cloudflare account, automating what the
            platform can automate and pausing where <em>you</em> need to decide (the URL, the secrets, who gets access).
            Full narrative in <code>docs/DEPLOYMENT.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {steps.map((s) => (
              <button key={s.n} onClick={() => setStep(s.n)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${step === s.n ? "border-teal-700 bg-teal-800 text-white" : "hover:border-teal-400"}`}>
                {s.icon} {s.n}. {s.title}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {step === 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Github className="h-4 w-4" /> 1 · Push to GitHub</CardTitle>
            <CardDescription>The repo is the single source of truth: Cloudflare builds from it, and the AI workspace syncs into it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="repo">Your repository URL (create an empty <strong>private</strong> repo first)</Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input id="repo" value={state.repoUrl} onChange={(e) => patch({ repoUrl: e.target.value })} placeholder="https://github.com/yourname/haven360" />
                <a href={deployBtnUrl || "https://github.com/new"} target="_blank" rel="noreferrer">
                  <Button variant="outline" className="w-full sm:w-auto"><ExternalLink className="mr-1.5 h-4 w-4" /> {repo ? "Open repo" : "Create new repo"}</Button>
                </a>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Private repo — the portal holds personal data; never make it public.</p>
            </div>
            <CopyRow label="Run in this workspace (or ask the AI to do it)" text={`git init && git add -A && git commit -m "Haven 360 family care portal"\ngh repo create haven360 --private --source=. --push\n# or: git remote add origin <your-repo-url> && git push -u origin main`} />
            <p className="text-xs text-muted-foreground">Alternatively use <code>scripts/github_sync.sh</code> — it commits the workspace state, appends the worklog and pushes in one step.</p>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Rocket className="h-4 w-4" /> 2 · Deploy to Cloudflare button</CardTitle>
            <CardDescription>
              Paste your repo URL in step 1 — the button clones the repo into your GitHub, asks for the decisions below,
              and deploys. It reads <code>cloudflare-worker/wrangler.jsonc</code> and prompts one secret per entry in{" "}
              <code>cloudflare-worker/.dev.vars.example</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {repo ? (
              <>
                <a href={deployBtnUrl} target="_blank" rel="noreferrer" onClick={() => onAudit("deploy.step", "deploy-button", `Deploy to Cloudflare opened for ${repo}`)}>
                  <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" className="h-10" />
                </a>
                <CopyRow label="Button for your README" text={`[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](${deployBtnUrl})`} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Add your repository URL in step 1 first — the button is generated from it.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["Workers URL — pick your subdomain", "e.g. haven360.yourname.workers.dev — you choose the workers.dev subdomain during the deploy; you can bind a custom domain (e.g. care.family.family) afterwards in Workers → Settings → Domains & Routes."],
                ["Secrets — the deploy prompts for each", "AI_PROVIDER_KEY, WHAPI_TOKEN, ENGINE_SHARED_KEY (in .dev.vars.example). Values are stored as Worker secrets — never in the repo, never in D1."],
                ["Resources — D1 + KV are created for you", "The wrangler config lists the bindings; the button provisions them on first deploy. Choose UK location when prompted (or re-create with location hint 'weur')."],
                ["Who gets in — set Access right after", "The app is public-by-default once deployed until you enable Cloudflare Access (step 3). Do that within the same session."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{t}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <CopyRow label="Or deploy manually (wrangler)" text={`cd cloudflare-worker\nnpm i -g wrangler && wrangler login\nwrangler d1 create haven360 && wrangler kv namespace create CONSENT\nwrangler deploy   # uses wrangler.jsonc bindings`} />
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" /> 3 · Security checklist — data protection by default</CardTitle>
            <CardDescription>Tick these off as you complete them on the Cloudflare dashboard. Saved locally, exported in the audit trail.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {CHECKS.map((c) => (
              <button key={c.id} onClick={() => toggle(c.id)} className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:border-teal-400">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${state.checklist[c.id] ? "border-teal-700 bg-teal-800 text-white" : "border-border"}`}>
                  {state.checklist[c.id] ? "✓" : ""}
                </span>
                <span>
                  <span className="block text-sm font-medium">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{c.detail}</span>
                </span>
              </button>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              {Object.values(state.checklist).filter(Boolean).length}/{CHECKS.length} completed · guardian: {actorName} · full policy in docs/SECURITY.md
            </p>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4" /> 4 · Cloudflare AI Gateway wizard</CardTitle>
            <CardDescription>
              Route every AI call through your own gateway: central caching, rate limits, spend controls and logs — no key
              ever reaches the browser of the deployed app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
              <li>Cloudflare dashboard → AI → AI Gateway → Create gateway (name it, e.g. <code>haven360</code>).</li>
              <li>Copy your account ID (dashboard home) and paste below with the gateway name.</li>
              <li>Apply — the wizard rewrites the AI engine settings to send requests through the gateway URL.</li>
              <li>In AI → AI Gateway settings: enable <strong>caching</strong> (identical record Q&amp;A served from cache), <strong>rate limiting</strong> (e.g. 60 req/min), and <strong>Log payloads</strong> only if you accept prompts being stored — otherwise keep logs metadata-only for UK GDPR minimisation.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="gw-acct">Cloudflare account ID</Label>
                <Input id="gw-acct" value={state.gw.accountId} onChange={(e) => patch({ gw: { ...state.gw, accountId: e.target.value } })} className="mt-1.5 font-mono text-xs" placeholder="32-hex account id" />
              </div>
              <div>
                <Label htmlFor="gw-name">Gateway name</Label>
                <Input id="gw-name" value={state.gw.gateway} onChange={(e) => patch({ gw: { ...state.gw, gateway: e.target.value } })} className="mt-1.5" />
              </div>
              <div>
                <Label>Upstream provider</Label>
                <Select value={state.gw.provider} onValueChange={(v) => patch({ gw: { ...state.gw, provider: v } })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="google-ai-studio">Google AI Studio</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="groq">Groq</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="gw-model">Default model</Label>
                <Input id="gw-model" value={state.gw.model} onChange={(e) => patch({ gw: { ...state.gw, model: e.target.value } })} className="mt-1.5" />
              </div>
            </div>
            {gwUrl ? (
              <>
                <CopyRow label="Gateway endpoint (what the engine will call)" text={gwUrl} />
                <Button onClick={applyGateway} className="bg-teal-800 hover:bg-teal-700"><KeyRound className="mr-1.5 h-4 w-4" /> Apply gateway to the AI engine</Button>
                <p className="text-[11px] text-muted-foreground">Applied into localStorage settings (care-ai-settings-v1). Then open the AI assistant tab and set your provider API key — the key travels to the gateway, and the gateway forwards upstream.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Enter account ID and gateway name to generate the endpoint.</p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Workflow className="h-4 w-4" /> 5 · GitHub ↔ Cloudflare regular sync</CardTitle>
            <CardDescription>Two supported paths — use either or both. Every <code>git push</code> ends up as a live deployment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Path A — Workers Builds (Cloudflare&apos;s GitHub integration, recommended)</p>
              <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
                <li>Dashboard → Workers &amp; Pages → your worker → Settings → Build → <strong>Connect to Git</strong>.</li>
                <li>Authorize GitHub, pick the repo + main branch.</li>
                <li>Build command: <code>echo ok</code> (prebuilt worker) — deploy command: <code>npx wrangler deploy</code> (defaults provided).</li>
                <li>Enable &quot;Deploy on every push&quot; — pushes to main deploy automatically; PRs get preview URLs.</li>
              </ol>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Path B — GitHub Actions (repo-driven)</p>
              <p className="text-xs text-muted-foreground">The repo ships <code>.github/workflows/deploy.yml</code>. Add one repo secret (CLOUDFLARE_API_TOKEN with Workers Scripts:Edit + D1:Edit) and it deploys on every push to main.</p>
              <CopyRow text={`# .github/workflows/deploy.yml (already in the repo)\n# Secret needed: CLOUDFLARE_API_TOKEN · optional: CLOUDFLARE_ACCOUNT_ID`} />
            </div>
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium"><GitBranch className="h-4 w-4" /> Sync cadence from this workspace</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Run <code>scripts/github_sync.sh &quot;what changed&quot;</code> after each working session — it stages everything,
                appends the shared worklog and pushes. The AI workspace (here) pushes to the same repo, so the portal, the docs
                and the AI context never drift apart.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Link2 className="h-4 w-4" /> 6 · AI workspace ↔ repo bridge</CardTitle>
            <CardDescription>So we can keep building this together: the repo carries the AI&apos;s working memory inside it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">What lives in the repo for the AI</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                <li>• <code>AGENTS.md</code> — how any AI assistant should work with this codebase (conventions, commands, guardrails).</li>
                <li>• <code>docs/</code> — architecture, deployment, security, connectors, MCP servers, legal framework, changelog.</li>
                <li>• <code>worklog.md</code> — the shared multi-agent work log, appended every session.</li>
                <li>• <code>.ai/context.md</code> — generated snapshot of current state (regenerated by <code>scripts/ai_workspace_sync.py</code>).</li>
              </ul>
            </div>
            <CopyRow label="Bring the repo back into a fresh AI session" text={`python3 scripts/ai_workspace_sync.py   # regenerates .ai/context.md + worklog snapshot\n# then tell the AI: "Read AGENTS.md, docs/ARCHITECTURE.md and worklog.md first."`} />
            <p className="text-xs text-muted-foreground">
              This workspace ↔ repo link is intentionally boring: plain markdown + one script. Any AI (this one, Claude, Qwen,
              Codex) can pick the project up with full context, and Cloudflare redeploys whatever lands.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex items-start gap-2 pt-4">
          <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
          <p className="text-xs text-muted-foreground">
            Target architecture on Cloudflare (Qwen spec §10 aligned): Workers (API) · <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[10px]">D1</Badge> family
            record &amp; audit chain · <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[10px]">R2</Badge> documents ·{" "}
            <Badge variant="outline" className="mx-0.5 px-1 py-0 text-[10px]">KV</Badge> consent cache · Queues/Cron for digests &amp; med-window
            timers · Workers AI + AI Gateway for classification/translation. UK-pinned data path.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
