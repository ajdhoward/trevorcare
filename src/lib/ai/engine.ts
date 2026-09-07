// Robust multi-provider inference engine — client side.
//
// The interface never ships a provider key with the app. You bring your own
// inference provider (OpenAI, Anthropic, Google, Cloudflare, or any
// OpenAI-compatible endpoint: Groq / OpenRouter / Ollama / vLLM / LM Studio…),
// the key is stored only in this browser (localStorage), and requests are sent
// either to this app's local proxy (/api/ai) or to YOUR OWN Cloudflare Worker
// ("engine mode: worker") so the app can run fully on the Cloudflare platform.

import type { CareRecord, RecommendationItem, AuditData } from "@/lib/record";
import { gatewayBase, throughGateway } from "@/lib/ai/gateway";

export type ProviderId =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "cloudflare"
  | "workers-ai";

export interface AISettings {
  mode: "proxy" | "worker";
  workerUrl: string;
  workerKey: string;
  provider: ProviderId;
  model: string;
  baseUrl: string; // openai-compatible only
  cfAccountId: string; // cloudflare API mode
  apiKey: string;
  temperature: number;
  maxTokens: number;
  // Cloudflare AI Gateway (optional): when account + id are set, requests are
  // routed through https://gateway.ai.cloudflare.com/v1/{account}/{id}/… —
  // caching, rate limits and logs for free; the provider key still travels
  // only in this browser → engine → gateway → upstream.
  gatewayAccountId: string;
  gatewayId: string;
  gatewaySlug: string; // openai-compatible only (e.g. "groq", "openrouter")
}

export const PROVIDER_META: Record<
  ProviderId,
  { label: string; placeholderModel: string; keyHint: string; needsBase?: boolean; needsAccount?: boolean; workerOnly?: boolean }
> = {
  openai: {
    label: "OpenAI",
    placeholderModel: "gpt-4o-mini",
    keyHint: "sk-… from platform.openai.com",
  },
  "openai-compatible": {
    label: "OpenAI-compatible (Groq, OpenRouter, Ollama…)",
    placeholderModel: "llama-3.3-70b-versatile",
    keyHint: "Provider API key (leave empty for local Ollama)",
    needsBase: true,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    placeholderModel: "claude-3-5-haiku-latest",
    keyHint: "sk-ant-… from console.anthropic.com",
  },
  google: {
    label: "Google (Gemini)",
    placeholderModel: "gemini-2.0-flash",
    keyHint: "AI Studio API key (AIza…)",
  },
  cloudflare: {
    label: "Cloudflare Workers AI (API token)",
    placeholderModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    keyHint: "Cloudflare API token with Workers AI permission",
    needsAccount: true,
  },
  "workers-ai": {
    label: "Cloudflare Workers AI (Worker binding — no key)",
    placeholderModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    keyHint: "No key needed — uses the [ai] binding on your deployed Worker",
    workerOnly: true,
  },
};

export const DEFAULT_SETTINGS: AISettings = {
  mode: "proxy",
  workerUrl: "",
  workerKey: "",
  provider: "openai",
  model: "",
  baseUrl: "",
  cfAccountId: "",
  apiKey: "",
  temperature: 0.3,
  maxTokens: 1200,
  gatewayAccountId: "",
  gatewayId: "",
  gatewaySlug: "",
};

const LS_KEY = "care-ai-settings-v1";

export function loadSettings(): AISettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (!PROVIDER_META[merged.provider]) merged.provider = "openai";
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AISettings) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function isConfigured(s: AISettings): boolean {
  if (s.mode === "worker") return Boolean(s.workerUrl);
  if (PROVIDER_META[s.provider].workerOnly) return false;
  if (s.provider === "openai-compatible") return Boolean(s.baseUrl);
  if (s.provider === "cloudflare")
    return Boolean(s.apiKey && (s.cfAccountId || (s.gatewayId.trim() && s.gatewayAccountId.trim())));
  return Boolean(s.apiKey);
}

/** The gateway URL (or binding expression) the engine will call — "" when off. */
export function gatewayEndpoint(s: AISettings): string {
  if (!gatewayBase(s)) return "";
  if (s.provider === "workers-ai") {
    // Worker mode routes through the AI binding natively.
    return `AI binding → env.AI.run("${s.model || "@cf/…"}", { gateway: { id: "${s.gatewayId.trim()}" } })`;
  }
  return throughGateway(s.provider, s.baseUrl, s.model, s);
}

