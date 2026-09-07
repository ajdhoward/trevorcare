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

## 4. AI Gateway wizard (first-class, free)

The AI assistant can route **every provider call** through your own
[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) —
caching, rate limiting, spend controls and logs in one place. The gateway's
core features are **free on every plan**; your provider API key still travels
only browser → engine → gateway → upstream (never stored server-side).

Two ways to set it up:

1. **The guided wizard (recommended)** — *Deploy & sync → step 4 → “Run the
   guided wizard”*, or the Wizard studio → **“Connect Cloudflare AI
   Gateway”**. It walks dashboard → AI → AI Gateway → Create gateway, takes
   your account ID + gateway name + provider + model (+ optional API key,
   masked, browser-only), **rewrites the engine settings in this browser and
   runs a live test call**. It is a normal wizard-framework definition —
   editable in the studio like every other wizard.
2. **Quick apply** — *Deploy & sync → step 4* fields + “Apply gateway to the
   AI engine”. Same settings, no test call. The AI assistant settings panel
   shows the resulting endpoint and a routing badge, and can be edited
   directly.

Supported provider paths (BYOK passthrough, per Cloudflare docs):

| Provider | Gateway URL after `…/v1/{account}/{gateway}` |
|---|---|
| OpenAI | `/openai/chat/completions` |
| Anthropic | `/anthropic/v1/messages` |
| Google AI Studio | `/google-ai-studio/v1beta/models/{model}:generateContent` |
| Workers AI (API token) | `/workers-ai/{model}` |
| Groq / OpenRouter / DeepSeek / … | `/{slug}/chat/completions` |

Workers AI in **worker mode** routes natively instead:
`env.AI.run(model, input, { gateway: { id } })` — no API token needed at all.
In the gateway settings, enable **caching** (identical record Q&A served from
.cache), **rate limiting**, and **Log payloads** only if you accept prompts
being stored — otherwise keep logs metadata-only for UK GDPR minimisation.

## 5. Cost — what fits in the $5 Workers plan

Validated against Cloudflare pricing pages (September 2026) for a single
family's usage of this app:

| Piece | Included | Typical family use |
|---|---|---|
| Workers Paid plan | $5/mo minimum: **10M requests + 30M CPU-ms/month**, then $0.30/M requests, $0.02/M CPU-ms | Portal + worker: a few thousand requests/month — far inside included |
| AI Gateway | **Free core** (caching, rate limits, logs; ~100k log events/mo free) | All of it — the gateway itself costs nothing; you pay only your AI provider for tokens |
| Workers AI | Free daily neuron allocation; $0.011 per additional 1,000 neurons | Zero-key classification/Q&A fits the free daily allocation |
| Static assets (portal pages) | Free, unlimited requests | — |
| D1 (family DB, audit chain) | Free: 5M row-reads/day, 100k row-writes/day, 5GB | A family record uses a tiny fraction |
| KV (consent cache) | Free: 100k reads/day, 1k writes/day, 1GB | Comfortable |
| R2 (documents/vault) | Free: 10 GB-month, 1M Class A + 10M Class B ops/mo | Hundreds of documents, zero egress fees |
| Cloudflare Access (zero-trust gate) | Free up to 50 users | Whole family |
| Turnstile / Email Routing / cron triggers | Free | — |

**Bottom line:** $5/month covers the whole platform for one family — the only
variable extra is your chosen AI provider's token cost, which the gateway's
caching and rate limits actively reduce. On the **free** plan the AI worker
also runs (100k req/day, 10ms CPU — fine for the stateless engine), but the
full Next.js portal wants the paid plan's 30s CPU ceiling for SSR headroom.

## 6. Webhooks & email on Workers (production ingest)

- **WhatsApp**: Whapi webhook URL → `https://<worker>/api/whapi/webhook?secret=…`
  (D1 table + shared secret; recipe in `cloudflare-worker/README.md`).
- **Email**: Email Routing → Email Worker → `/api/inbox` (same recipe).
- **Cron**: `*/5 * * * *` poll fallback for groups without webhook delivery;
  `0 6 * * *` daily digest + med-window checks feeding GOV.UK Notify-style
  email alerts.

## 7. Post-deploy verification (do not skip)

- `/health` on the worker returns `{ ok: true }`.
- Access blocks you when signed out of the allowed identity.
- One test WhatsApp send reaches the bound group.
- One share link opens in a private window (read-only, no edit controls).
- Audit chain verify passes after a scripted action.
