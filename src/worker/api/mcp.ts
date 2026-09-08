// MCP server registry — ported 1:1 from:
//   src/app/api/mcp/route.ts      (GET list, POST add)
//   src/app/api/mcp/[id]/route.ts (POST test, PATCH, DELETE)
//
// Parity notes:
//  - Envelopes/fields/status codes/error strings preserved exactly, including
//    the test route's bare { ok, tools, log } envelope (ok reflects handshake
//    success, HTTP stays 200) and the log entries' full
//    { tool, args, at, ok, detail } shape as actually returned by the original.
//  - The JSON-RPC MCP client (initialize → tools/list, SSE unwrap) is inlined
//    from src/lib/research.ts — that module imports z-ai-web-dev-sdk, the
//    Prisma client and @/lib/db, so it cannot be imported from a Worker. The
//    Prisma McpServer row is replaced by a local { name, url, headers } view.
//  - The SSRF-guarded fetch (safeFetch) is inlined from
//    src/lib/server/guard.ts (which imports next/server): same 12s timeout,
//    1 MB content-length cap, redirect:follow, same error strings.
//  - PATCH/DELETE quirk preserved: the original Prisma update/delete on a
//    missing record throws, which withSession turns into a 500
//    "Server error — see logs." envelope (not a 404). The POST *test* route
//    does return 404 "Not found" (it checks first), like the original.

import { route, type Handler } from "../router";
import { cuid, fail, json, nowIso } from "../util";

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

interface ToolLogEntry {
  tool: string;
  args: Record<string, unknown>;
  at: string;
  ok: boolean;
  detail: string;
}

/** D1 row → the camelCase JSON the client expects. */
function toServer(row: McpServerRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headers: row.headers,
    enabled: Boolean(row.enabled),
    tools: row.tools,
    lastTestAt: row.last_test_at ?? null,
    lastResult: row.last_result,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// SSRF guard + guarded fetch — inlined verbatim from src/lib/server/guard.ts
// (assertPublicUrl + safeFetch) so behaviour (12s timeout, 1 MB cap) matches
// what the research engine's mcpJsonRpc actually did.
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

async function guardedFetch(
  raw: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number
): Promise<Response> {
  const url = assertPublicUrl(raw);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
    const len = Number(res.headers.get("content-length") || "0");
    if (len > maxBytes) throw new Error(`Response too large (${len} bytes)`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// MCP client — streamable-HTTP JSON-RPC (initialize → tools/list), inlined
// verbatim from src/lib/research.ts.
// ---------------------------------------------------------------------------

interface McpServerView {
  name: string;
  url: string;
  headers: string;
}

async function mcpJsonRpc(server: McpServerView, method: string, params: object, id = 1): Promise<Record<string, unknown>> {
  let headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  try {
    headers = { ...headers, ...(JSON.parse(server.headers || "{}") as Record<string, string>) };
  } catch {
    /* headers optional */
  }
  const res = await guardedFetch(
    server.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    },
    12_000,
    1_000_000
  );
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

async function mcpListTools(server: McpServerView, log: ToolLogEntry[]): Promise<Array<{ name: string; description: string }>> {
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const listServers: Handler = async (ctx) => {
  const result = await ctx.env.DB.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all<McpServerRow>();
  return json({ ok: true, servers: (result.results ?? []).map(toServer) });
};

const createServer: Handler = async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { name?: string; url?: string; headers?: string };
  const name = String(body.name || "").trim();
  const url = String(body.url || "").trim();
  if (!name || !url) {
    return fail("name and url are required.", 400);
  }
  if (!/^https?:\/\//i.test(url)) {
    return fail("URL must start with http(s):// — private hosts are blocked at call time.", 400);
  }
  const id = cuid();
  await ctx.env.DB.prepare(
    `INSERT INTO mcp_servers (id, name, url, headers, enabled, tools, last_test_at, last_result, created_at)
     VALUES (?, ?, ?, ?, 1, '[]', NULL, '', ?)`
  )
    .bind(id, name.slice(0, 60), url.slice(0, 300), typeof body.headers === "string" ? body.headers : "{}", nowIso())
    .run();
  const row = await ctx.env.DB.prepare("SELECT * FROM mcp_servers WHERE id = ?").bind(id).first<McpServerRow>();
  return json({ ok: true, server: row ? toServer(row) : { id } }, 201);
};

const testServer: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const row = await DB.prepare("SELECT * FROM mcp_servers WHERE id = ?").bind(id).first<McpServerRow>();
  if (!row) return fail("Not found", 404);
  const log: ToolLogEntry[] = [];
  const tools = await mcpListTools({ name: row.name, url: row.url, headers: row.headers }, log);
  const ok = tools.length > 0;
  await DB.prepare("UPDATE mcp_servers SET tools = ?, last_test_at = ?, last_result = ? WHERE id = ?")
    .bind(
      JSON.stringify(tools),
      nowIso(),
      ok ? `${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}` : "Handshake failed — see detail.",
      id
    )
    .run();
  return json({ ok, tools, log });
};

const patchServer: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const body = (await ctx.req.json().catch(() => ({}))) as { enabled?: boolean; name?: string; url?: string; headers?: string };
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.enabled === "boolean") {
    sets.push("enabled = ?");
    binds.push(body.enabled ? 1 : 0);
  }
  if (typeof body.name === "string" && body.name.trim()) {
    sets.push("name = ?");
    binds.push(body.name.trim().slice(0, 60));
  }
  if (typeof body.url === "string" && body.url.trim()) {
    sets.push("url = ?");
    binds.push(body.url.trim().slice(0, 300));
  }
  if (typeof body.headers === "string") {
    sets.push("headers = ?");
    binds.push(body.headers);
  }
  let row = await DB.prepare("SELECT * FROM mcp_servers WHERE id = ?").bind(id).first<McpServerRow>();
  if (!row) {
    // Parity: the original Prisma update throws P2025 on a missing record and
    // withSession converts that into this exact 500 envelope.
    return fail("Server error — see logs.", 500);
  }
  if (sets.length) {
    await DB.prepare(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, id)
      .run();
    row = (await DB.prepare("SELECT * FROM mcp_servers WHERE id = ?").bind(id).first<McpServerRow>()) ?? row;
  }
  return json({ ok: true, server: toServer(row) });
};

const deleteServer: Handler = async (ctx) => {
  const DB = ctx.env.DB;
  const id = ctx.params.id;
  const row = await DB.prepare("SELECT id FROM mcp_servers WHERE id = ?").bind(id).first<{ id: string }>();
  if (!row) {
    // Parity: the original's uncaught Prisma delete throws on a missing
    // record → withSession 500 envelope (not 404).
    return fail("Server error — see logs.", 500);
  }
  await DB.prepare("DELETE FROM mcp_servers WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

export function registerMcpRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/mcp", listServers);
  routeFn("POST", "/api/mcp", createServer);
  routeFn("POST", "/api/mcp/:id", testServer);
  routeFn("PATCH", "/api/mcp/:id", patchServer);
  routeFn("DELETE", "/api/mcp/:id", deleteServer);
}
