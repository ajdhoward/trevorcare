// Research runs — ported from:
//   src/app/api/research/route.ts           → GET/POST /api/research
//   src/app/api/research/[id]/route.ts      → GET /api/research/:id
//   src/app/api/research/claim/route.ts     → PATCH /api/research/claim
//
// Parity notes:
// - JSON shapes are the Prisma camelCase ones: the run LIST drops `log` (the
//   original spread `log: undefined`, which removes the key on the wire) and
//   adds `counts: { supported, unsupported }`; the run DETAIL ships the parsed
//   log array; claim rows keep `sources` as a JSON-encoded STRING (Prisma
//   String column — the client parses it), never pre-parsed.
// - PATCH on a missing claim mirrors the original's Prisma P2025 → withSession
//   catch: 500 { ok:false, error:"Server error — see logs." }.
// - src/lib/research.ts is not portable to Workers (z-ai-web-dev-sdk,
//   @prisma/client): the pure parts (quote validator, MCP streamable-HTTP
//   JSON-RPC client, SSRF-guarded fetch) are inlined below 1:1. The built-in
//   web_search / page_reader tools were SDK-only with no Workers equivalent —
//   each run logs them as skipped and evidence comes from registered MCP
//   servers. Claim synthesis uses the [ai] binding (env.AI) with the identical
//   prompt contract and the repo's standard Workers-AI model.

import { route, type Env, type Handler } from "../router";
import { cuid, fail, json, nowIso } from "../util";

// ---------------------------------------------------------------------------
// D1 rows (migrations/0001_init.sql)
// ---------------------------------------------------------------------------

interface ResearchRunRow {
  id: string;
  subject_id: string;
  question: string;
  status: string;
  grounding: number | null;
  summary: string;
  error: string;
  log: string;
  created_at: string;
  finished_at: string | null;
}

interface ResearchClaimRow {
  id: string;
  run_id: string;
  text: string;
  sources: string;
  verdict: string;
  confidence: number;
  status: string;
  created_at: string;
}

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  headers: string;
  enabled: number;
  tools: string;
  last_test_at: string | null;
  last_result: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Ported from src/lib/research.ts (pure logic) — tool log + quote validation
// ---------------------------------------------------------------------------

interface ToolLogEntry {
  tool: string;
  args: Record<string, unknown>;
  at: string;
  ok: boolean;
  detail: string;
}

interface SearchResult {
  url: string;
  name: string;
  snippet: string;
}

