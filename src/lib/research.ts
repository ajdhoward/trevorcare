// AI research engine with anti-drift / anti-hallucination validation.
//
// Pipeline: question → tool calls (built-in web search + page reader, plus any
// registered MCP servers) → model proposes claims, each bound to ONE source URL
// with a VERBATIM quote → validator re-checks every quote against the actual
// fetched text → claims land in a review queue (supported / unsupported).
// Nothing enters the record until a human accepts it, and every run keeps its
// full tool-call trace for audit.

import ZAI from "z-ai-web-dev-sdk";
import { safeFetch } from "@/lib/server/guard";
import { db } from "@/lib/db";
import { McpServer } from "@prisma/client";

export interface ToolLogEntry {
  tool: string;
  args: Record<string, unknown>;
  at: string;
  ok: boolean;
  detail: string; // summary of what came back (truncated)
}

export interface CandidateClaim {
  text: string;
  sourceUrl: string;
  quote: string;
  verified: boolean;
  score: number;
  verdict: "supported" | "unsupported" | "disputed";
  sourceTitle: string;
}

// ---------------------------------------------------------------------------
// Built-in tools (always available — these make research work out of the box)
// ---------------------------------------------------------------------------

interface SearchResult {
  url: string;
  name: string;
  snippet: string;
}

async function toolWebSearch(query: string, num = 6): Promise<SearchResult[]> {
  const zai = await ZAI.create();
  const raw = (await zai.functions.invoke("web_search", { query, num: num })) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as { url?: string; name?: string; snippet?: string })
    .filter((r) => typeof r.url === "string" && r.url)
    .map((r) => ({ url: r.url as string, name: (r.name as string) || "", snippet: (r.snippet as string) || "" }));
}

async function toolPageReader(url: string): Promise<{ title: string; text: string }> {
  const zai = await ZAI.create();
  const res = (await zai.functions.invoke("page_reader", { url })) as {
    title?: string;
    text?: string;
    content?: string;
    html?: string;
  };
  const text = res.text || res.content || (res.html ? res.html.replace(/<[^>]+>/g, " ") : "");
  return { title: res.title || url, text: String(text).slice(0, 40_000) };
}

// ---------------------------------------------------------------------------
// MCP client — streamable-HTTP JSON-RPC (initialize → tools/list, tools/call).
// Best-effort: servers that need SSE-only transports surface a clear error in
// the run log instead of failing the whole run.
// ---------------------------------------------------------------------------

