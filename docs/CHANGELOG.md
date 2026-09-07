# Changelog — how this platform progresses

Every batch appends here (and to worklog.md) — the docs say current-truth,
this file says history.

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