interface ModelClaim {
  claim: string;
  source_url: string;
  quote: string;
}

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
function quoteScore(quote: string, source: string): number {
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
// Ported from src/lib/server/guard.ts — SSRF guard + fetch with timeout/size cap
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

async function safeFetch(
  raw: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {}
): Promise<Response> {
  const url = assertPublicUrl(raw);
  const { timeoutMs = 15_000, maxBytes = 2_000_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal, redirect: "follow" });
    const len = Number(res.headers.get("content-length") || "0");
    if (len > maxBytes) throw new Error(`Response too large (${len} bytes)`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// MCP client — streamable-HTTP JSON-RPC (initialize → tools/list, tools/call).
// Best-effort: servers that need SSE-only transports surface a clear error in
// the run log instead of failing the whole run.
// ---------------------------------------------------------------------------

async function mcpJsonRpc(
  server: McpServerRow,
  method: string,
  params: object,
  id = 1
): Promise<Record<string, unknown>> {
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
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

async function mcpListTools(
  server: McpServerRow,
  log: ToolLogEntry[]
): Promise<Array<{ name: string; description: string }>> {
  try {
    await mcpJsonRpc(
      server,
      "initialize",
      { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "care-hub-research", version: "1.0" } },
      0
    );
    const res = await mcpJsonRpc(server, "tools/list", {});
    const tools = (res.result as { tools?: Array<{ name: string; description?: string }> })?.tools ?? [];
    log.push({
      tool: `mcp:${server.name}:tools/list`,
      args: {},
      at: nowIso(),
      ok: true,
      detail: `${tools.length} tool(s)`,
    });
    return tools.map((t) => ({ name: t.name, description: t.description || "" }));
  } catch (e) {
    log.push({
      tool: `mcp:${server.name}:tools/list`,
      args: {},
      at: nowIso(),
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function mcpCallTool(
  server: McpServerRow,
  toolName: string,
  args: Record<string, unknown>,
  log: ToolLogEntry[]
): Promise<string> {
  try {
    const res = await mcpJsonRpc(server, "tools/call", { name: toolName, arguments: args }, 2);
    const content = (res.result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
    const text = content.map((c) => c.text ?? "").join("\n").slice(0, 8000);
    log.push({
      tool: `mcp:${server.name}:${toolName}`,
      args,
      at: nowIso(),
      ok: true,
      detail: text.slice(0, 200) || "(no text)",
    });
    return text;
  } catch (e) {
    log.push({
      tool: `mcp:${server.name}:${toolName}`,
      args,
      at: nowIso(),
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return "";
  }
}

// ---------------------------------------------------------------------------
// The run itself (ported runResearch — Workers AI instead of the SDK)
// ---------------------------------------------------------------------------

const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function runResearch(env: Env, question: string, subjectId: string): Promise<{ runId: string }> {
  const DB = env.DB;
  const runId = cuid();
  await DB.prepare(
    `INSERT INTO research_runs (id, subject_id, question, status, grounding, summary, error, log, created_at, finished_at)
     VALUES (?, ?, ?, 'running', NULL, '', '', '[]', ?, NULL)`
  )
    .bind(runId, subjectId, question.slice(0, 500), nowIso())
    .run();
  const log: ToolLogEntry[] = [];

  try {
    // -- 1. built-in web search -------------------------------------------
    // The original used the z-ai-web-dev-sdk web_search function, which has no
    // Workers equivalent — logged as skipped so the audit trail stays honest.
    log.push({
      tool: "web_search",
      args: { query: question },
      at: nowIso(),
      ok: false,
      detail:
        "Built-in web search is unavailable on the Workers runtime — register an MCP server with a search tool for live retrieval.",
    });
    let results: SearchResult[] = [];

    // -- 2. registered MCP servers ----------------------------------------
    const servers = await DB.prepare("SELECT * FROM mcp_servers WHERE enabled = 1").all<McpServerRow>();
    for (const s of servers.results ?? []) {
      const tools = await mcpListTools(s, log);
      const searchTool = tools.find((t) => /search|query|fetch|web/i.test(t.name));
      if (searchTool) {
        const out = await mcpCallTool(s, searchTool.name, { query: question }, log);
        if (out) {
          // fold MCP output into the evidence pool as pseudo-results
          results.push({
            url: `mcp://${s.name}/${searchTool.name}`,
            name: `MCP ${s.name} → ${searchTool.name}`,
            snippet: out.slice(0, 4000),
          });
        }
      }
    }

    // -- 3. read the top pages --------------------------------------------
    // The SDK page_reader is also unavailable; non-MCP results fall back to
    // the snippet exactly like the original's page-reader failure path.
    const sources: Array<{ url: string; title: string; text: string }> = [];
    for (const r of results.slice(0, 3)) {
      if (r.url.startsWith("mcp://")) {
        sources.push({ url: r.url, title: r.name, text: r.snippet });
        continue;
      }
      log.push({
        tool: "page_reader",
        args: { url: r.url },
        at: nowIso(),
        ok: false,
        detail: "Built-in page reader is unavailable on the Workers runtime — using the search snippet.",
      });
      sources.push({ url: r.url, title: r.name, text: r.snippet }); // fall back to the snippet
    }
    for (const r of results.slice(3)) {
      sources.push({ url: r.url, title: r.name, text: r.snippet });
    }

    // -- 4. model proposes claims bound to sources (Workers AI binding) ---
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
      if (!env.AI) throw new Error("No [ai] binding configured on this Worker.");
      const out = (await env.AI.run(WORKERS_AI_MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Question: ${question}\n\nSources:\n${evidenceBlock || "(no sources retrieved)"}` },
        ],
        max_tokens: 1500,
      })) as { response?: string };
      const raw = out?.response || "";
      log.push({ tool: "llm.synthesis", args: { question }, at: nowIso(), ok: true, detail: raw.slice(0, 300) });
      const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const parsed = JSON.parse(jsonText) as { claims?: ModelClaim[] };
      modelClaims = Array.isArray(parsed.claims) ? parsed.claims.slice(0, 8) : [];
    } catch (e) {
      log.push({
        tool: "llm.synthesis",
        args: { question },
        at: nowIso(),
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // -- 5. VALIDATE every claim against its source ------------------------
    const supported: Array<{
      text: string;
      sourceUrl: string;
      quote: string;
      score: number;
      verdict: "supported" | "unsupported";
      sourceTitle: string;
    }> = [];
    const rejected: Array<{
      text: string;
      sourceUrl: string;
      quote: string;
      score: number;
      verdict: "supported" | "unsupported";
      sourceTitle: string;
    }> = [];
    for (const c of modelClaims) {
      const src =
        sources.find((s) => s.url === c.source_url) ?? sources.find((s) => normalise(s.url) === normalise(c.source_url));
      const score = src ? quoteScore(c.quote || "", src.text) : 0;
      const claim = {
        text: (c.claim || "").slice(0, 500),
        sourceUrl: c.source_url || "",
        quote: (c.quote || "").slice(0, 500),
        score: Number(score.toFixed(2)),
        verdict: (score >= 0.75 ? "supported" : "unsupported") as "supported" | "unsupported",
        sourceTitle: src?.title ?? "",
      };
      if (score >= 0.75) supported.push(claim);
      else rejected.push(claim);
    }

    // -- 6. persist --------------------------------------------------------
    const total = supported.length + rejected.length;
    const grounding = total ? supported.length / total : 0;
    await DB.prepare("DELETE FROM research_claims WHERE run_id = ?").bind(runId).run();
    for (const c of [...supported, ...rejected]) {
      await DB.prepare(
        `INSERT INTO research_claims (id, run_id, text, sources, verdict, confidence, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
        .bind(
          cuid(),
          runId,
          c.text,
          JSON.stringify([{ url: c.sourceUrl, title: c.sourceTitle, quote: c.quote, score: c.score }]),
          c.verdict,
          c.score,
          nowIso()
        )
        .run();
    }
    const summary =
      modelClaims.length === 0
        ? "No claims produced — check the run log (search may have failed or the sources did not cover the question)."
        : `${supported.length}/${total} claim(s) passed quote validation. Unsupported claims are kept visible but marked.`;
    await DB.prepare(
      `UPDATE research_runs SET status = 'done', grounding = ?, summary = ?, log = ?, finished_at = ? WHERE id = ?`
    )
      .bind(grounding, summary, JSON.stringify(log), nowIso(), runId)
      .run();
    return { runId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await DB.prepare(
      `UPDATE research_runs SET status = 'error', error = ?, log = ?, finished_at = ? WHERE id = ?`
    )
      .bind(msg, JSON.stringify(log), nowIso(), runId)
      .run();
    return { runId };
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/** List row: the original spread the run then dropped `log` (key absent). */
function toRunSummary(row: ResearchRunRow): Record<string, unknown> {
  return {
    id: row.id,
    subjectId: row.subject_id,
    question: row.question,
    status: row.status,
    grounding: row.grounding,
    summary: row.summary,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** Detail row: full run with the log parsed (JSON.parse(run.log || "[]")). */
function toRunDetail(row: ResearchRunRow): Record<string, unknown> {
  let parsedLog: unknown = [];
  try {
    parsedLog = JSON.parse(row.log || "[]");
  } catch {
    parsedLog = []; // defensive; the original would 500 on a corrupt log
  }
  return { ...toRunSummary(row), log: parsedLog };
}

/** Claim rows ship `sources` as the raw JSON STRING — Prisma String column. */
function toClaim(row: ResearchClaimRow): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.run_id,
    text: row.text,
    sources: row.sources,
    verdict: row.verdict,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const listRuns: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const subjectId = ctx.url.searchParams.get("subjectId");
  const runs = subjectId
    ? await DB.prepare("SELECT * FROM research_runs WHERE subject_id = ? ORDER BY created_at DESC LIMIT 30")
        .bind(subjectId)
        .all<ResearchRunRow>()
    : await DB.prepare("SELECT * FROM research_runs ORDER BY created_at DESC LIMIT 30").all<ResearchRunRow>();
  const claimCounts = await DB.prepare(
    "SELECT run_id, verdict, COUNT(*) AS n FROM research_claims GROUP BY run_id, verdict"
  ).all<{ run_id: string; verdict: string; n: number }>();
  const runsWithCounts = (runs.results ?? []).map((r) => {
    const counts = (claimCounts.results ?? []).filter((c) => c.run_id === r.id);
    return {
      ...toRunSummary(r),
      counts: {
        supported: counts.find((c) => c.verdict === "supported")?.n ?? 0,
        unsupported: counts.find((c) => c.verdict === "unsupported")?.n ?? 0,
      },
    };
  });
  return json({ ok: true, runs: runsWithCounts });
};

const startRun: Handler = async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { question?: string; subjectId?: string };
  const question = String(body.question || "").trim();
  if (question.length < 8) {
    return fail("Ask a question of at least a few words.", 400);
  }
  // note: runs synchronously (10-40s). The client shows a running state and
  // polls the list; acceptable for a research tool, keeps deployment simple.
  const { runId } = await runResearch(ctx.env, question, String(body.subjectId || ""));
  return json({ ok: true, runId });
};

const getRun: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const run = await DB.prepare("SELECT * FROM research_runs WHERE id = ?").bind(id).first<ResearchRunRow>();
  if (!run) return fail("Not found", 404);
  const claims = await DB.prepare(
    "SELECT * FROM research_claims WHERE run_id = ? ORDER BY verdict ASC, created_at ASC"
  )
    .bind(id)
    .all<ResearchClaimRow>();
  return json({
    ok: true,
    run: toRunDetail(run),
    claims: (claims.results ?? []).map(toClaim),
  });
};

const reviewClaim: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const body = (await ctx.req.json().catch(() => ({}))) as { id?: string; status?: string };
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !["accepted", "dismissed", "pending"].includes(status)) {
    return fail("id and status (accepted|dismissed|pending) are required.", 400);
  }
  // Prisma's update throws on a missing row → the original's withSession catch
  // answered 500 "Server error — see logs." — mirrored here.
  const existing = await DB.prepare("SELECT * FROM research_claims WHERE id = ?").bind(id).first<ResearchClaimRow>();
  if (!existing) return fail("Server error — see logs.", 500);
  await DB.prepare("UPDATE research_claims SET status = ? WHERE id = ?").bind(status, id).run();
  const claim = await DB.prepare("SELECT * FROM research_claims WHERE id = ?").bind(id).first<ResearchClaimRow>();
  return json({ ok: true, claim: claim ? toClaim(claim) : { id }, decidedBy: ctx.actor || "family" });
};

// ---------------------------------------------------------------------------

export function registerResearchRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/research", listRuns);
  routeFn("POST", "/api/research", startRun);
  // static segments before the dynamic :id route (the router matches in order)
  routeFn("PATCH", "/api/research/claim", reviewClaim);
  routeFn("GET", "/api/research/:id", getRun);
}