async function mcpJsonRpc(server: McpServer, method: string, params: object, id = 1): Promise<Record<string, unknown>> {
  let headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  try {
    headers = { ...headers, ...(JSON.parse(server.headers || "{}") as Record<string, string>) };
  } catch {
    /* headers optional */
  }
  const res = await safeFetch(server.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    timeoutMs: 12_000,
    maxBytes: 1_000_000,
  });
  const text = await res.text();
  // streamable-HTTP servers may answer as SSE; unwrap data: lines
  if (text.startsWith("event:") || text.includes("\ndata:")) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        try {
          return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function mcpListTools(server: McpServer, log: ToolLogEntry[]): Promise<Array<{ name: string; description: string }>> {
  try {
    await mcpJsonRpc(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "care-hub-research", version: "1.0" } }, 0);
    const res = await mcpJsonRpc(server, "tools/list", {});
    const tools = (res.result as { tools?: Array<{ name: string; description?: string }> })?.tools ?? [];
    log.push({ tool: `mcp:${server.name}:tools/list`, args: {}, at: new Date().toISOString(), ok: true, detail: `${tools.length} tool(s)` });
    return tools.map((t) => ({ name: t.name, description: t.description || "" }));
  } catch (e) {
    log.push({ tool: `mcp:${server.name}:tools/list`, args: {}, at: new Date().toISOString(), ok: false, detail: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

async function mcpCallTool(server: McpServer, toolName: string, args: Record<string, unknown>, log: ToolLogEntry[]): Promise<string> {
  try {
    const res = await mcpJsonRpc(server, "tools/call", { name: toolName, arguments: args }, 2);
    const content = (res.result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
    const text = content.map((c) => c.text ?? "").join("\n").slice(0, 8000);
    log.push({ tool: `mcp:${server.name}:${toolName}`, args, at: new Date().toISOString(), ok: true, detail: text.slice(0, 200) || "(no text)" });
    return text;
  } catch (e) {
    log.push({ tool: `mcp:${server.name}:${toolName}`, args, at: new Date().toISOString(), ok: false, detail: e instanceof Error ? e.message : String(e) });
    return "";
  }
}

// ---------------------------------------------------------------------------
// Quote validation — normalised fuzzy substring over the fetched source text.
// ---------------------------------------------------------------------------

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalise(s).split(" ").filter((w) => w.length > 2));
}

/** Returns 0..1 — 1 when the quote appears verbatim (normalised) in source. */
export function quoteScore(quote: string, source: string): number {
  if (!quote.trim() || !source.trim()) return 0;
  const nq = normalise(quote);
  const ns = normalise(source);
  if (ns.includes(nq)) return 1;
  // sliding window over source tokens with Jaccard-ish overlap
  const qTokens = normalise(quote).split(" ").filter((w) => w.length > 2);
  if (qTokens.length === 0) return 0;
  const win = Math.max(4, Math.ceil(qTokens.length * 1.4));
  const srcTokens = ns.split(" ");
  let best = 0;
  const qSet = new Set(qTokens);
  for (let i = 0; i + win <= srcTokens.length; i += 2) {
    const slice = srcTokens.slice(i, i + win);
    const sSet = new Set(slice);
    let hit = 0;
    for (const t of qSet) if (sSet.has(t)) hit++;
    const score = hit / qSet.size;
    if (score > best) best = score;
    if (best === 1) break;
  }
  // secondary: bag overlap (order-free) for re-ordered sentences
  const bag = tokenSet(source);
  let bagHit = 0;
  for (const t of qSet) if (bag.has(t)) bagHit++;
  const bagScore = bagHit / Math.max(1, qSet.size);
  return Math.max(best, bagScore * 0.9);
}

// ---------------------------------------------------------------------------
// The run itself
// ---------------------------------------------------------------------------

interface ModelClaim {
  claim: string;
  source_url: string;
  quote: string;
}

export async function runResearch(question: string, subjectId: string): Promise<{ runId: string }> {
  const run = await db.researchRun.create({
    data: { question: question.slice(0, 500), subjectId, status: "running", log: "[]" },
  });
  const log: ToolLogEntry[] = [];

  try {
    // -- 1. built-in web search (two angles) ------------------------------
    let results: SearchResult[] = [];
    try {
      results = await toolWebSearch(question, 6);
      log.push({ tool: "web_search", args: { query: question }, at: new Date().toISOString(), ok: true, detail: `${results.length} result(s)` });
    } catch (e) {
      log.push({ tool: "web_search", args: { query: question }, at: new Date().toISOString(), ok: false, detail: e instanceof Error ? e.message : String(e) });
    }

    // -- 2. registered MCP servers ----------------------------------------
    const servers = await db.mcpServer.findMany({ where: { enabled: true } });
    for (const s of servers) {
      const tools = await mcpListTools(s, log);
      const searchTool = tools.find((t) => /search|query|fetch|web/i.test(t.name));
      if (searchTool) {
        const out = await mcpCallTool(s, searchTool.name, { query: question }, log);
        if (out) {
          // fold MCP output into the evidence pool as pseudo-results
          results.push({ url: `mcp://${s.name}/${searchTool.name}`, name: `MCP ${s.name} → ${searchTool.name}`, snippet: out.slice(0, 4000) });
        }
      }
    }

    // -- 3. read the top pages --------------------------------------------
    const sources: Array<{ url: string; title: string; text: string }> = [];
    for (const r of results.slice(0, 3)) {
      if (r.url.startsWith("mcp://")) {
        sources.push({ url: r.url, title: r.name, text: r.snippet });
        continue;
      }
      try {
        const page = await toolPageReader(r.url);
        sources.push({ url: r.url, title: page.title, text: page.text });
        log.push({ tool: "page_reader", args: { url: r.url }, at: new Date().toISOString(), ok: true, detail: `${page.text.length} chars: ${page.title}` });
      } catch (e) {
        log.push({ tool: "page_reader", args: { url: r.url }, at: new Date().toISOString(), ok: false, detail: e instanceof Error ? e.message : String(e) });
        sources.push({ url: r.url, title: r.name, text: r.snippet }); // fall back to the snippet
      }
    }
    for (const r of results.slice(3)) {
      sources.push({ url: r.url, title: r.name, text: r.snippet });
    }

    // -- 4. model proposes claims bound to sources -------------------------
    const evidenceBlock = sources
      .map((s, i) => `[S${i}] url: ${s.url}\ntitle: ${s.title}\ntext: ${s.text.slice(0, 6000)}`)
      .join("\n\n");
    const system = [
      "You are a research assistant inside a UK family social-care portal.",
      "Answer the user's question using ONLY the numbered sources provided.",
      "Return STRICT JSON: {\"claims\":[{\"claim\":\"...\",\"source_url\":\"...\",\"quote\":\"...\"}]}",
      "Rules:",
      "- Every claim MUST cite one source_url copied exactly from the [S#] url lines.",
      "- quote MUST be a VERBATIM substring of that source's text (10-40 words), copied character-for-character.",
      "- If the sources do not support an answer, return fewer claims — never invent a source or a quote.",
      "- 1 to 6 claims. Keep each claim one self-contained sentence.",
    ].join("\n");
    let modelClaims: ModelClaim[] = [];
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: `Question: ${question}\n\nSources:\n${evidenceBlock || "(no sources retrieved)"}` },
        ],
        thinking: { type: "disabled" },
      });
      const raw = completion.choices[0]?.message?.content || "";
      log.push({ tool: "llm.synthesis", args: { question }, at: new Date().toISOString(), ok: true, detail: raw.slice(0, 300) });
      const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonText) as { claims?: ModelClaim[] };
      modelClaims = Array.isArray(parsed.claims) ? parsed.claims.slice(0, 8) : [];
    } catch (e) {
      log.push({ tool: "llm.synthesis", args: { question }, at: new Date().toISOString(), ok: false, detail: e instanceof Error ? e.message : String(e) });
    }

    // -- 5. VALIDATE every claim against its source ------------------------
    const supported: CandidateClaim[] = [];
    const rejected: CandidateClaim[] = [];
    for (const c of modelClaims) {
      const src = sources.find((s) => s.url === c.source_url) ?? sources.find((s) => normalise(s.url) === normalise(c.source_url));
      const score = src ? quoteScore(c.quote || "", src.text) : 0;
      const claim: CandidateClaim = {
        text: (c.claim || "").slice(0, 500),
        sourceUrl: c.source_url || "",
        quote: (c.quote || "").slice(0, 500),
        verified: score >= 0.75,
        score: Number(score.toFixed(2)),
        verdict: score >= 0.75 ? "supported" : "unsupported",
        sourceTitle: src?.title ?? "",
      };
      if (claim.verified) supported.push(claim);
      else rejected.push(claim);
    }

    // -- 6. persist --------------------------------------------------------
    const total = supported.length + rejected.length;
    const grounding = total ? supported.length / total : 0;
    await db.researchClaim.deleteMany({ where: { runId: run.id } });
    for (const c of [...supported, ...rejected]) {
      await db.researchClaim.create({
        data: {
          runId: run.id,
          text: c.text,
          sources: JSON.stringify([{ url: c.sourceUrl, title: c.sourceTitle, quote: c.quote, score: c.score }]),
          verdict: c.verdict,
          confidence: c.score,
        },
      });
    }
    const summary =
      modelClaims.length === 0
        ? "No claims produced — check the run log (search may have failed or the sources did not cover the question)."
        : `${supported.length}/${total} claim(s) passed quote validation. Unsupported claims are kept visible but marked.`;
    await db.researchRun.update({
      where: { id: run.id },
      data: { status: "done", grounding, summary, log: JSON.stringify(log), finishedAt: new Date() },
    });
    return { runId: run.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.researchRun.update({
      where: { id: run.id },
      data: { status: "error", error: msg, log: JSON.stringify(log), finishedAt: new Date() },
    });
    return { runId: run.id };
  }
}
