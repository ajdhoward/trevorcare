// /api/ai — stateless inference proxy.
//
// Holds NO keys and NO settings. The client sends its chosen provider,
// model and key with each request; this route normalises the provider APIs
// (OpenAI / OpenAI-compatible / Anthropic / Google / Cloudflare Workers AI)
// into one response shape: { text } or { error, hint }.
//
// The identical adapter set ships in cloudflare-worker/src/index.ts so the
// same engine can be deployed to the Cloudflare developer platform and used
// with engine mode "worker" — this route then becomes optional.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

const HINTS: Record<string, string> = {
  "401": "The provider rejected the API key. Check the key and its permissions.",
  "403": "The key is valid but not allowed for this model/project. Check quotas and model access.",
  "404": "Model or endpoint not found. Check the model id (and base URL for custom providers).",
  "429": "Rate limit or quota exceeded. Wait a moment or lower the request rate.",
};

function err(message: string, status = 400, hint?: string) {
  return NextResponse.json({ error: message, hint }, { status });
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

export async function POST(req: Request) {
  let body: EngineRequest;
  try {
    body = (await req.json()) as EngineRequest;
  } catch {
    return err("Invalid JSON body.");
  }

  const provider = body.provider || "openai";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return err("No messages supplied.");
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.3;
  const maxTokens = typeof body.maxTokens === "number" ? Math.min(Math.max(body.maxTokens, 64), 4096) : 1200;
  const model = (body.model || "").trim();
  const apiKey = (body.apiKey || "").trim();

  if (!model) return err("No model specified.", 400, "Pick a model in the AI assistant settings.");

  const fetchTimeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  };

  try {
    if (provider === "openai" || provider === "openai-compatible") {
      const base =
        provider === "openai"
          ? "https://api.openai.com/v1"
          : (body.baseUrl || "").trim().replace(/\/+$/, "");
      if (!base) return err("Base URL is required for OpenAI-compatible providers.", 400, "e.g. https://api.groq.com/openai/v1");
      const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: fetchTimeout(90_000),
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) return err("Provider returned an empty completion.", 502);
      return NextResponse.json({ text });
    }

    if (provider === "anthropic") {
      if (!apiKey) return err("Anthropic requires an API key.");
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const convo = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: fetchTimeout(90_000),
        body: JSON.stringify({ model, system, messages: convo, temperature, max_tokens: maxTokens }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { content?: { type: string; text?: string }[] };
      const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
      if (!text) return err("Provider returned an empty completion.", 502);
      return NextResponse.json({ text });
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
        signal: fetchTimeout(90_000),
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
      return NextResponse.json({ text });
    }

    if (provider === "cloudflare") {
      if (!apiKey) return err("Cloudflare API token required (or use the Worker binding provider).");
      const account = (body.cfAccountId || "").trim();
      if (!account) return err("Cloudflare account id required.", 400, "Find it in the Cloudflare dashboard right sidebar.");
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${encodeURIComponent(model)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: fetchTimeout(90_000),
        body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
      });
      const txt = await res.text();
      if (!res.ok) return err(upstreamMessage(res.status, txt), res.status, HINTS[String(res.status)]);
      const j = JSON.parse(txt) as { success?: boolean; result?: { response?: string }; errors?: { message?: string }[] };
      if (j.success === false) {
        return err(j.errors?.[0]?.message || "Cloudflare Workers AI call failed.", 502);
      }
      const text = j.result?.response || "";
      if (!text) return err("Provider returned an empty completion.", 502);
      return NextResponse.json({ text });
    }

    if (provider === "workers-ai") {
      return err(
        "Workers AI via binding only runs on your deployed Cloudflare Worker.",
        400,
        "Switch engine mode to “Cloudflare Worker”, point it at your deployed worker URL, and pick the provider “Cloudflare Workers AI (Worker binding)”."
      );
    }

    return err(`Unknown provider: ${provider}`);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return err(`Inference request failed: ${msg}`, 502, "If this mentions fetch/abort, the upstream timed out — try again.");
  }
}
