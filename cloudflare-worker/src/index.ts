// Care Record AI Engine — Cloudflare Worker
// -----------------------------------------
// The same multi-provider inference engine as the app's /api/ai route,
// packaged for the Cloudflare developer platform. Deploy it, then in the
// interface set Engine mode = "Cloudflare Worker" and paste your worker URL.
//
// Endpoints:
//   POST /api/ai   { provider, model, baseUrl?, cfAccountId?, apiKey?,
//                    temperature?, maxTokens?, messages[] }
//                  header  X-Engine-Key: <shared key>   (if ENGINE_SHARED_KEY is set)
//   GET  /health   -> { ok, bindings: { workersAI } }
//
// Providers:
//   openai | openai-compatible | anthropic | google | cloudflare (API token)
//   workers-ai  → uses the Worker's [ai] binding: no API key needed at all.

export interface Env {
  ENGINE_SHARED_KEY?: string;
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
}

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
  messages?: ChatMessage[];
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Engine-Key",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

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

const HINTS: Record<string, string> = {
  "401": "The provider rejected the API key. Check the key and its permissions.",
  "403": "The key is valid but not allowed for this model/project. Check quotas and model access.",
  "404": "Model or endpoint not found. Check the model id (and base URL for custom providers).",
  "429": "Rate limit or quota exceeded. Wait a moment or lower the request rate.",
};

async function runProvider(req: EngineRequest, env: Env): Promise<Response> {
  const provider = req.provider || "openai";
  const messages = Array.isArray(req.messages) ? req.messages : [];
  if (messages.length === 0) return err("No messages supplied.");
  const model = (req.model || "").trim();
  if (!model) return err("No model specified.", 400, "Pick a model in the AI assistant settings.");
  const apiKey = (req.apiKey || "").trim();
  const temperature = typeof req.temperature === "number" ? req.temperature : 0.3;
  const maxTokens = typeof req.maxTokens === "number" ? Math.min(Math.max(req.maxTokens, 64), 4096) : 1200;

  // --- Workers AI via binding: the "built on Cloudflare" zero-key path ---
  if (provider === "workers-ai") {
    if (!env.AI) return err("This worker has no [ai] binding.", 400, "Redeploy with the bundled wrangler.jsonc, which declares it.");
    try {
      const out = (await env.AI.run(model, { messages, max_tokens: maxTokens, temperature })) as
        | { response?: string }
        | string;
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
        : (req.baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) return err("Base URL is required for OpenAI-compatible providers.");
    const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
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
    const convo = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
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
    if (!apiKey) return err("Cloudflare API token required (or use the workers-ai provider with the [ai] binding).");
    const account = (req.cfAccountId || "").trim();
    if (!account) return err("Cloudflare account id required.");
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${encodeURIComponent(model)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
    });
    const txt = await res.text();
    if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
    const j = JSON.parse(txt) as { success?: boolean; result?: { response?: string }; errors?: { message?: string }[] };
    if (j.success === false) return err(j.errors?.[0]?.message || "Cloudflare Workers AI call failed.", 502);
    const text = j.result?.response || "";
    if (!text) return err("Provider returned an empty completion.", 502);
    return json({ text });
  }

  return err(`Unknown provider: ${provider}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/health") {
      return json({ ok: true, bindings: { workersAI: Boolean(env.AI) } });
    }

    if (url.pathname === "/api/ai" && request.method === "POST") {
      if (env.ENGINE_SHARED_KEY && request.headers.get("X-Engine-Key") !== env.ENGINE_SHARED_KEY) {
        return err("Missing or wrong X-Engine-Key.", 401, "Set the same shared key in the interface's AI assistant settings.");
      }
      let body: EngineRequest;
      try {
        body = (await request.json()) as EngineRequest;
      } catch {
        return err("Invalid JSON body.");
      }
      try {
        return await runProvider(body, env);
      } catch (e) {
        return err(`Inference request failed: ${(e as Error).message}`, 502);
      }
    }

    return err("Not found. POST /api/ai or GET /health.", 404);
  },
};
