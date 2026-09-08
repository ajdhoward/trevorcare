// /api/ai — stateless inference proxy + AI feedback inbox.
// Ported 1:1 from:
//   src/app/api/ai/route.ts          (POST inference proxy)
//   src/app/api/ai/ingest/route.ts   (GET/POST/PATCH feedback loop)
//
// Parity notes:
//  - The provider adapters (openai / openai-compatible / anthropic / google /
//    cloudflare REST) are verbatim ports of the Next.js route: same request
//    bodies, headers, { text } / { error, hint } envelopes, status codes,
//    HINTS strings and the upstreamMessage() mapper.
//  - AI Gateway passthrough uses src/lib/ai/gateway.ts imported directly — it
//    is pure TypeScript (no imports at all).
//  - The SSRF guard (assertPublicUrl) is inlined from src/lib/server/guard.ts;
//    that module imports next/server so it cannot be imported from a Worker.
//  - BEHAVIOURAL CHANGE (deliberate, flagged): provider "workers-ai" now runs
//    through the Workers AI binding (env.AI) instead of returning the original
//    "Workers AI via binding only runs on your deployed Cloudflare Worker."
//    error — bindings don't exist on Node, but they DO exist here. This
//    mirrors the Workers-native twin in cloudflare-worker/src/index.ts,
//    including its { gateway: { id } } option and its error strings. All
//    other providers keep the exact original JSON/behaviour.
//  - /api/ai/ingest imports extractFeedbackItems from src/lib/feedback.ts
//    (pure TypeScript, zero imports). The GET response has NO `ok` field —
//    matching the original envelope { feedback: [...] }; POST returns
//    { id, items }; PATCH returns { feedback: { ...row, parsed } }.
//  - ai_feedback.items JSON is parsed with a try/catch fallback to [] (the
//    original would throw → 500 on corrupt rows; the task spec mandates the
//    fallback).

import { route, type Handler } from "../router";
import { cuid, json, nowIso } from "../util";
import { throughGateway, gatewayBase, type GatewayConfig } from "../../lib/ai/gateway";
import { extractFeedbackItems } from "../../lib/feedback";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface EngineRequest {
  provider?: string;
  model?: string;
  baseUrl?: string;
  cfAccountId?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  gatewayAccountId?: string;
  gatewayId?: string;
  gatewaySlug?: string;
  messages?: ChatMessage[];
}

const HINTS: Record<string, string> = {
  "401": "The provider rejected the API key. Check the key and its permissions.",
  "403": "The key is valid but not allowed for this model/project. Check quotas and model access.",
  "404": "Model or endpoint not found. Check the model id (and base URL for custom providers).",
  "429": "Rate limit or quota exceeded. Wait a moment or lower the request rate.",
};

/** The original route's envelope — { error, hint } (no `ok` field). */
function err(message: string, status = 400, hint?: string): Response {
  return json({ error: message, hint }, status);
}

function upstreamMessage(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = j.error ?? j;
    if (typeof e === "object" && e !== null) {
      const em = e as Record<string, unknown>;
      if (typeof em.message === "string") return `${status}: ${em.message}`;
    }
    if (typeof e === "string") return `${status}: ${e}`;
  } catch {
    /* fall through */
  }
  return `Provider returned HTTP ${status}: ${body.slice(0, 200)}`;
}

// ---------------------------------------------------------------------------
// SSRF guard — inlined verbatim from src/lib/server/guard.ts (CODE_REVIEW C4).
// ---------------------------------------------------------------------------

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fe80:/i,
  /\.local$/i,
  /^metadata\./i, // cloud metadata endpoints
];

function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("Private or reserved hosts are blocked");
  }
  return u;
}

/** fetch() with the original's 90s abort timeout (timer cleared after use). */
async function timedFetch(url: string, init: RequestInit, ms = 90_000): Promise<Response> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// POST /api/ai
// ---------------------------------------------------------------------------

