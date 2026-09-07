// Life360 server-side proxy — keeps the client out of CORS trouble and holds
// nothing sensitive itself. Supports three actions:
//   login   → exchange email/password for a bearer token (client stores it)
//   circles → GET /v3/circles
//   members → GET /v3/circles/{id}/members
// On Cloudflare Workers: identical code (nodejs_compat fetch), token in KV.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://api.cloud.life360.com/v3";

function clientAuth(clientId: string, clientSecret: string): string {
  const id = clientId || "c21Jc3lEUXt5WUd5L1VZcU5hTnI=";
  const secret = clientSecret || "R1Q5SmJrQ2hCQ3p0UmlZMg==";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function lifecall(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, json };
}

export async function POST(req: NextRequest) {
  let body: { action?: string; email?: string; password?: string; token?: string; clientId?: string; clientSecret?: string; circleId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;
  try {
    if (action === "login") {
      if (!body.email || !body.password)
        return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
      const res = await fetch(`${BASE}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: clientAuth(body.clientId ?? "", body.clientSecret ?? ""),
        },
        body: new URLSearchParams({
          grant_type: "password",
          username: body.email,
          password: body.password,
        }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
      if (!res.ok || !json?.access_token) {
        return NextResponse.json(
          { error: json?.error || `Life360 login failed (HTTP ${res.status}). If the client keys have been rotated, paste a token instead.` },
          { status: 401 }
        );
      }
      return NextResponse.json({ token: json.access_token });
    }

    const token = body.token;
    if (!token) return NextResponse.json({ error: "No Life360 token — log in first." }, { status: 400 });

    if (action === "circles") {
      const r = await lifecall("/circles", token);
      if (!r.ok)
        return NextResponse.json({ error: `Life360 circles failed (HTTP ${r.status}). Token may be expired — log in again.` }, { status: r.status });
      const circles = (r.json as { circles?: unknown[] })?.circles ?? [];
      const mapped = (circles as Record<string, unknown>[]).map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.name ?? "Circle"),
        memberCount: typeof c.members_count === "number" ? c.members_count : undefined,
      }));
      return NextResponse.json({ circles: mapped });
    }

    if (action === "members") {
      if (!body.circleId) return NextResponse.json({ error: "circleId is required." }, { status: 400 });
      const r = await lifecall(`/circles/${encodeURIComponent(body.circleId)}/members`, token);
      if (!r.ok)
        return NextResponse.json({ error: `Life360 members failed (HTTP ${r.status}).` }, { status: r.status });
      const members = (r.json as { members?: Record<string, unknown>[] })?.members ?? [];
      const mapped = members.map((m) => {
        const loc = (m.location ?? {}) as Record<string, unknown>;
        const f = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
        const issueTime = typeof loc.issueTime === "string" ? loc.issueTime : undefined;
        return {
          id: String(m.id ?? ""),
          name: [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member",
          avatar: typeof m.avatar === "string" ? m.avatar : undefined,
          phone: typeof m.phone === "string" ? m.phone : undefined,
          lat: f(loc.latitude),
          lon: f(loc.longitude),
          lastCheckin: issueTime,
          battery: f(loc.battery),
          charging: String(loc.charge ?? "0") === "1",
          speedKmh: f(loc.speed) != null ? Math.round(((f(loc.speed) ?? 0)) * 3.6) : undefined,
          raw: undefined,
        };
      });
      return NextResponse.json({ members: mapped });
    }

    return NextResponse.json({ error: "Unknown action — use login | circles | members." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Life360 proxy error: ${String(e)}` }, { status: 502 });
  }
}
