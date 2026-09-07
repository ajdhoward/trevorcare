# Workspace ↔ repo bridge — how we keep building this together

This project is developed in an AI workspace and lives in your GitHub repo,
which Cloudflare deploys. The bridge is deliberately boring: markdown + two
scripts. Nothing proprietary, nothing to break.

## What lives in the repo for the AI

| Path | Purpose |
|---|---|
| `AGENTS.md` | Ground rules for any AI assistant working on this code |
| `docs/*.md` | Architecture, data flow, deployment, security, connectors, MCP, legal, family guide, AI review guide, changelog |
| `worklog.md` | Shared multi-agent work log, appended every session (Task IDs, decisions, artifacts) |
| `.ai/context.md` | **Generated** compact snapshot: tab inventory, components, routes, store keys, recent work |
| `scripts/ai_workspace_sync.py` | Regenerates `.ai/context.md` |
| `scripts/github_sync.sh` | One command: refresh context → commit → push |

## The loop, every session

```bash
# in the AI workspace, after finishing work:
python3 scripts/ai_workspace_sync.py      # refresh the AI snapshot
./scripts/github_sync.sh "batch 8: …"     # commit + push (Cloudflare deploys)

# in a NEW AI session (here or anywhere):
#   "Read AGENTS.md, docs/ARCHITECTURE.md, .ai/context.md and worklog.md first."
```

## Why this works for co-working with AI

- **No context loss**: the repo *is* the memory. Chat history compresses;
  `.ai/context.md` + `worklog.md` don't.
- **Any AI can pick it up**: Claude, Qwen, Codex — they all read the same
  four files and know the conventions, the guardrails and the state.
- **The portal stays the product**: docs and memory are versioned with the
  code they describe, so the "how it works" .md files can never drift behind
  reality for long — the sync script regenerates the inventory from
  `src/app/page.tsx` itself.

## Cloudflare side of the bridge

- **Workers Builds** (recommended): connect the repo once; every push deploys.
- **GitHub Action** alternative: add `CLOUDFLARE_API_TOKEN` secret; the
  shipped workflow deploys on pushes to `main`.
- The deploy checklist + AI Gateway config live in-app (Deploy & sync tab),
  and their state is documented in `docs/DEPLOYMENT.md` when you change it.
