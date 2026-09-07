// Whapi.Cloud proxy — list the WhatsApp groups on the linked number.
// The API token is supplied by the client per request (stored in the user's
// browser, not on the server) and proxied so the browser never calls
// gate.whapi.cloud directly (CORS + keeps the token out of page history).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token) {
      return NextResponse.json({ error: "No Whapi.Cloud token provided." }, { status: 400 });
    }
    const res = await fetch("https://gate.whapi.cloud/groups?count=100", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !Array.isArray(data)) {
      const msg =
        res.status === 401
          ? "Whapi rejected the token (401) — check it in the Whapi dashboard."
          : `Whapi returned HTTP ${res.status}.`;
      return NextResponse.json({ error: msg, status: res.status }, { status: 502 });
    }
    const groups = (data as Record<string, unknown>[])
      .filter((g) => typeof g.id === "string")
      .map((g) => ({
        id: g.id as string,
        name: (g.name as string) || "(unnamed group)",
        participants: (g.participants_count as number) ?? null,
      }));
    return NextResponse.json({ ok: true, groups });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
