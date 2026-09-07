// Test or remove a registered MCP server. Test performs a real JSON-RPC
// handshake (initialize → tools/list) through the same client the research
// engine uses, so the studio shows exactly what research will see.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { mcpListTools } from "@/lib/research";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.mcpServer.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const log: Array<{ tool: string; ok: boolean; detail: string }> = [];
    const tools = await mcpListTools(row, log as never);
    const ok = tools.length > 0;
    await db.mcpServer.update({
      where: { id },
      data: {
        tools: JSON.stringify(tools),
        lastTestAt: new Date(),
        lastResult: ok ? `${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}` : "Handshake failed — see detail.",
      },
    });
    return NextResponse.json({ ok, tools, log });
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; name?: string; url?: string; headers?: string };
    const data: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 60);
    if (typeof body.url === "string" && body.url.trim()) data.url = body.url.trim().slice(0, 300);
    if (typeof body.headers === "string") data.headers = body.headers;
    const row = await db.mcpServer.update({ where: { id }, data });
    return NextResponse.json({ ok: true, server: row });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    await db.mcpServer.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
