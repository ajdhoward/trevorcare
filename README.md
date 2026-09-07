# Family Care Hub — *Haven 360* family-side care intelligence

> A family-built oversight portal for a parent receiving domiciliary care and a
> parent in residential care. **Demo/sample data only** — drop in your own data
> locally and never commit it (see `docs/PRIVACY.md`).

A Next.js 16 (App Router, TypeScript, Tailwind, shadcn/ui) single-family
care-intelligence interface. Dark mode by default, teal palette, mobile-first
(drawer nav) — built for real use in hospital corridors, not for demos.

## What's inside

| Area | Tabs / features |
|---|---|
| **Family hub** | Dual-parent dashboard, family tasks + auto shopping list, calendar (.ics), LPA duties + joint availability, Life360 family circle + **Bluetooth tracker card & exit-event log** |
| **Dad** | Full care record (visits & notes, medication/eMAR + **reconciliation & governance view**, watch items + flag analytics, well-being index, conditions, documents), **"My Day" tablet view** (`/kiosk`) |
| **Mum** | Care-home oversight: contact log, well-being tracker, escalation ladder, email/phone templates (no portal on the home's side) |
| **Connect** | WhatsApp groups (Whapi.Cloud) in/out + care inbox, **calls & evidence log** (searchable transcripts, highlights, audited copying, contact-spike early warning), **share links for advisers**, **AI review bridge** with feedback ingest |
| **Intelligence** | AI assistant (multi-provider, incl. zero-key Cloudflare Workers AI) routable through **Cloudflare AI Gateway** (free: caching, rate limits, logs — guided setup wizard included), conditions, recommendations |
| **Oversight & assurance** | **Care Hub & legal** (case file, tickable actions, briefings & runbooks, statutory dossier generator with escalation clocks, agency handoff register), alerts engine + bell (incl. the 3×-mean contact-spike rule), records audit + DQ log, social & comms letters, **local-authority ASC watch**, API & data catalog |
| **Security** | Fail-closed sign-in gate (`/login`), 30-day signed sessions, throttled passwords, header sign-out — set `PORTAL_PASSWORD` + `SESSION_SECRET` (see `.env.example`) |

Everything governance-relevant lands in a hash-chained audit log; RBAC (6
roles) is enforced per view with lawful-basis notes (UK GDPR / Care Act / MCA).

## Run it

```bash
npm install
npm run db:generate   # prisma client (optional in dev)
npm run dev           # http://localhost:3000
```

The interface ships with **sample data** in `public/data/*.json` so every tab
renders out of the box. Replace them with your own exports locally — the
filenames are git-ignored so a real record never gets committed.

## Deploy to Cloudflare

Two deployable pieces:

1. **The AI/proxy Worker** (`cloudflare-worker/`) — multi-provider AI engine
   (zero keys via the Workers-AI binding) plus optional Whapi/inbox proxies.
   - No-code: *Workers & Pages → Create → Connect to Git*, root
     `cloudflare-worker/`, or press the **Deploy to Cloudflare** button.
   - CLI: `npx wrangler login && npx wrangler deploy` (inside the folder).
   - Secrets: see `cloudflare-worker/.dev.vars.example`; set with
     `npx wrangler secret put <NAME>` or in the dashboard. Never commit them.
2. **The Next.js interface** — deploy via Workers Builds (OpenNext /
   next-on-pages) or any Node host; see `docs/DEPLOYMENT.md`.

Optional CI: `.github/workflows/deploy.yml` deploys the worker on push to
`main` — add `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_ACCOUNT_ID`) as
repo secrets.

## Safety model

- Provider facts are immutable in the UI; corrections live in the DQ log with
  evidence, and rectification letters (UK GDPR Art. 16) are generated in
  *Social & comms*.
- Every write action is audited (`src/lib/auditlog.ts`, hash-chained).
- Secrets and tokens are entered at runtime (localStorage / Worker env), never
  in the repo.

## Docs

`docs/ARCHITECTURE.md` · `docs/DATA-FLOW.md` · `docs/SECURITY.md` ·
`docs/LEGAL-FRAMEWORK.md` · `docs/FAMILY-GUIDE.md` · `docs/CONNECTORS.md` ·
`docs/DEPLOYMENT.md` · `docs/AI-REVIEW-GUIDE.md` · start with
`docs/PRIVACY.md` before adding your family's real data.

## License & credits

**Proprietary — All Rights Reserved** (see [LICENSE](./LICENSE)).
This is not open-source software: viewing the repository grants no
licence to copy, modify, redistribute, or build upon this code.
Commercial licensing terms will be published when the project is
released as a product.

Care-framework wording references UK statutes (Care Act 2014, Mental
Capacity Act 2005, MHA s.17/s.117, CQC, UK GDPR). Sample data is
fully synthetic.
