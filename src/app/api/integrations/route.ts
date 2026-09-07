// PIM integrations API — list (seeding the three providers on first call) and
// connect/disconnect. OAuth client credentials are deployment secrets (env);
// a feed URL (ICS subscription) gives working sync without any credentials.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { PIM_PROVIDERS } from "@/lib/pim";

async function seedOnce() {
  const count = await db.pimIntegration.count();
  if (count > 0) return;
  for (const p of PIM_PROVIDERS) {
    await db.pimIntegration.create({ data: { provider: p.id, kind: "calendar" } });
  }
}

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    await seedOnce();
    const rows = await db.pimIntegration.findMany({ orderBy: { createdAt: "asc" } });
    const providers = PIM_PROVIDERS.map((p) => ({
      ...p,
      oauthReady: !!process.env[p.envClient] && !!process.env[p.envSecret],
    }));
    const integrations = rows.map((r) => ({
      ...r,
      token: undefined, // never ship the token to the client
      hasToken: !!r.token,
    }));
    return NextResponse.json({ ok: true, providers, integrations });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async () => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = String(body.provider || "");
    if (!PIM_PROVIDERS.some((p) => p.id === provider)) {
      return NextResponse.json({ ok: false, error: "Unknown provider." }, { status: 400 });
    }
    const account = String(body.account || "").slice(0, 120);
    const feedUrl = String(body.feedUrl || "").trim();
    const data: Record<string, unknown> = {
      account,
      status: feedUrl || account ? "connected" : "disconnected",
      config: JSON.stringify({ feedUrl, connectedAt: new Date().toISOString() }),
      lastResult: feedUrl ? "Feed saved — run 'Sync now'." : "Saved.",
    };
    const existing = await db.pimIntegration.findFirst({ where: { provider, kind: "calendar" } });
    const row = existing
      ? await db.pimIntegration.update({ where: { id: existing.id }, data })
      : await db.pimIntegration.create({ data: { provider, kind: "calendar", ...data } });
    return NextResponse.json({ ok: true, integration: { ...row, token: undefined } });
  });
}
