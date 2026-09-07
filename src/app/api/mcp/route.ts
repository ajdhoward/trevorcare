// MCP server registry — list / add / test / remove servers used by the
// research engine. Server URLs must be public (SSRF-guarded).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    const rows = await db.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ ok: true, servers: rows });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { name?: string; url?: string; headers?: string };
    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    if (!name || !url) {
      return NextResponse.json({ ok: false, error: "name and url are required." }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: "URL must start with http(s):// — private hosts are blocked at call time." }, { status: 400 });
    }
    const row = await db.mcpServer.create({
      data: {
        name: name.slice(0, 60),
        url: url.slice(0, 300),
        headers: typeof body.headers === "string" ? body.headers : "{}",
      },
    });
    return NextResponse.json({ ok: true, server: row }, { status: 201 });
  });
}
