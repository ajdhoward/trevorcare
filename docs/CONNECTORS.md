# Connectors — everything the portal plugs into

## Live in the portal today

### 1. Whapi.Cloud — WhatsApp groups (Dad's group; Mum's group incl. the care home)
- Link the gateway number: dashboard → Linked Devices → QR (3-minute job).
- Portal setup: Connect → WhatsApp & inbox → paste token → bind group IDs
  (`GET gate.whapi.cloud/groups`, IDs end `@g.us`).
- In: webhook (`/api/whapi/webhook`) or poll → extraction into shopping list,
  tasks, calendar, concern themes (niece-in-law updates contribute to flows).
- Out: test send + templated sends to bound groups (action `wa.send`, audited).

### 2. Dedicated care email
- Dev: `POST/GET /api/inbox` (dedupe + store).
- Prod: Cloudflare Email Routing → Email Worker → `/api/inbox`
  (recipe: `cloudflare-worker/README.md`).

### 3. Life360 — family circle location (unofficial API)
- Connect → Family circle: sign-in or paste token → circles → members.
- Home coordinates + radius → "outside the radius" awareness; battery/check-in
  badges. Unofficial: community-documented `api.cloud.life360.com/v3` endpoints
  via our proxy; may break; credentials device-local. Official-API-free areas
  (e.g. if Life360 blocks) degrade gracefully to manual check-ins.

### 4. Council Adult Social Care (the council ASC) — policy data-point
- Oversight → Council ASC watch: policy sources feed (real the council routes),
  9 duty→data contravention checks, escalation ladder (01632 960004,
  complaints@council.example.gov.uk, Healthwatch, CQC, LGSCO), and a policy-ingest
  box that turns pasted council text into tracked commitments.

### 5. External AI providers (review + generation)
- Multi-provider engine: OpenAI, Anthropic, Google, Cloudflare Workers-AI
  (zero-key), any OpenAI-compatible base URL.
- Cloudflare AI Gateway wizard (Deploy tab) puts caching/rate-limits/logs
  in front of all of it.

### 6. Read-only share links for advisers
- `/share/{token}` — the family's social worker gets a WhatsApp link;
  time-boxed, revocable, view-counted, no account needed.

## Roadmap connectors (Qwen Haven 360 §09 alignment)

| Connector | Status | Notes |
|---|---|---|
| Log my Care / Nourish / Birdie / Care Control / PASS | roadmap | REST family-scoped OAuth; normalised to family schema at ingest |
| Generic FHIR R4 gateway | roadmap (documented shape) | mTLS + consent filter before fan-out |
| NHS dm+d / TRUD medicine leaflets | roadmap | plain-language summaries cached in KV |
| CQC Provider API | ready to add | inspection ratings for the provider + the care-home group (open ODbL) |
| what3words | ready to add | key-safe/exit pins for the Herbert Protocol |
| Google Routes / TransportAPI | ready to add | ETA countdowns, accompanied-appointment planning |
| OpenReferral UK | ready to add | dementia cafés, carer groups (Council directory) |
| GOV.UK Notify | production (public sector) | statutory SMS/email dispatch |
| HealthKit / Health Connect | consented, device-side | sleep/HR/fall events into DCPI |

## Adding a connector — house rules

1. One lib file (`src/lib/<name>.ts`) + one proxy route (`/api/<name>`) +
   one card/section in the right tab; credentials device-local unless
   unavoidable.
2. Inbound data lands raw + processed (never overwrite provider facts);
   provenance fields on everything.
3. Audit both directions (`*.ingest` / `*.send`).
4. Sensitivity-class the fields; extend RBAC if a new view permission is
   needed; document in this file.
