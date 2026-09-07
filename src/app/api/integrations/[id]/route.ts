// Per-integration: sync now (ICS feed → parsed events / OAuth pull when
// credentials exist) and disconnect.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession, safeFetch } from "@/lib/server/guard";
import { parseIcs } from "@/lib/pim";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.pimIntegration.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    let config: { feedUrl?: string } = {};
    try {
      config = JSON.parse(row.config || "{}") as { feedUrl?: string };
    } catch {
      config = {};
    }

    if (config.feedUrl) {
      try {
        const res = await safeFetch(config.feedUrl, { timeoutMs: 12_000 });
        if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
        const text = await res.text();
        const { events, errors } = parseIcs(text);
        await db.pimIntegration.update({
          where: { id },
          data: {
            lastSyncAt: new Date(),
            lastResult: `${events.length} event(s) pulled from feed${errors.length ? ` — ${errors[0]}` : ""}`,
            status: "connected",
          },
        });
        return NextResponse.json({ ok: true, events, errors, source: "feed" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.pimIntegration.update({
          where: { id },
          data: { lastSyncAt: new Date(), lastResult: `Sync failed: ${msg}`, status: "error" },
        });
        return NextResponse.json({ ok: false, error: `Sync failed: ${msg}` }, { status: 502 });
      }
    }

    if (row.token) {
      // Native OAuth pull (works once deployment credentials exist and the
      // connect flow exchanged a token). Google Calendar list + events.
      if (row.provider === "google") {
        try {
          const res = await safeFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
            headers: { Authorization: `Bearer ${row.token}` },
            timeoutMs: 12_000,
          });
          const data = (await res.json()) as { items?: Array<{ id: string; summary: string }> };
          await db.pimIntegration.update({
            where: { id },
            data: { lastSyncAt: new Date(), lastResult: `Google: ${data.items?.length ?? 0} calendar(s) visible`, status: "connected" },
          });
          return NextResponse.json({ ok: true, calendars: data.items ?? [], source: "google-oauth" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.pimIntegration.update({ where: { id }, data: { status: "error", lastResult: `Sync failed: ${msg}` } });
          return NextResponse.json({ ok: false, error: msg }, { status: 502 });
        }
      }
      if (row.provider === "microsoft") {
        try {
          const res = await safeFetch("https://graph.microsoft.com/v1.0/me/calendars", {
            headers: { Authorization: `Bearer ${row.token}` },
            timeoutMs: 12_000,
          });
          const data = (await res.json()) as { value?: Array<{ id: string; name: string }> };
          await db.pimIntegration.update({
            where: { id },
            data: { lastSyncAt: new Date(), lastResult: `Microsoft Graph: ${data.value?.length ?? 0} calendar(s)`, status: "connected" },
          });
          return NextResponse.json({ ok: true, calendars: data.value ?? [], source: "graph" });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.pimIntegration.update({ where: { id }, data: { status: "error", lastResult: `Sync failed: ${msg}` } });
          return NextResponse.json({ ok: false, error: msg }, { status: 502 });
        }
      }
    }

    return NextResponse.json({
      ok: false,
      error:
        "Nothing to sync yet — add an iCloud/ICS feed URL, or complete the OAuth setup (see the provider card's setup notes) so the portal can exchange a token.",
    }, { status: 400 });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.pimIntegration.update({
      where: { id },
      data: { status: "disconnected", account: "", config: "{}", token: "", lastResult: "Disconnected." },
    });
    return NextResponse.json({ ok: true, integration: { ...row, token: undefined } });
  });
}
