# Security & data protection posture

## 1. The threat model (family-owned data)

What matters: the record is intimate (health, behaviour, finances, family
relationships). The realistic risks are (a) account/URL sharing leaking the
portal, (b) over-broad access by well-meaning family/agency users, (c) silent
tampering with the record or the audit trail, (d) third-party AI or connectors
over-reaching, (e) device theft.

## 2. Controls in the portal

| Control | Implementation |
|---|---|
| Least privilege by role | `src/lib/access.ts` — 6 roles × 37 permissions, lawful-basis noted per role; carers see only the shift view; tab + action gating throughout |
| Identity | Dev: acting-as switcher. Prod: **Cloudflare Access** (Zero Trust) in front of the portal + Turnstile on public endpoints; statuary partners get **time-boxed read-only views** (share tokens), never accounts |
| Tamper evidence | `care-sysaudit-v1` hash-chained audit log (seq+prevHash+hash), verify + CSV/JSON export; production = D1 append-only + nightly R2 anchor |
| Data minimisation | Carer/mobile roles don't see contacts; documents gated by `data.documents`; sensitivity classes in the API catalog (operational/health/personal/internal) |
| Consent | Consent matrix (full/lifestyle/activities/none per relative, one-tap revocation); share links scoped + view-counted + instantly revocable |
| Secrets | Provider/WhatsApp/Life360 credentials stay in localStorage, forwarded only to the app's own proxy; nothing in the repo (`.dev.vars.example` is the template; real values are Worker secrets) |
| Corrections | Wrong data (e.g. DQ-1 next-of-kin) is never silently edited — it's logged, evidenced and chased with the agency; GDPR Art. 15/16 routes documented in Records audit |
| kiosk safety | `/kiosk` is read-mostly: choices flow in, nothing about the record flows out |

## 3. Controls on the platform (Cloudflare)

- **Access policies**: allow Alex + Pat's emails; emergency access for
  the social worker's review windows; log every authentication.
- **TLS 1.3 only + HSTS + Always Use HTTPS**.
- **UK data path**: D1/R2 created with UK location; Data Localisation Suite to
  keep requests in-jurisdiction; no sub-processors beyond UK adequacy.
- **D1 Time Travel** (PITR) + R2 versioning → RPO ≤ 24 h / RTO ≤ 4 h.
- **WAF/bot management** default on; webhook endpoints require shared secret.
- **Turnstile** on share/webhook entry points.

## 4. AI safety rules

- The engine never sends data to a provider unless you (or the acting user
  with `action.ai_use`) trigger it; every send is audited (`ai.send`).
- AI Gateway: caching + rate limits + optional payload logging (default off).
- Workers-AI binding gives a zero-exfiltration path for classification
  (clinical/lifestyle partition, watchdog NLP) when you want no external keys.
- The AI review brief tells external AIs to quote evidence and return JSON —
  the ingest parser drops anything else, and **you** apply each item; AI never
  writes directly to the record.

## 5. Data subject rights (UK GDPR posture)

- **DSAR export** — Downloads tab + bundle gives machine- and human-readable
  everything in minutes (Art. 15).
- **Rectification** — DQ log + correction request letters (Art. 16), with the
  who-changed attribution routes documented for the agency.
- **Erasure/retention** — family-controlled retention; exports + store keys
  documented so deletion is provable.
- **Lawful bases** — recorded per role and per processing class in access.ts.

## 6. Device hygiene checklist for the family

1. Phone/tablet passcodes on, browser signed-in only via Access.
2. Whapi token + AI key: paste per browser; revoke from the provider's
   dashboard if a device is lost.
3. Keep the exports (xlsx/bundle) inside UK-resident storage only.
4. Quarterly: run "Verify chain", export the audit JSON, re-run the deploy
   checklist in the Deploy tab.
