// Cloudflare AI Gateway — shared URL rewriting for the inference engine.
//
// AI Gateway sits between the app and the AI provider: caching, rate limiting,
// spend controls, retries and logs, with a free core on every plan
// (https://developers.cloudflare.com/ai-gateway/reference/pricing/).
//
// Provider-native (BYOK) passthrough — the provider API key travels in the
// same header it always does and the gateway forwards it upstream. URL shapes
// per https://developers.cloudflare.com/ai-gateway/providers/… :
//   openai     {GW}/{account}/{gateway}/openai/chat/completions
//   groq       {GW}/{account}/{gateway}/groq/chat/completions
//   anthropic  {GW}/{account}/{gateway}/anthropic/v1/messages
//   google     {GW}/{account}/{gateway}/google-ai-studio/v1beta/models/{model}:generateContent
//   workers-ai {GW}/{account}/{gateway}/workers-ai/{model}        (API-token path)
// In worker mode the Workers-AI binding routes natively instead:
//   env.AI.run(model, input, { gateway: { id } })

export interface GatewayConfig {
  gatewayAccountId?: string | null;
  gatewayId?: string | null;
  gatewaySlug?: string | null; // openai-compatible only (e.g. "groq", "openrouter")
}

/** OpenAI-compatible host → AI Gateway provider slug. */
const HOST_SLUGS: Array<[RegExp, string]> = [
  [/api\.groq\.com/i, "groq"],
  [/openrouter\.ai/i, "openrouter"],
  [/api\.deepseek\.com/i, "deepseek"],
  [/api\.mistral\.ai/i, "mistral"],
  [/api\.perplexity\.ai/i, "perplexity"],
  [/api\.cohere\.(ai|com)/i, "cohere"],
  [/api\.x\.ai/i, "grok"],
  [/api\.together\.(xyz|ai)/i, "together-ai"],
];

export function deriveGatewaySlug(baseUrl: string): string {
  for (const [re, slug] of HOST_SLUGS) if (re.test(baseUrl)) return slug;
  return "";
}

/** "https://gateway.ai.cloudflare.com/v1/{account}/{gateway}" — "" when off. */
export function gatewayBase(cfg: GatewayConfig): string {
  const acct = (cfg.gatewayAccountId || "").trim();
  const id = (cfg.gatewayId || "").trim();
  if (!acct || !id) return "";
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(acct)}/${encodeURIComponent(id)}`;
}

/**
 * Rewrite an upstream provider URL through the gateway. Returns "" when the
 * gateway is off or the provider cannot be expressed as a passthrough —
 * callers fall back to the direct URL in that case.
 */
export function throughGateway(
  provider: string,
  upstreamUrl: string,
  model: string,
  cfg: GatewayConfig
): string {
  const base = gatewayBase(cfg);
  if (!base) return "";
  const slug = (cfg.gatewaySlug || "").trim() || deriveGatewaySlug(upstreamUrl);
  switch (provider) {
    case "openai":
      return `${base}/openai/chat/completions`;
    case "openai-compatible":
      return slug ? `${base}/${slug}/chat/completions` : "";
    case "anthropic":
      return `${base}/anthropic/v1/messages`;
    case "google":
      return `${base}/google-ai-studio/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    case "cloudflare":
      // model ids are paths here (e.g. @cf/meta/llama-3.3-70b-instruct-fp8-fast)
      return `${base}/workers-ai/${model.trim()}`;
    default:
      return "";
  }
}
