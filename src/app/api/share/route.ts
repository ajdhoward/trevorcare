// Shared views API — time-boxed, revocable read-only links for advisers
// (e.g. the social worker, social worker in the family's town). The family creates a token; the
// recipient opens /share/{token} and sees a read-only care brief without an
// account. Revocation is instant; expiry is enforced at view time.
// On Cloudflare: D1 table ShareLink + Turnstile gate — docs/DEPLOYMENT.md.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const links = await db.shareLink.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  let body: { subject?: string; scope?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const subject = (body.subject ?? "").trim();
  if (!subject) return NextResponse.json({ error: "Say who the link is for (e.g. 'the family's social worker')." }, { status: 400 });
  const scope = body.scope === "detailed" ? "detailed" : "summary";
  const days = Math.min(90, Math.max(1, Math.round(body.days ?? 7)));
  const token = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const link = await db.shareLink.create({
    data: { token, subject: subject.slice(0, 120), scope, expiresAt },
  });
  return NextResponse.json({ link });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; revoked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const link = await db.shareLink.update({
    where: { id: body.id },
    data: { revoked: body.revoked ?? true },
  });
  return NextResponse.json({ link });
}
