# Architecture — Family Care Hub (Haven 360 family-side layer)

> Family-owned care intelligence. Two service users, one family, zero vendor
> lock-in. This document is the map of the whole system; it is updated every
> time the platform progresses (see docs/CHANGELOG.md).

## 1. What this system is — and is not

The portal is **the family's side of care**. It ships no carer app and no
provider back-office. It ingests whatever the provider world already produces
(portal exports, WhatsApp groups, email, phone logs), adds the family's own
voice (check-ins, mood notes, ABC logs, LPA duties), and turns all of it into
reassurance, early warning, legal protection and transition evidence for
**Dad** (home care, Council) and **Mum** (Mum's care home).

Personas: Alex (admin / family lead, LPA), Pat (co-LPA, calendar-linked
availability), extended family (tiered consent), the social worker (external social worker,
time-boxed read-only links), agency staff (minimum-data roles).

## 2. Stack

| Layer | Dev (this workspace) | Production (Cloudflare) |
|---|---|---|
| UI | Next.js 16 App Router + Tailwind + shadcn/ui, dark mode by default | Same code — Workers via OpenNext, or Workers serving the API + Access-fronted portal |
| Client state | localStorage stores (versioned keys) | Same, plus D1 as source of truth |
| API | Next route handlers (`src/app/api/**`) | Worker (`cloudflare-worker/`) — same adapters |
| Data | `public/data/*.json` (prebuilt from the provider export) + Prisma/SQLite (inbox, share links, AI feedback) | D1 (family record, audit chain), R2 (documents), KV (consent cache) |
| AI | `/api/ai` stateless proxy + configurable engine | Same worker + AI Gateway + Workers-AI binding (zero-key fallback) |
| Ingest | Whapi webhook + email inbox routes | Email Workers + webhook + Queues |
| Audit | Hash-chained localStorage log (FNV-1a) | D1 append-only + nightly R2 anchor (SHA-256) |

## 3. Information architecture (ground-up redesign, batch 7)

The shell is a sidebar IA (drawer on mobile). Groups are ordered by what
matters: the parents first, then the family's control, then machinery.

1. **Family hub** — dashboard (both parents), my tasks, calendar, LPA &
   availability with Pat, family circle (Life360 location awareness).
2. **Dad** — overview, visits & notes, medication/eMAR, watch items
   (flag analytics), well-being index, conditions, schedule & package,
   documents, **My Day** (his dementia-friendly tablet view, `/kiosk`).
3. **Mum** — her care at Mum's care home: contact log, well-being tracker,
   escalation ladder, email/phone templates, WhatsApp group plan.
4. **Connect** — WhatsApp & inbox (Whapi.Cloud + dedicated email), share with
   advisers (time-boxed links for the social worker), AI review bridge.
5. **Intelligence** — family voice hub (check-ins, fresh-eyes survey, mood
   board, ABC/sundowning, calming & life story, consent matrix, capacity
   ledger, ACD vault), DCPI care index, recommendations.
6. **Oversight & assurance** — alerts, records audit (provenance + DQ log),
   social & comms, **Council ASC watch** (policy feed + contravention
   checks), API & data catalog.
7. **Workspace & tools** — AI assistant, downloads (xlsx/ods/csv/AI bundle),
   access & audit (RBAC, users, system audit trail), deploy & sync.

## 4. RBAC & audit

- `src/lib/access.ts` — 6 roles × 37 permissions with lawful-basis notes;
  user directory with invite lifecycle; acting-as switcher. The matrix is the
  specification for server-side enforcement on Workers.
- `src/lib/auditlog.ts` — tamper-evident hash-chained log of every governance
  action (60+ action labels), verifiable + exportable (CSV/JSON).

## 5. The data pipelines

```
Provider portal (the care portal export)
   └─ scripts/build_*.py ─→ public/data/*.json ─→ UI tabs
Family WhatsApp groups (Whapi.Cloud webhook/poll)
   └─ analyzeWaMessage() ─→ shopping list / tasks / calendar / concerns
Dedicated care email (/api/inbox; Email Routing in prod)
   └─ inbox ─→ care inbox card + audit
Life360 (unofficial API via /api/life360 proxy)
   └─ members' positions ─→ home-radius awareness
Family voice (check-ins, surveys, mood, ABC)
   └─ h360-* stores ─→ DCPI score, carer briefings, evidence packs
AI review loop
   └─ AI brief (.md) ─→ any AI ─→ JSON feedback blocks ─→ /api/ai/ingest
      ─→ apply to tasks/shopping/review queue (audited)
```

## 6. Key modules

| Module | Role |
|---|---|
| `src/lib/family.ts` | Tasks, shopping, visit sheets, calendar, availability + joint-slot engine, Mum stores, WhatsApp settings/extraction, ICS builder, email route |
| `src/lib/haven360.ts` | DCPI calculator + bands + statutory flags + report builder; family-voice stores; consent matrix; kiosk boards |
| `src/lib/life360.ts` | Life360 types, settings, haversine/radius logic |
| `src/lib/feedback.ts` | AI feedback contract + parser (fenced JSON blocks) |
| `src/lib/ai/engine.ts` | Multi-provider engine (proxy/worker modes), prompt builders |
| `src/lib/lpa.ts` | 20-item LPA framework (financial + health & welfare) |
| `src/lib/alerts.ts` | 14+ rule engine over record + family metrics |
| `src/lib/council` (`public/data/council.json`) | the council ASC policy register, duties, 9 contravention checks, escalation ladder |

## 7. Design principles in code

- **Two-tap reassurance**: dashboard answers "are they okay today?" first.
- **Dignity through data control**: consent matrix tiers, revocable shares,
  kiosk that can't be broken.
- **Statute as executable logic**: alerts, DCPI thresholds and Council
  checks are all duty → data → status evaluations.
- **Everything audited**: if it changes the record or shares it, it logs.
