# Changelog — how this platform progresses

Every batch appends here (and to worklog.md) — the docs say current-truth,
this file says history.

## Batch 13 — 07 Sep 2026 (this release)

**Cloudflare AI Gateway — first-class, wizard-driven, cost-validated**

- **Engine-native gateway routing**: set `gatewayAccountId` + `gatewayId` in
  the AI engine settings and every provider call is routed through
  `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/…` (BYOK
  passthrough) — OpenAI, Anthropic, Google AI Studio, Workers AI (REST), and
  OpenAI-compatible providers via their gateway slug (groq, openrouter,
  deepseek, mistral, perplexity, cohere, grok, together — auto-derived from
  the base URL or set manually). Shared rewrite logic in
  `src/lib/ai/gateway.ts`, mirrored self-contained in the deployable worker
  (`cloudflare-worker/src/index.ts`), which also routes the Workers-AI
  binding natively via `env.AI.run(model, input, { gateway: { id } })`.
- **New system wizard — "Connect Cloudflare AI Gateway"**: seeded into the
  wizard framework (per-key seeding so existing databases get it), launched
  from the Deploy & sync tab step 4 or the Wizard studio. Two steps, ends
  with a **live test call**; runs client-side so the provider key and engine
  settings never leave the browser. New `password` field type in the wizard
  framework (rendered masked, never posted to the server).
- **AI assistant settings**: new "Cloudflare AI Gateway" panel (account ID,
  gateway name, provider slug for openai-compatible, live endpoint preview,
  routing badge) — the wizard prefills the same fields.
- **Deploy & sync step 4 modernised**: applies native gateway settings
  (instead of the old openai-compatible base-URL hack) and offers the guided
  wizard with the live test.
- **Cost validation** (verified against Cloudflare docs, Sep 2026): the
  gateway's core features are free on every plan; Workers AI includes a free
  daily neuron allocation ($0.011 per additional 1,000 neurons); the Workers
  Paid plan ($5/mo) includes 10M requests + 30M CPU-ms/month, and D1/KV/R2
  free allowances cover a family-scale deployment several times over. A
  single-family deployment of this app fits comfortably inside $5/month —
  see docs/DEPLOYMENT.md §Cost.
- Seed-once seeding is now per-key so new built-in wizards appear in
  databases created by earlier versions.

## Batch 11 — 07 Sep 2026 (this release)

**Systems-Review delivery + security gate + push-to-repo pipeline**

All five backlog items from the End-to-End System Review are now live, plus
the security gate and the one-click GitHub pipeline — all on sample data.

- **Authentication gate** (P0): fail-closed middleware + `/login` +
  `/api/auth/*`; signed HttpOnly session cookie (30 days) with context-aware
  attributes (Lax on plain HTTP, `None; Secure; Partitioned` in production
  iframes); brute-force throttling; header sign-out; `PORTAL_PASSWORD` /
  `SESSION_SECRET` secrets (`.env.example`).
- **Calls & evidence tab** (Connect group): searchable transcripts with
  evidence highlights and audited copying; contact-volume early-warning panel
  (3× trailing-14-day-mean rule, floor 2/day) with the documented 33-call-day
  spike as a worked example and the four-step response ladder.
- **Care Hub & legal tab** (Oversight group): transition case file (verdict →
  evidence → core metrics), tickable prioritised next actions (owners + due
  dates), knowledge briefings & runbooks, **statutory dossier generator**
  (s42 request, s117 aftercare demand, Best Interests statement, handoff
  protocol letter — placeholders auto-filled, acknowledgement clocks with
  dispatch log + escalation states), **agency handoff register** (acceptance
  tracking with automatic 4-working-hour / 24-hour escalation clocks, CSV
  export).
- **Tracker integration** (Family circle): status card (ordered → fitting →
  active), 5-step fitting checklist, honest-boundary note, and the P1
  **exit-event log** (last-seen, battery, source) feeding the elopement theme
  and the spike alert's composite confirmation.
- **Medication reconciliation view** (P2, Medication tab): pharmacist-led
  cycle card (duplicate-pack tracker), no-splitting + PRN-window directive
  checkboxes, structured eMAR exception flags, free-text conversion hints,
  monthly audit CSV export.
- **Push-to-repo pipeline** (Deploy & sync step 1): real "Push portal to repo"
  button (`/api/push`, token used once and never stored), fine-grained-PAT
  guide, `ci.yml` (typecheck + demo-data + identity-marker tripwire),
  `deploy.yml` (worker deploy), `docs/GITHUB-SETUP.md`, and a
  **portal-source.zip** download in the Downloads tab.
