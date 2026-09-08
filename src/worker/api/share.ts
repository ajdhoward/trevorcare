// Shared views API — ported 1:1 from src/app/api/share/route.ts (C2).
// Time-boxed, revocable read-only links for advisers: the family creates a
// token; the recipient opens /share/{token} and sees a read-only care brief
// without an account. Revocation is instant; expiry is enforced at view time.
//
// Parity notes:
// - The Next.js middleware treats /api/share as PUBLIC, so these routes are
//   registered { public: true } — the first (and only) public data routes.
// - The original returns a BARE envelope ({ links } / { link }) and plain
//   { error } bodies — deliberately different from the { ok } envelopes used
//   elsewhere. Preserved exactly.
// - randomBytes(16).toString("base64url") → crypto.getRandomValues + btoa.
// - Prisma update of a missing link throws (Next → HTTP 500); mirrored by
//   throwing into the router's catch.

import { route, type Handler } from "../router";
import { cuid, json, nowIso } from "../util";

interface ShareLinkRow {
  id: string;
  token: string;
  subject: string;
  scope: string;
  created_at: string;
  expires_at: string;
  revoked: number;
  views: number;
  last_viewed_at: string | null;
}

/** D1 row → the camelCase JSON Prisma/Next.js returned. */
function toLink(row: ShareLinkRow): Record<string, unknown> {
  return {
    id: row.id,
    token: row.token,
    subject: row.subject,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revoked: Boolean(row.revoked),
    views: row.views,
    lastViewedAt: row.last_viewed_at ?? null,
  };
}

/** 16 random bytes, base64url — same output as randomBytes(16).toString("base64url"). */
function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const listLinks: Handler = async (ctx) => {
  const result = await ctx.env.DB.prepare(
    "SELECT * FROM share_links ORDER BY created_at DESC LIMIT 50"
  ).all<ShareLinkRow>();
  return json({ links: (result.results ?? []).map(toLink) });
};

const createLink: Handler = async (ctx) => {
  let body: { subject?: string; scope?: string; days?: number };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const subject = (body.subject ?? "").trim();
  if (!subject) return json({ error: "Say who the link is for (e.g. 'the family's social worker')." }, 400);
  const scope = body.scope === "detailed" ? "detailed" : "summary";
  const days = Math.min(90, Math.max(1, Math.round(body.days ?? 7)));
  const token = randomToken();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const id = cuid();
  await ctx.env.DB.prepare(
    `INSERT INTO share_links (id, token, subject, scope, created_at, expires_at, revoked, views, last_viewed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL)`
  )
    .bind(id, token, subject.slice(0, 120), scope, createdAt, expiresAt)
    .run();
  const row = await ctx.env.DB.prepare("SELECT * FROM share_links WHERE id = ?").bind(id).first<ShareLinkRow>();
  return json({ link: row ? toLink(row) : { id, token, subject, scope, createdAt, expiresAt, revoked: false, views: 0, lastViewedAt: null } });
};

const updateLink: Handler = async (ctx) => {
  let body: { id?: string; revoked?: boolean };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!body.id) return json({ error: "id is required." }, 400);
  // Prisma throws on update of a missing row (Next responds 500) — mirror it.
  const existing = await ctx.env.DB.prepare("SELECT * FROM share_links WHERE id = ?")
    .bind(body.id)
    .first<ShareLinkRow>();
  if (!existing) throw new Error("Share link not found");
  const revoked = body.revoked ?? true;
  await ctx.env.DB.prepare("UPDATE share_links SET revoked = ? WHERE id = ?")
    .bind(revoked ? 1 : 0, body.id)
    .run();
  const row = await ctx.env.DB.prepare("SELECT * FROM share_links WHERE id = ?").bind(body.id).first<ShareLinkRow>();
  return json({ link: row ? toLink(row) : null });
};

export function registerShareRoutes(routeFn: typeof route): void {
  routeFn("GET", "/api/share", listLinks, { public: true });
  routeFn("POST", "/api/share", createLink, { public: true });
  routeFn("PATCH", "/api/share", updateLink, { public: true });
}
