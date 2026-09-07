# Data flow — where every byte comes from and where it goes

## 1. Dad's care record (Dad)

```
the care portal provider portal API (with consent, via family login)
  → GET endpoints: client profile, contacts, visits (1,283), visit tasks
    (20,054 outcomes), eMAR (11,020 rows), meds, flags (639), absences,
    care package, documents (24 files)
  → workspace_extract/*.py pulls → JSON/CSV
  → scripts/build_beautiful_xlsx.py  → formatted master workbook (xlsx/ods/csv)
  → scripts/build_insights.py        → wellbeing, flags_analytics, conditions,
                                       recommendations, sections17_117
  → scripts/build_audit.py           → provenance/forensics + DQ log
  → scripts/build_api_catalog.py     → API endpoint inventory + sensitivity
  → scripts/prepare_web_data.py      → record.json + documents.json
  → public/data/*.json               → the UI tabs (read-only)
```

The UI never mutates the provider record. Corrections and contested facts live
in the **Records audit** tab (DQ-1…6) and the **capacity ledger** — the family
holds its own parallel truth with sources.

## 2. Family WhatsApp groups (Whapi.Cloud)

```
Phone app "Linked Devices" → Whapi gateway number joins both groups
  POST /api/whapi/webhook  (or UI poll → GET /api/whapi/webhook)
  → InboundMessage rows (Prisma; D1 in prod, deduped by source+msgId)
  → UI mirrors to care-wa-cache-v1
  → analyzeWaMessage() extracts:
      • shopping cues  ("we need bleach")     → Dad's shopping list
      • task cues      ("boiler service due") → family tasks
      • appointment cues (date/time)          → family calendar
      • concern themes (confusion, falls…)    → watch items / alerts evidence
  → every ingest: audit "wa.ingest"
```

Send path: the portal → `POST /api/whapi/send` → `POST gate.whapi.cloud/messages/text`
to the bound group IDs (`@g.us`). Token stays device-local.

## 3. Dedicated care email

```
mailbox (e.g. care@yourdomain) ── Cloudflare Email Routing ──▶ Email Worker
  → POST /api/inbox (InboundMessage, source="email")
  → Care inbox card (Connect → WhatsApp & inbox) + "inbox.ingest" audit
```

Outgoing: email generator drafts (mailto) with evidence quotes; templates for
the agency, GP, the council, the care-home group in Social & comms and Mum's care tabs.

## 4. Mum — no portal on the home's side

The family is the sensor + the record:

```
Family phone/email/WhatsApp-with-home
  → Mum's care tab: contact log (call/email/visit/video, follow-ups),
    1–5 well-being tracker with tags, escalation ladder, templates
  → care-mum-contacts-v1, care-mum-wb-v1 (+ audit entries)
```

Feeds: dashboard Mum panel, AI brief, Council check `chk-mum-home`
(watch at 7 days without contact, breach at 14).

## 5. Family voice & DCPI

```
Daily check-in (stamina/sleep/confusion/appetite + confidential burnout)
Fresh-eyes survey (fortnightly visitor deltas)   Mood board
ABC episodes (hour → sundowning histogram)       Calming + life story
  → h360-* stores → DCPI inputs → score 0-100 → band
     → statutory thresholds (weight ≥3% ⇒ MUST re-assessment…)
     → Compile transition report (.md) → Care Act s.9 request evidence
```

## 6. Location (Life360)

```
Life360 app ── unofficial client API (api.cloud.life360.com/v3)
  → POST /api/life360 {action: login|circles|members}   (server proxy)
  → members' lat/lon → distance from home (haversine) vs radius
  → "outside the radius" awareness card; credentials device-local only
```

## 7. AI review loop (closed)

```
AI review bridge tab
  → builds AI-efficient brief (both parents + contract)  [.md download]
  → any AI reviews it
  → reply pasted / .md+.json uploaded → POST /api/ai/ingest
      → extractFeedbackItems() parses fenced JSON blocks
      → AiFeedback row (raw + parsed) stored
  → family applies each item: task_add → tasks · shopping_add → shopping
      · recommendation/note/correction/question → review task
  → audit: feedback.ingest / feedback.apply
```

## 8. Sharing with advisers (the social worker)

```
Share tab → POST /api/share → ShareLink (token, scope, expiry)
  → link via wa.me to the social worker's WhatsApp
  → GET /share/{token} (server-rendered, read-only brief, view-counted)
  → revoke (PATCH) kills it instantly; expiry enforced at view time
```

## 9. What leaves the browser — and when

| Data | Leaves device? | Where |
|---|---|---|
| Record JSON | Only to the UI's own origin (static files) + AI calls you trigger | `/api/ai` proxy or your Worker |
| AI provider keys, Whapi token, Life360 creds | Only per-call to the app's own proxy | never stored server-side |
| Share links, AI feedback, inbox | Stored in Prisma/SQLite (D1 in prod) | server |
| Everything else (stores) | localStorage only | device |

Retention: family-controlled; audit chain capped at 600 events locally (full
chain in D1 in production); exports put the data back in your hands (DSAR
posture, docs/SECURITY.md).
