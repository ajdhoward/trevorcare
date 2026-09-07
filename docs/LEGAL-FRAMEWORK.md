# Legal framework — statute as executable logic

The family should never need to be a lawyer; the portal runs the statutes
continuously and turns silence into alerts. This doc maps each framework to
where the code enforces, measures or evidences it. **Informational, not legal
advice** — statutory interpretations should be validated with the relevant
ICB/LA, and the Records audit + Social & comms tabs hold the correspondence.

## Mental Health Act 1983

| Section | Duty | Portal implementation |
|---|---|---|
| **s.117** | Free aftercare for people discharged from s.3 detention — joint ICB/LA duty, never chargeable | Legal panel in Conditions tab (verdict on applicability + cross-refs); charging check `chk-charging` flags any bill touching s.117 care; Qwen-spec billing-guard is the production Workflows shape |
| **s.17** | Conditioned leave from hospital | s.17 applicability analysis (record shows **zero** s17/s117 mentions — the family watched this deliberately); if leave ever applies, condition timers + breach→RC evidence packs per spec §06 |

## Mental Capacity Act 2005 (+ DoLS/LPS)

- **Capacity ledger** (Family voice → Capacity & ACD vault): time-stamped,
  decision-specific entries the family holds, with a contest toggle — a
  defensible MCA trail for every decision window.
- Restraint/restriction watchdog posture: flagged-note themes surface
  locked-door/hold language; alerts route to safeguarding.
- Advance documents: ACD / ReSPECT / DNACPR vault with status and location —
  prompted gently while Dad can still take part.

## Care Act 2014

| Duty | Portal |
|---|---|
| s.9 needs assessment + review (annual for progressing dementia) | DCPI + Council check `chk-plan-review`; transition report attaches to review requests |
| s.10 carer's assessment | burnout self-check ≥7 raises it in the DCPI statutory flags |
| s.42 safeguarding enquiry | declined-care patterns alert (14 default rules) + Council check `chk-declined-care` with escalation ladder |
| s.67 independent advocacy | `chk-advocacy` — watches for advocacy evidence in the record |
| s.14 charging + Charging Regs | `chk-charging` — no-billing-visibility is itself tracked; dispute pack route |
| s.1 wellbeing principle / involvement | family-involvement check via comms log + WhatsApp ingest evidence |

## Health & Social Care Act 2008 (Regulated Activities)

- Reg. 9 person-centred care, Reg. 12 safe care & treatment (med exceptions
  watch), Reg. 13 safeguarding, Reg. 20A duty of candour — mapped in
  Conditions tab and the recommendations' evidence quotes; CQC is a named
  escalation rung in the Council ladder.

## Data protection — UK GDPR / DPA 2018

- Role × permission matrix with recorded lawful bases (Art. 6/9), accuracy
  chase (Art. 5(1)(d)) for the DQ log, DSAR-ready exports (Art. 15),
  rectification letters (Art. 16), consent revocation (Art. 7) via the
  consent matrix + share revocation. See docs/SECURITY.md.

## LPA (Mental Capacity Act 2005, ss.9–14)

- 20-item framework (`src/lib/lpa.ts`): 10 property & financial + 10 health &
  welfare duties, each assigned to an attorney (Alex / Pat / either),
  with joint-availability scheduling so the co-attorney is genuinely involved
  — not just named.

## Local overlay — Council

- the council ASC is commissioner + safeguarding authority for both parents' care.
  Policy feed, contravention checks, real contacts (01632 960004 ·
  complaints@council.example.gov.uk · Healthwatch support) and the 7-rung ladder
  live in **Oversight → Council ASC watch**; CQC rated the council's own ASC
  *Good* (March 2026) — cite it when pressing for enforcement.
