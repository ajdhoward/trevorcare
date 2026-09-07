# MCP servers — extending the portal and its AI

The portal's AI works best when an MCP-capable assistant (Claude, Cursor,
Windsurf, or this workspace) can reach the same surfaces the family uses.
Below: the servers worth connecting, and exactly what each one does for
Dad's and Mum's care. Keep the list tight — every connector is one more
thing to audit.

## Cloudflare's managed remote MCP servers (OAuth, no hosting)

| Server | What it gives the portal |
|---|---|
| **Docs** (`docs.mcp.cloudflare.com/sse`) | Instant, current answers on Workers/D1/R2/Access/AI Gateway while we build — fewer wrong-config deploys |
| **Bindings** | The AI can probe your actual Workers bindings (D1/KV/R2) — "does the share-links table exist yet?" gets answered, not guessed |
| **Observability** | Pull real worker logs/errors into the AI's context when something misbehaves post-deploy |
| **Radar** | Network/security context if the portal ever looks blocked or abused |
| **Browser rendering** | Generate the ombudsman/CQC-ready evidence-pack PDFs server-side |

## Local/standard servers (run next to the repo or the AI client)

| Server | Portal use |
|---|---|
| **filesystem** (scoped to this repo) | The AI reads docs/, worklog, scripts — the whole bridge story — without chat uploads |
| **git** | Sensible commits/branches during our co-working sessions; pairs with `scripts/github_sync.sh` |
| **github** | Issues for care tasks that become code ("add aware-of-UTI flag"), PR reviews, Action status |
| **sqlite / prisma** | Direct, safe queries on `db/custom.db` (InboundMessage, ShareLink, AiFeedback) during development |
| **memory** (knowledge graph) | Persistent family-context memory: who's who (family contacts), consent tiers, preferences — so the AI never re-asks |
| **sequential-thinking** | Longer DCPI / safeguarding reasoning chains without the model losing the thread |
| **fetch** | Pull the council/CQC/NICE pages into context when we harden the policy checks |
| **playwright/puppeteer** | E2E the same way I verify: open tabs, click flows, screenshot regressions |

## The portal-side MCP endgame (documented, not yet wired)

The natural next step is **the portal exposing its own MCP server** on the
Cloudflare Worker (Streamable HTTP + Access OAuth):

- tools: `get_todays_picture(person)`, `list_open_alerts()`,
  `get_dcpi_history()`, `add_task()`, `add_shopping_item()`,
  `draft_letter(template, recipient)`, `compile_evidence_pack(range)`
- every tool enforcing the same RBAC matrix (`src/lib/access.ts`) and writing
  to the same hash-chained audit log
- so the social worker's assistant — with family-granted time-boxed scope — could ask
  "what changed for Dad this fortnight?" without ever touching the raw DB.

Track `cloudflare/agents` (remote MCP guide) for the reference wiring; the
worker already has the auth skeleton (shared key + CORS) to bolt it onto.

## Guardrails

- No MCP server gets more than its job needs (filesystem root = this repo;
  github token = repo-scoped; sqlite = read-only if you can).
- Anything that writes (tasks, letters) must re-use the portal's own audit
  functions, not bypass them.
- Personal data stays in the family's own infrastructure — no third-party
  MCP SaaS sees the record.