- **Storage decision card**: the researched Google-Drive-vs-Cloudflare
  conclusion (don't glue Drive into the request path; R2 instead) recorded in
  Deploy & sync + docs.
- Downloadable sample workbook/CSV/AI-bundle assets regenerated from the
  sample record so every Downloads link works out of the box.

## Batch 7 — 06 Sep 2026 (this release)

**Ground-up redesign + Haven 360 (Qwen spec) integration + deployment layer**

- Shell rebuilt: sidebar IA (7 groups, 30 surfaces) — Family hub / Dad ·
  Dad / Mum / Connect / Intelligence / Oversight & assurance /
  Workspace & tools; mobile drawer; parents-first ordering.
- **Deploy to Cloudflare** tab: repo → button (deploy.workers.cloudflare.com)
  with guided decisions (URL, secrets via `.dev.vars.example`, resources),
  8-point security checklist, AI Gateway wizard (writes engine settings),
  GitHub sync (Workers Builds + shipped Action), workspace↔repo bridge.
- **Council ASC watch**: real the council contacts, policy sources feed, 9 duty→data
  contravention checks, 7-rung escalation ladder, policy-ingest → tracked
  commitments.
- **Family voice hub** (Qwen §07/§06/§03): daily check-in + confidential
  burnout, fresh-eyes micro-decline survey, mood board, ABC log with
  sundowning histogram, calming strategies, life-story co-authoring, consent
  matrix with one-tap tiers, capacity ledger with contest flag, ACD/ReSPECT
  vault.
- **DCPI** (Qwen §08): 7-indicator live score with calibrated weights,
  Green→Crimson bands, statutory threshold flags (≥3% weight ⇒ MUST
  re-assessment, wander ≥3/wk, burnout ≥7 ⇒ s.10, …), one-tap transition
  report (.md) for Care Act s.9 requests.
- **My Day kiosk** (`/kiosk`): Dad's dementia-friendly tablet — huge clock,
  who's coming, choice boards (flow back as audited choices), photo wall,
  calming anchors, giant call button.
- **Share with advisers**: time-boxed revocable read-only briefs at
  `/share/{token}` (view-counted) + WhatsApp hand-off — built for the social worker
  (the family's town).
- **Life360 connector**: unofficial-API proxy, circles/members, home-radius
  awareness, battery/check-in badges.
- **AI review bridge**: AI-efficient brief for both parents + JSON feedback
  contract + paste/file ingest (AiFeedback table) + apply-with-audit.
- **Docs set** (this folder) + README + AGENTS.md + deploy infra
  (`.dev.vars.example`, GitHub Action, `github_sync.sh`,
  `ai_workspace_sync.py`).
- RBAC: 8 new permissions (familyvoice, dcpi, share, life360, aibrief,
  council, deploy, kiosk + share_manage/ingest); audit log: 24 new actions.

## Batch 6 — 05–06 Sep 2026

Family-first reconfiguration: dual-parent hub, per-visit task sheets with
shopping-list field, family calendar + task views, dedicated email interface
(`/api/inbox`), LPA joint availability with Pat (ICS link → suggested
mutual days → proposals), 20-item LPA checklists, Mum's email/phone protocol
(Mum's care home), Whapi.Cloud WhatsApp group integration (webhook +
poll, extraction into shopping/tasks/calendar).

## Batch 5 — 05 Sep 2026

Governance layer: API & data catalog, system audit trail (hash chain),
users/roles/permissions (6×23), alerting engine + notification bell,
write-capability verdict (family APIs are read-only; carer writes only).

## Batch 4 — 05 Sep 2026

Forensics + AI engine + dark mode: next-of-kin provenance (verbatim portal
contacts API; Kin-1 empty; Contact A listed Kin-2/3), Alex in 11 notes but
absent from contacts, Alzheimer's never named but strongly signposted
(Memantine/Risperidone, memory clinic, confusion notes), no edit-audit for
family role; multi-provider AI engine + Cloudflare worker kit; Social & comms
tab; records audit tab; DQ-1…6 log; dark by default.

## Batch 3 — 05 Sep 2026

Insight layer: flag analytics (10 themes, heatmap, clusters), well-being index
+ gauge, conditions & mitigation, s17/s117 applicability, recommendations with
email generation, care-plan regeneration, ODS/CSV formats, context-window
guidance.

## Batches 1–2 — 05 Sep 2026

Interface + complete record (Oct 2025 → Sep 2026, 1,283 visits), formatted
master workbook, AI review bundle (41+ files), 7 core tabs, format choices,
care plan included, provenance questions logged.
