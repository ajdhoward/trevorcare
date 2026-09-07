# AGENTS.md — ground rules for AI assistants working on this repo

You are working on a **family-owned care-intelligence portal** template for a
parent receiving domiciliary care (Dad) and a parent in residential care
(Mum). Read this before changing anything.

## Read first (in this order)

1. `docs/ARCHITECTURE.md` — the system map
2. `docs/PRIVACY.md` — what may and may not be committed
3. `docs/CHANGELOG.md` — batch history

## Product rules

- **Mum and Dad outrank everything.** Features must serve their well-being or
  the family's convenience/control. If they serve neither, they go in
  Workspace & tools — or nowhere.
- **Never silently edit the record.** Provider facts are immutable here;
  corrections live in the DQ log / capacity ledger with evidence.
- **If it changes or shares data, it must audit** — use `logEvent` +
  `ACTION_LABELS` in `src/lib/auditlog.ts`.
- **RBAC is law.** New views need a permission in `src/lib/access.ts` with a
  lawful-basis note, mapped across all 6 roles.
- **Dark mode by default**, teal palette, shadcn/ui components only, mobile
  must work (drawer nav) — families use phones in hospital corridors.
- **No fake data presented as real.** Contacts/values you don't have stay as
  explicit placeholders ("fill from admission pack"). Never invent care facts.
- **Nothing personal in the repo.** The public repo carries synthetic sample
  data only (`public/data/*.json`). Real exports stay local — see PRIVACY.md.

## Conventions

- Client store keys are `care-*-v1` / `h360-*` in localStorage.
- Static datasets live in `public/data/`; docs in `docs/`.
- Keep the audit chain intact: every governance-relevant action lands in
  `logEvent` with labels.
