# Care Record AI Engine — Cloudflare Worker

A self-contained inference gateway you own, deployable to the **Cloudflare
developer platform** (Workers). It exposes the same `/api/ai` contract as the
interface's built-in proxy, so the interface can run its whole AI layer
(email drafting, care-plan regeneration, record Q&A) through infrastructure
you control.

## What it gives you

| Capability | Detail |
|---|---|
| Bring your own provider | OpenAI, Anthropic, Google Gemini, any OpenAI-compatible endpoint (Groq, OpenRouter, Ollama, vLLM…), Cloudflare Workers AI |
| **Zero-key inference** | The bundled `[ai]` binding runs Cloudflare's own models (e.g. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) with no API key at all |
| Shared-key gate | Optional `ENGINE_SHARED_KEY` secret so only your family can call the worker |
| CORS | Browser-friendly; deploy once and paste the URL into the interface |
| Stateless | No logs of content, nothing persisted; observability can be toggled in `wrangler.jsonc` |

## Deploy (about 2 minutes)

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints your URL: `https://care-record-ai-engine.<your-subdomain>.workers.dev`

Optional hardening:

```bash
npx wrangler secret put ENGINE_SHARED_KEY     # then use the same key in the interface
```

## Point the interface at it

1. Open the interface → **AI assistant** tab.
2. **Engine mode** → `Cloudflare Worker`.
3. **Worker URL** → paste your `https://…workers.dev` URL.
4. **Shared key** → the value you set above (leave blank if you skipped it).
5. **Provider** → `Cloudflare Workers AI (Worker binding — no key)` and a model
   such as `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
   (or pick OpenAI / Anthropic / Google / custom and paste that key instead —
   the key is then sent per-request to *your* worker, never stored here).
6. **Test connection** → you should see `OK` and a latency figure.

## Endpoint reference

`POST /api/ai`

```jsonc
{
  "provider": "workers-ai",            // openai | openai-compatible | anthropic | google | cloudflare | workers-ai
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "messages": [ { "role": "user", "content": "ping" } ],
  "temperature": 0.3,
  "maxTokens": 1200,
  // per-provider extras:
  "baseUrl": "https://api.groq.com/openai/v1",  // openai-compatible
  "cfAccountId": "…",                            // cloudflare API-token mode
  "apiKey": "…"                                  // skipped entirely for workers-ai
}
```

Response: `{ "text": "…" }` on success, `{ "error": "…", "hint": "…" }` otherwise.

`GET /health` → `{ ok: true, bindings: { workersAI: true } }`

## Security notes

- The family interface stores provider keys **only in the browser**
  (localStorage) and posts them to the engine over HTTPS per request.
- Setting `ENGINE_SHARED_KEY` prevents strangers from using your worker with
  their own keys or burning your Workers AI quota.
- Workers AI inference happens inside Cloudflare's network; content is not
  persisted by this worker.

## Hosting the whole interface on Cloudflare

The interface itself is a static export candidate (`next build` with
`output: 'export'` style hosting or Workers Static Assets): all record data is
served from `/data/*.json` and user governance state lives in the browser.

The governance layer shipped in the interface — roles & permission matrix,
user directory, alerting rules and the hash-chained audit trail — runs
client-side by design. For a hardened multi-user deployment:

| Concern | Today (single browser) | Production upgrade path |
|---|---|---|
| Identity | Acting-as session switcher (localStorage) | Cloudflare Access (Zero Trust) in front of the static assets — one policy per role |
| Roles / permissions | `src/lib/access.ts` matrix, enforced in the UI | Enforce the same matrix in the Worker before serving `/data/*` (per-role data views) |
| Users directory | `care-users-v1` localStorage | Workers KV or D1 table; invites via Access email OTP |
| Alert rules & state | `care-alert-rules-v1` / `care-alert-state-v1` | KV/D1 + a Cron Trigger that runs the same rule engine daily and emails via MailChannels |
| Audit trail | Hash-chained log (FNV-1a, demo grade) in `care-sysaudit-v1` | Append-only D1 table + HMAC chain keyed by a Worker secret (tamper-evident server-side) |

The rule engine (`src/lib/alerts.ts`) is dependency-free TypeScript, so the
same file can be imported by a Worker Cron Trigger for scheduled evaluation —
alerts then reach you by email even when the browser is closed.


## Family-hub integrations on Cloudflare (WhatsApp · dedicated email)

The family operations layer (tasks, shopping lists, visit sheets, calendar,
LPA availability, Mum's care logs) is browser-persisted by design; two
integrations need a server side, and both map cleanly onto Workers:

### WhatsApp groups (Whapi.Cloud webhook)

1. Point the group webhook at your deployment:
   `https://<your-domain>/api/whapi/webhook` (Whapi dashboard → webhook,
   events: `messages`). The Next.js route `src/app/api/whapi/webhook/route.ts`
   is the reference implementation: it accepts Whapi's batch or single
   message shapes, extracts text, dedupes by message id and stores rows.
2. On Workers, replace the route with a Worker handler + D1 table:

   ```sql
   CREATE TABLE inbound_messages (
     id TEXT PRIMARY KEY, source TEXT, group_id TEXT, sender TEXT,
     body TEXT, msg_id TEXT UNIQUE, ts INTEGER, processed INTEGER DEFAULT 0
   );
   ```

   `POST` inserts (upsert on `msg_id`, return 200 fast so Whapi never
   retry-storms); `GET ?limit=100` feeds the portal's poll.
3. Restrict who can write: Whapi posts from their IP ranges — put the route
   behind a shared secret query param (`?k=…`) or a Cloudflare WAF rule, and
   keep `ENGINE_SHARED_KEY` on the AI worker as today.
4. Bound groups are chosen in the portal's WhatsApp tab; the token stays in
   the family's browser and is proxied per request (`/api/whapi/groups`,
   `/api/whapi/send`).

### Dedicated care email (Email Routing → Worker)

1. In Cloudflare, enable **Email Routing** on your domain for the dedicated
   address (e.g. `care@family.example`).
2. Create an **Email Worker** that parses the message and forwards it:

   ```js
   export default {
     async email(message, env) {
       const body = await new Response(message.raw).text(); // or use postal-mime
       await fetch("https://<your-site>/api/inbox", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           from: message.from,
           subject: message.headers.get("subject") || "",
           body,
           ts: new Date().toISOString(),
         }),
       });
       await message.forward(env.FORWARD_TO); // keep copies in the family inbox
     },
   };
   ```

3. `src/app/api/inbox/route.ts` is the reference receiver (dedupe by content
   hash, list for the portal's "Care inbox" card). On Workers, swap the Prisma
   table for the same D1 table as the webhook.
4. Cron Trigger idea: poll both inbound tables daily, run the same rule
   engine, and email a digest — that is how group/emails can raise alerts
   even when nobody has the portal open.
