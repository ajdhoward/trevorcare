# Deployment — Cloudflare, GitHub sync, AI Gateway

Two deployment shapes; use either or both:

- **Worker API first** (what the Deploy button does): `cloudflare-worker/` ships
  the AI engine, WhatsApp proxies, inbox and Workers-AI zero-key fallback.
- **Whole portal on Workers** (OpenNext): `@opennextjs/cloudflare` adapts this
  Next.js app to Workers; D1/R2/KV replace SQLite/localStorage-as-truth.

## 1. The "Deploy to Cloudflare" button

In the portal: **Deploy & sync tab → step 1–2** (enter your repo URL, click the
generated button). In a README:

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOU/haven360)
```

What it automates: clones the repo into your GitHub, provisions D1/KV/R2 from
`cloudflare-worker/wrangler.jsonc`, **prompts you once per uncommented variable
in `cloudflare-worker/.dev.vars.example`** and stores each answer as a Worker
secret, then builds and deploys.

Decisions you will be guided through (the tab walks all of them):

1. **The URL** — your workers.dev subdomain (e.g. `haven360.you.workers.dev`);
   later bind a custom domain (Workers → Settings → Domains).
2. **Secrets** — `ENGINE_SHARED_KEY`, `AI_PROVIDER_KEY`, `WHAPI_TOKEN`,
   `WEBHOOK_SECRET` (all optional; the engine runs key-free on Workers-AI).
3. **Data location** — choose UK when creating D1/R2 (`weur` location hint).
4. **Who gets in** — enable Cloudflare Access immediately (step 3 checklist).

Manual path, if you prefer terminals:

```bash
cd cloudflare-worker
npm i -g wrangler && wrangler login
wrangler d1 create haven360 && wrangler kv namespace create CONSENT
wrangler deploy
```

## 2. Whole portal on Workers (OpenNext) — the target shape

```bash
npm i @opennextjs/cloudflare
# open-next.config.ts + updated wrangler.jsonc (see Qwen spec §10 bindings):
#   D1 FAMILY_DB · R2 KEEPSAKES · KV CONSENT · DO FAMILY_ROOM
#   Queues provider-events · Workflows s17-family-escalation
#   [ai] binding · [triggers] crons (*/5 digests, 06:00 daily digest)
npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy
```

Mapping of client stores → D1 tables is 1:1 by key name (see
`scripts/ai_workspace_sync.py` output §"Client store keys").

## 3. GitHub sync (regular, automatic)

**Path A — Cloudflare Workers Builds (recommended, no CI file needed):**
Workers & Pages → your worker → Settings → Build → *Connect to Git* → pick
repo/branch → enable "Deploy on every push". PRs get preview URLs.

**Path B — the shipped GitHub Action:** add repo secret
`CLOUDFLARE_API_TOKEN` (template: *Edit Cloudflare Workers*) →
`.github/workflows/deploy.yml` deploys on every push to `main` touching
`cloudflare-worker/**`.

**Workspace ↔ repo ↔ Cloudflare loop:**

```bash
python3 scripts/ai_workspace_sync.py   # refresh .ai/context.md (AI memory)
./scripts/github_sync.sh "batch 8: whatever changed"
# → commit + push → Cloudflare deploys automatically
```

The repo carries the AI's working memory (`AGENTS.md`, `docs/`, `worklog.md`,
`.ai/context.md`), so this workspace, your repo and the live portal never
drift apart — and any future AI session starts fully briefed.

## 4. AI Gateway wizard (in the Deploy & sync tab, step 4)

1. Dashboard → AI → AI Gateway → create gateway (e.g. `haven360`).
2. Paste account ID + gateway name + provider in the wizard.
3. It generates `https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/{provider}`
   and rewrites `care-ai-settings-v1` (engine: openai-compatible via gateway).
4. Set your real provider key in the AI assistant tab; enable caching +
   rate limiting in the gateway; keep payload logging off unless you accept
   prompt storage (UK GDPR minimisation).

## 5. Webhooks & email on Workers (production ingest)

- **WhatsApp**: Whapi webhook URL → `https://<worker>/api/whapi/webhook?secret=…`
  (D1 table + shared secret; recipe in `cloudflare-worker/README.md`).
- **Email**: Email Routing → Email Worker → `/api/inbox` (same recipe).
- **Cron**: `*/5 * * * *` poll fallback for groups without webhook delivery;
  `0 6 * * *` daily digest + med-window checks feeding GOV.UK Notify-style
  email alerts.

## 6. Post-deploy verification (do not skip)

- `/health` on the worker returns `{ ok: true }`.
- Access blocks you when signed out of the allowed identity.
- One test WhatsApp send reaches the bound group.
- One share link opens in a private window (read-only, no edit controls).
- Audit chain verify passes after a scripted action.
