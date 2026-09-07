# Privacy & data segmentation — READ BEFORE COMMITTING

This repository is the **public template** copy of a family care portal. It
contains **only synthetic sample data**. The private instance (the family's
real copy) keeps the same shape but adds the real datasets locally.

## Never commit these (git-ignored below)

| Path | Contents |
|---|---|
| `public/data/*.json` | The real care record (visits, carer notes, eMAR, contacts). Sample versions are committed; real exports stay local. |
| `public/downloads/` | Care plans, risk assessments, exports, bundles |
| `workspace_extract/` | Portal scrapers + raw API snapshots (contain credentials) |
| `scripts/` | The family's private data pipeline |
| `worklog.md`, `.ai/` | Family work narrative |
| `.env`, `.dev.vars`, `.npmrc` | Credentials / local config |

## If you fork this for your own family

1. Keep this file and the `.gitignore` rules intact.
2. Drop your real `record.json`, `wellbeing.json`, … into `public/data/`
   locally. The app picks them up automatically.
3. Put portal credentials in `.dev.vars` / Worker **secrets**, never source.
4. Before `git push`, run the self-check:
   ```bash
   grep -rInE "your-family-surname|your-address|your-email" src docs public/data
   ```
   Zero hits (excluding PRIVACY.md examples) or do not push.
5. **Never push the private repo's history to the public one.** Start from a
   fresh `git init` — git history cannot be safely "partially" published.

## What was removed to make this template public

- All real care-record datasets, documents and downloads
- Portal credentials (rotate any password that ever touched a shared file)
- Family names/addresses/phone numbers replaced with sample personas
  (Dad, Mum, Alex the family admin, Pat the co-attorney) and Ofcom-reserved
  fictional phone numbers (07700 900xxx / 01632 960xxx)
