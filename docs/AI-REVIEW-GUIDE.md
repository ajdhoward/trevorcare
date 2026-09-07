# AI review guide — the export → review → ingest loop

## Why a special format

A full review of both parents' care involves ~150k tokens of documents plus
six months of structured data. The **AI review bridge** tab solves this in
two layers:

1. **Deep bundles** (Downloads tab): the complete xlsx/ods/CSV zip + policies +
   care plan + insights JSON — for thorough, file-based AI review.
2. **The AI-efficient brief** (Connect → AI review bridge): one compact
   markdown export with exactly what an AI needs — both parents' 30-day
   picture, known data-quality issues, DCPI, open tasks — plus the feedback
   contract. Cheap enough for any model, any chat.

## The feedback contract

The brief instructs the AI to reply with fenced JSON blocks:

```json
[
  {"kind": "task_add", "title": "Book hearing-aid retube", "detail": "3 notes mention whistling", "person": "dad", "due": "2026-09-20"},
  {"kind": "shopping_add", "item": "Bleach", "person": "dad"},
  {"kind": "recommendation", "title": "Request s.9 reassessment", "priority": "High",
   "rationale": "DCPI 31 and rising", "actions": ["Attach DCPI report", "Copy social worker"]},
  {"kind": "note", "text": "Risperidone dose exceptions cluster on Sundays", "severity": "warning"},
  {"kind": "correction", "field": "next_of_kin", "value": "Alex (son)", "evidence": "11 carer notes name Alex as son"},
  {"kind": "question", "title": "Has a carer's assessment ever been offered?", "detail": "s.10 trigger"}
]
```

Kinds: `task_add · shopping_add · recommendation · note · correction ·
question`. Anything unparseable is kept as raw text; nothing is auto-applied.

## The loop

```
1. Connect → AI review bridge → "Download brief (.md)"  (or Copy)
2. Give it to any AI (this portal's own assistant, Claude, Qwen, a chat UI,
   or the AI bundle for deep review)
3. AI answers with the contract above
4. Paste the reply into "Bring the AI's feedback in" (or upload its .md/.json)
5. Inbox shows every parsed item → "Apply → portal" per item:
     task_add      → My tasks (person + due date)
     shopping_add  → the shopping list (addedBy "AI review")
     others        → a 7-day review task with the evidence attached
6. Mark applied / dismiss — statuses stored (AiFeedback table)
```

Every step is audited: `export.file` → `feedback.ingest` → `feedback.apply`.

## Design guarantees

- **AI never writes directly**: ingestion is parse-only; a human applies.
- **Evidence or it didn't happen**: the contract demands quotes; corrections
  without evidence belong in the DQ log instead.
- **Raw copy kept**: the exact text ingested is stored for audit.
- **UK GDPR**: send data to providers only deliberately (see SECURITY.md §4);
  the brief is a family-owned export you choose to share.
