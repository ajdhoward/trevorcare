// OAuth2 start — builds the provider consent URL from deployment credentials.
// If credentials are not configured, returns a clear setup message instead of
// a broken redirect. GET /api/integrations/oauth/start?provider=google

import { NextRequest, NextResponse } from "next/server";
import { PIM_PROVIDERS } from "@/lib/pim";

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") || "";
  const p = PIM_PROVIDERS.find((x) => x.id === provider);
  if (!p) return NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 400 });

  const clientId = process.env[p.envClient];
  const clientSecret = process.env[p.envSecret];
  if (!clientId || !clientSecret || !p.authEndpoint) {
    return NextResponse.json(
      {
        ok: false,
        setup: true,
        error: `${p.label}: OAuth is not configured on this deployment yet. ${p.setupNotes}`,
      },
      { status: 400 }
    );
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/integrations/oauth/callback/${p.id}`;
  const url = new URL(p.authEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scopes || "");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (p.id === "microsoft") url.searchParams.set("response_mode", "query");
  return NextResponse.json({ ok: true, consentUrl: url.toString() });
}