const inferenceProxy: Handler = async (ctx) => {
  let body: EngineRequest;
  try {
    body = (await ctx.req.json()) as EngineRequest;
  } catch {
    return err("Invalid JSON body.");
  }

  const provider = body.provider || "openai";
  // SSRF guard (CODE_REVIEW C4): the openai-compatible base URL is
  // user-supplied — validate it BEFORE anything else, so a private host is
  // rejected regardless of the rest of the payload.
  if (provider === "openai-compatible") {
    const candidate = (body.baseUrl || "").trim().replace(/\/+$/, "");
    if (candidate) {
      try {
        assertPublicUrl(candidate);
      } catch (e) {
        return err(`Base URL rejected: ${e instanceof Error ? e.message : "invalid"}`, 400);
      }
    }
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return err("No messages supplied.");
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.3;
  const maxTokens = typeof body.maxTokens === "number" ? Math.min(Math.max(body.maxTokens, 64), 4096) : 1200;
  const model = (body.model || "").trim();
  const apiKey = (body.apiKey || "").trim();

  if (!model) return err("No model specified.", 400, "Pick a model in the AI assistant settings.");

  // Cloudflare AI Gateway (optional, free): when the client supplies account +
  // gateway id, provider calls are routed through the gateway (BYOK passthrough).
  const gw: GatewayConfig = {
    gatewayAccountId: body.gatewayAccountId,
    gatewayId: body.gatewayId,
    gatewaySlug: body.gatewaySlug,
  };

  try {
    if (provider === "workers-ai") {
      // Workers-native addition (see header comment): the [ai] binding exists
      // here, so this provider runs natively instead of erroring.
      const AI = ctx.env.AI;
      if (!AI) return err("This worker has no [ai] binding.", 400, "Redeploy with the bundled wrangler.jsonc, which declares it.");
      const gwId = (body.gatewayId || "").trim() || (ctx.env.AI_GATEWAY_ID || "").trim();
      try {
        const runFn = AI.run.bind(AI) as (
          m: string,
          input: Record<string, unknown>,
          opts?: { gateway?: { id?: string } }
        ) => Promise<unknown>;
        const out = (await runFn(
          model,
          { messages, max_tokens: maxTokens, temperature },
          // Route through the family's AI Gateway when one is set (free:
          // caching, rate limits, logs).
          gwId ? { gateway: { id: gwId } } : undefined
        )) as { response?: string } | string;
        const text = typeof out === "string" ? out : out.response || "";
        if (!text) return err("Workers AI returned an empty completion.", 502);
        return json({ text });
      } catch (e) {
        return err(`Workers AI failed: ${(e as Error).message}`, 502);
      }
    }

    if (provider === "openai" || provider === "openai-compatible") {
      const base =
        provider === "openai"
          ? "https://api.openai.com/v1"
          : (body.baseUrl || "").trim().replace(/\/+$/, "");
      if (!base) return err("Base URL is required for OpenAI-compatible providers.", 400, "e.g. https://api.groq.com/openai/v1");
      // SSRF guard (CODE_REVIEW C4): the base URL is user-supplied — block
      // private/reserved hosts before it is ever fetched.
      try {
        assertPublicUrl(base);
      } catch (e) {
        return err(`Base URL rejected: ${e instanceof Error ? e.message : "invalid"}`, 400);
      }
      const direct = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
      const url = throughGateway(provider, base, model, gw) || direct;
      const res = await timedFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) return err("Provider returned an empty completion.", 502);
      return json({ text });
    }

    if (provider === "anthropic") {
      if (!apiKey) return err("Anthropic requires an API key.");
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const convo = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const direct = "https://api.anthropic.com/v1/messages";
      const url = throughGateway(provider, direct, model, gw) || direct;
      const res = await timedFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, system, messages: convo, temperature, max_tokens: maxTokens }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { content?: { type: string; text?: string }[] };
      const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
      if (!text) return err("Provider returned an empty completion.", 502);
      return json({ text });
    }

    if (provider === "google") {
      if (!apiKey) return err("Google Gemini requires an API key.");
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const direct = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const url = (throughGateway(provider, direct, model, gw) || direct) + `?key=${encodeURIComponent(apiKey)}`;
      const res = await timedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) return err("Provider returned an empty completion.", 502);
      return json({ text });
    }

    if (provider === "cloudflare") {
      if (!apiKey) return err("Cloudflare API token required (or use the Worker binding provider).");
      const account = (body.cfAccountId || "").trim();
      const viaGateway = Boolean(gatewayBase(gw));
      if (!account && !viaGateway)
        return err("Cloudflare account id required.", 400, "Find it in the Cloudflare dashboard right sidebar.");
      const direct = account
        ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${encodeURIComponent(model)}`
        : "";
      const url = throughGateway(provider, direct || "https://api.cloudflare.com", model, gw) || direct;
      const res = await timedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { success?: boolean; result?: { response?: string }; response?: string; errors?: { message?: string }[] };
      if (j.success === false) {
        return err(j.errors?.[0]?.message || "Cloudflare Workers AI call failed.", 502);
      }
      // Direct REST returns { result: { response } }; via AI Gateway the
      // passthrough may return the model output directly ({ response }).
      const text = j.result?.response || j.response || "";
      if (!text) return err("Provider returned an empty completion.", 502);
      return json({ text });
    }

    return err(`Unknown provider: ${provider}`);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return err(`Inference request failed: ${msg}`, 502, "If this mentions fetch/abort, the upstream timed out — try again.");
  }
};

// ---------------------------------------------------------------------------
// /api/ai/ingest — AI feedback loop (export → AI → ingest)
// ---------------------------------------------------------------------------

interface AiFeedbackRow {
  id: string;
  source: string;
  file_name: string;
  title: string;
  raw: string;
  items: string;
  status: string;
  created_at: string;
}

function toFeedback(row: AiFeedbackRow): Record<string, unknown> {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.items || "[]");
  } catch {
    parsed = [];
  }
  return {
    id: row.id,
    source: row.source,
    fileName: row.file_name,
    title: row.title,
    raw: row.raw,
    items: row.items,
    status: row.status,
    createdAt: row.created_at,
    parsed,
  };
}

const listFeedback: Handler = async (ctx) => {
  const result = await ctx.env.DB.prepare("SELECT * FROM ai_feedback ORDER BY created_at DESC LIMIT 50").all<AiFeedbackRow>();
  // Original envelope has NO `ok` field: { feedback: [...] }.
  return json({ feedback: (result.results ?? []).map(toFeedback) });
};

const createFeedback: Handler = async (ctx) => {
  let body: { title?: string; fileName?: string; text?: string; source?: string };
  try {
    body = (await ctx.req.json()) as { title?: string; fileName?: string; text?: string; source?: string };
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "No feedback text received — paste the AI's reply or upload its file." }, 400);
  const items = extractFeedbackItems(text);
  const id = cuid();
  await ctx.env.DB.prepare(
    `INSERT INTO ai_feedback (id, source, file_name, title, raw, items, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'received', ?)`
  )
    .bind(
      id,
      body.source === "file" ? "file" : "paste",
      (body.fileName ?? "").slice(0, 200),
      (body.title ?? "").slice(0, 200) || `AI review — ${new Date().toLocaleDateString("en-GB")}`,
      text.slice(0, 200_000),
      JSON.stringify(items),
      nowIso()
    )
    .run();
  return json({ id, items });
};

const patchFeedback: Handler = async (ctx) => {
  let body: { id?: string; status?: string };
  try {
    body = (await ctx.req.json()) as { id?: string; status?: string };
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!body.id) return json({ error: "id is required." }, 400);
  const status = ["received", "applied", "dismissed"].includes(body.status ?? "") ? (body.status as string) : "received";
  const row = await ctx.env.DB.prepare("SELECT * FROM ai_feedback WHERE id = ?").bind(body.id).first<AiFeedbackRow>();
  if (!row) {
    // Parity: the original's unguarded Prisma update throws on a missing id
    // (Next turns that into a bare HTTP 500). Emulated with the app's 500
    // envelope so clients still see a JSON error.
    return json({ ok: false, error: "Server error — see logs." }, 500);
  }
  await ctx.env.DB.prepare("UPDATE ai_feedback SET status = ? WHERE id = ?").bind(status, body.id).run();
  return json({ feedback: toFeedback({ ...row, status }) });
};

export function registerAiRoutes(routeFn: typeof route): void {
  routeFn("POST", "/api/ai", inferenceProxy);
  routeFn("GET", "/api/ai/ingest", listFeedback);
  routeFn("POST", "/api/ai/ingest", createFeedback);
  routeFn("PATCH", "/api/ai/ingest", patchFeedback);
}