export function engineEndpoint(s: AISettings): string {
  if (s.mode === "worker" && s.workerUrl.trim()) {
    return `${s.workerUrl.trim().replace(/\/+$/, "")}/api/ai`;
  }
  return "/api/ai";
}

export class AIError extends Error {
  status?: number;
  hint?: string;
  constructor(message: string, status?: number, hint?: string) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.hint = hint;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOpts {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

async function once(
  s: AISettings,
  messages: ChatMessage[],
  opts: ChatOpts
): Promise<string> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  const onOuterAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (s.mode === "worker" && s.workerKey.trim()) headers["X-Engine-Key"] = s.workerKey.trim();
    const res = await fetch(engineEndpoint(s), {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        provider: s.provider,
        model: s.model,
        baseUrl: s.baseUrl,
        cfAccountId: s.cfAccountId,
        apiKey: s.apiKey,
        temperature: s.temperature,
        maxTokens: s.maxTokens,
        gatewayAccountId: s.gatewayAccountId,
        gatewayId: s.gatewayId,
        gatewaySlug: s.gatewaySlug,
        messages,
      }),
    });
    let data: { text?: string; error?: string; hint?: string } = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON upstream error */
    }
    if (!res.ok || !data.text) {
      throw new AIError(
        data.error || `Engine returned HTTP ${res.status}`,
        res.status,
        data.hint
      );
    }
    return data.text;
  } catch (e) {
    if (e instanceof AIError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new AIError("The request timed out or was cancelled.", 408, "Try again, or use a faster model.");
    }
    throw new AIError(
      `Could not reach the inference engine: ${(e as Error).message}`,
      undefined,
      "Check the URL / network, or switch engine mode to “This app’s proxy”."
    );
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Chat with retry (429 / 5xx / transient network) + friendly errors. */
export async function chat(
  s: AISettings,
  messages: ChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  if (!isConfigured(s)) {
    throw new AIError(
      "The AI engine is not configured yet.",
      undefined,
      "Add a provider and key below — they are stored only in this browser."
    );
  }
  const retries = opts.retries ?? 1;
  let last: AIError = new AIError("Unknown engine error");
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(s, messages, opts);
    } catch (e) {
      last = e instanceof AIError ? e : new AIError(String(e));
      const retryable =
        last.status === 429 || (typeof last.status === "number" && last.status >= 500) || last.status === undefined;
      if (!retryable || attempt === retries) throw last;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw last;
}

export async function testConnection(
  s: AISettings
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const t0 = performance.now();
  try {
    const text = await chat(
      s,
      [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "ping" },
      ],
      { timeoutMs: 30_000, retries: 0 }
    );
    return { ok: true, message: text.trim().slice(0, 120) || "(empty reply)", latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    const err = e as AIError;
    return {
      ok: false,
      message: `${err.message}${err.hint ? ` — ${err.hint}` : ""}`,
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

// ------------------------------------------------------------------ prompts
export const SYSTEM_BASE =
  "You are the AI assistant built into a family care-oversight interface for Dad " +
  "(born 01/01/1947, lives alone at 1 Sample Road, Market Town AB1 2CD), whose domiciliary " +
  "care is provided by the care agency (Council). You help the family review the record, draft " +
  "letters and emails, and prepare care-plan updates. Ground every statement about the record in the " +
  "context you are given; if something is not in the context, say so instead of guessing. Use UK " +
  "English, plain text output, and reference dates as d/m/yyyy where the context provides them.";

/** Compact digest of the record for prompt context (keeps tokens small). */
export function recordDigest(
  record: CareRecord | null,
  audit: AuditData | null,
  recs: RecommendationItem[] | null
): string {
  const parts: string[] = [];
  if (record) {
    const meds = record.meds.map((m) => `${m.name} ${m.dose.trim()}${m.prn ? " (PRN)" : ""}`);
    parts.push(
      `[CLIENT]\n${record.client.name}, DOB ${record.client.dob}, ${record.client.address}. ` +
        `Allergies: ${record.client.allergies}. GP: ${record.client.gp}. Pharmacy: ${record.client.pharmacy}.\n` +
        `Record coverage: ${record.hist.length ? `${record.hist[record.hist.length - 1].date} to ${record.hist[0].date}` : "n/a"} — ${record.hist.length} visits, ${record.flags.length} flagged notes.\n` +
        `Current medication: ${meds.join("; ")}.\n` +
        `Recorded contacts (verbatim from portal): ${record.client.contacts
          .map((c) => `${c.contactType}: ${c.name.trim()} (${c.relationship.trim() || "relationship blank"}) ${c.telNo1.trim()}`)
          .join(" · ")}`
    );
  }
  if (recs) {
    parts.push(
      `[RECOMMENDATIONS]\n${recs.map((r) => `${r.id} [${r.priority}] ${r.title} — ${r.rationale}`).join("\n")}`
    );
  }
  if (audit) {
    parts.push(
      `[DATA-QUALITY / AUDIT]\n${audit.incorrect_info
        .map((d) => `${d.id} (${d.severity}): ${d.item}. Recorded: ${d.recorded}. Reality: ${d.reality}`)
        .join("\n")}\n` +
        `[ALZHEIMER'S REVIEW]\n${audit.alzheimer.short_answer}`
    );
  }
  return parts.join("\n\n");
}

export function emailMessages(args: {
  digest: string;
  recipientLabel: string;
  recipientContext: string;
  subject: string;
  points: string[];
  tone: string;
  senderName: string;
}): ChatMessage[] {
  const system =
    `${SYSTEM_BASE}\n\nCONTEXT:\n${args.digest}\n\nTASK: Draft an email the family will send. ` +
    `Recipient: ${args.recipientLabel}. ${args.recipientContext} ` +
    `Subject line: "${args.subject}". Tone: ${args.tone}. ` +
    `Structure: greeting; 1 short opening paragraph; numbered points (each point: what, the evidence with dates, the action requested); ` +
    `closing paragraph asking for a written response and a named contact; sign off as "${args.senderName}". ` +
    `Keep it under 500 words. Never invent facts, dates or medication names.`;
  return [
    { role: "system", content: system },
    { role: "user", content: `Points to cover:\n${args.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}` },
  ];
}

export function carePlanMessages(args: { digest: string; section: string; sectionBrief: string; changes: string }): ChatMessage[] {
  const system =
    `${SYSTEM_BASE}\n\nCONTEXT:\n${args.digest}\n\nTASK: Write an amended support-plan section for the ` +
    `agency to adopt into Dad's care plan. Section: ${args.section}. ${args.sectionBrief} ` +
    `Base it on the evidence and requested changes below. Output: "Update — September 2026" heading, ` +
    `then the amended plan text in short numbered commitments the carers can follow (who/what/when), ` +
    `then "Why this changed" with the evidence, then "Review point". Plain text, under 450 words.`;
  return [{ role: "system", content: system }, { role: "user", content: `Evidence & changes to incorporate:\n${args.changes}` }];
}

export function qaMessages(args: { digest: string; question: string }): ChatMessage[] {
  const system =
    `${SYSTEM_BASE}\n\nCONTEXT:\n${args.digest}\n\nTASK: Answer the family's question about the record. ` +
    `Quote dates and specifics from the context where possible; flag anything uncertain. Under 300 words.`;
  return [{ role: "system", content: system }, { role: "user", content: args.question }];
}

export function rectificationMessages(args: { digest: string; items: string[]; senderName: string }): ChatMessage[] {
  const system =
    `${SYSTEM_BASE}\n\nCONTEXT:\n${args.digest}\n\nTASK: Draft a UK GDPR Article 16 rectification request ` +
    `email to the care provider's records team. Identify the data subject (Dad, DOB 01/01/1947, ` +
    `client id 000), list the incorrect items below with what the record should say, cite Article 16 and ` +
    `the one-month response deadline, and ask for written confirmation of the change and the change history. ` +
    `Sign off as ${args.senderName}. Plain text, under 350 words.`;
  return [{ role: "system", content: system }, { role: "user", content: `Incorrect items to correct:\n${args.items.map((i, n) => `${n + 1}. ${i}`).join("\n")}` }];
}
