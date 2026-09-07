// OAuth2 callback — exchanges the authorisation code for a token, stores it
// server-side on the integration row, and closes the popup window.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeFetch } from "@/lib/server/guard";
import { PIM_PROVIDERS } from "@/lib/pim";

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { provider } = await ctx.params;
  const p = PIM_PROVIDERS.find((x) => x.id === provider);
  const origin = req.nextUrl.origin;
  const html = (msg: string, ok: boolean) =>
    new NextResponse(
      `<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;background:#071a16;color:#d1fae5"><div style="max-width:30rem;text-align:center"><h1 style="font-size:1.2rem">${ok ? "Connected" : "Not connected"}</h1><p style="line-height:1.5">${msg}</p><p><a href="/" style="color:#5eead4">Return to the hub</a></p><script>setTimeout(()=>window.close(),4000)</script></div></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );

  if (!p) return html("Unknown provider.", false);

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  if (error) return html(`The provider returned: ${error}`, false);
  if (!code) return html("No authorisation code was returned.", false);

  const clientId = process.env[p.envClient];
  const clientSecret = process.env[p.envSecret];
  if (!clientId || !clientSecret || !p.tokenEndpoint) {
    return html(`${p.label} OAuth credentials are not configured — ${p.setupNotes}`, false);
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/api/integrations/oauth/callback/${p.id}`,
    });
    if (p.id === "microsoft") body.set("scope", p.scopes || "");
    const res = await safeFetch(p.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs: 15_000,
    });
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      return html(`Token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`, false);
    }
    const row = await db.pimIntegration.findFirst({ where: { provider: p.id, kind: "calendar" } });
    if (row) {
      await db.pimIntegration.update({
        where: { id: row.id },
        data: { token: data.access_token, status: "connected", lastResult: "OAuth connected — run 'Sync now'." },
      });
    }
    return html(`${p.label} connected. You can close this window.`, true);
  } catch (e) {
    return html(`Token exchange error: ${e instanceof Error ? e.message : String(e)}`, false);
  }
}
