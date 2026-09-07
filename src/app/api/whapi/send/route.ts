// Whapi.Cloud proxy — send a text message into a WhatsApp group (by @g.us id).
// Used for: proposed-slot messages to Pat, the family group, and the
// future mum's group with Mum's care home.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { token, to, body } = (await req.json()) as { token?: string; to?: string; body?: string };
    if (!token || !to || !body) {
      return NextResponse.json({ error: "token, to (group id) and body are required." }, { status: 400 });
    }
    const res = await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ to, body }),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            res.status === 401
              ? "Whapi rejected the token (401)."
              : res.status === 404
                ? "Group id not found (404) — re-fetch groups and pick the right one."
                : `Whapi returned HTTP ${res.status}.`,
          status: res.status,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, response: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
