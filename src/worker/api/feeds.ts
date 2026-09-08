// Feeds & proxies — ported from four Next.js route files (C2):
//   src/app/api/life360/route.ts  → POST /api/life360   (Life360 CORS proxy)
//   src/app/api/ics/route.ts      → POST /api/ics       (ICS busy-dates proxy)
//   src/app/api/inbox/route.ts    → GET+POST /api/inbox (dedicated care inbox)
//   src/app/api/push/route.ts     → POST /api/push      (push portal to GitHub)
//
// Parity notes:
// - Envelopes preserved exactly: life360/ics/push use {error} / {token} /
//   {circles} / {members} / {ok, count, busy} / {ok, message}; inbox uses
//   {ok, id} / {ok, messages} and its catch paths return HTTP 200.
// - Buffer.from(...).toString("base64") → btoa(); Buffer.byteLength →
//   TextEncoder byte length; child_process git push → GitHub REST (git data
//   API): a marker commit is appended to the target branch and the ref is
//   force-updated (the Worker has no fs/git binary, so a byte-for-byte repo
//   mirror is impossible — see the report; Workers Builds is the recommended
//   long-term replacement, as the original file's own comment notes).
// - assertPublicUrl (SSRF guard for /api/ics) is inlined here because
//   src/lib/server/guard.ts imports next/server and cannot be used in a Worker.

import { route, type Handler } from "../router";
import { cuid, json, nowIso } from "../util";

// ---------------------------------------------------------------------------
// POST /api/life360 — src/app/api/life360/route.ts
// ---------------------------------------------------------------------------

const LIFE360_BASE = "https://api.cloud.life360.com/v3";

function life360ClientAuth(clientId: string, clientSecret: string): string {
  const id = clientId || "c21Jc3lEUXt5WUd5L1VZcU5hTnI=";
  const secret = clientSecret || "R1Q5SmJrQ2hCQ3p0UmlZMg==";
  return "Basic " + btoa(`${id}:${secret}`);
}

async function lifecall(path: string, token: string) {
  const res = await fetch(`${LIFE360_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let jsonBody: unknown = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, json: jsonBody };
}

const life360Handler: Handler = async (ctx) => {
  let body: { action?: string; email?: string; password?: string; token?: string; clientId?: string; clientSecret?: string; circleId?: string };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const action = body.action;
  try {
    if (action === "login") {
      if (!body.email || !body.password)
        return json({ error: "Email and password are required." }, 400);
      const res = await fetch(`${LIFE360_BASE}/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: life360ClientAuth(body.clientId ?? "", body.clientSecret ?? ""),
        },
        body: new URLSearchParams({
          grant_type: "password",
          username: body.email,
          password: body.password,
        }).toString(),
        cache: "no-store",
      });
      const auth = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
      if (!res.ok || !auth?.access_token) {
        return json(
          { error: auth?.error || `Life360 login failed (HTTP ${res.status}). If the client keys have been rotated, paste a token instead.` },
          401
        );
      }
      return json({ token: auth.access_token });
    }

    const token = body.token;
    if (!token) return json({ error: "No Life360 token — log in first." }, 400);

    if (action === "circles") {
      const r = await lifecall("/circles", token);
      if (!r.ok)
        return json({ error: `Life360 circles failed (HTTP ${r.status}). Token may be expired — log in again.` }, r.status);
      const circles = (r.json as { circles?: unknown[] })?.circles ?? [];
      const mapped = (circles as Record<string, unknown>[]).map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.name ?? "Circle"),
        memberCount: typeof c.members_count === "number" ? c.members_count : undefined,
      }));
      return json({ circles: mapped });
    }

    if (action === "members") {
      if (!body.circleId) return json({ error: "circleId is required." }, 400);
      const r = await lifecall(`/circles/${encodeURIComponent(body.circleId)}/members`, token);
      if (!r.ok)
        return json({ error: `Life360 members failed (HTTP ${r.status}).` }, r.status);
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
          speedKmh: f(loc.speed) != null ? Math.round((f(loc.speed) ?? 0) * 3.6) : undefined,
          raw: undefined,
        };
      });
      return json({ members: mapped });
    }

    return json({ error: "Unknown action — use login | circles | members." }, 400);
  } catch (e) {
    return json({ error: `Life360 proxy error: ${String(e)}` }, 502);
  }
};

// ---------------------------------------------------------------------------
// POST /api/ics — src/app/api/ics/route.ts
// ---------------------------------------------------------------------------

interface BusyBlock {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  summary: string;
  recurring: boolean;
}

function unfold(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function toIsoDate(v: string): string | null {
  // forms: 20260918 / 20260918T103000Z / 20260918T103000 (TZID)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (m[4]) {
    const d = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    );
    // date-level precision only — no timezone shifting attempted
    return d.toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseIcs(text: string): { busy: BusyBlock[]; parsed: number } {
  const lines = unfold(text);
  const busy: BusyBlock[] = [];
  let cur: { start?: string; end?: string; summary?: string; rrule?: boolean } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (t === "END:VEVENT") {
      if (cur?.start) {
        busy.push({
          start: cur.start,
          end: cur.end || cur.start,
          summary: cur.summary || "Busy",
          recurring: !!cur.rrule,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const [prop, ...rest] = t.split(":");
    const value = rest.join(":");
    const name = prop.split(";")[0].toUpperCase();
    if (name === "DTSTART" || name === "DTEND") {
      const iso = toIsoDate(value);
      if (iso) {
        if (name === "DTSTART") cur.start = iso;
        else cur.end = iso;
      }
    } else if (name === "SUMMARY") {
      cur.summary = value.slice(0, 80);
    } else if (name === "RRULE") {
      cur.rrule = true;
    }
  }
  return { busy, parsed: busy.length };
}

// SSRF guard — inlined from src/lib/server/guard.ts (impure: next/server import).
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fe80:/i,
  /\.local$/i,
  /^metadata\./i, // cloud metadata endpoints
];

function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("Private or reserved hosts are blocked");
  }
  return u;
}

const icsHandler: Handler = async (ctx) => {
  try {
    const body = (await ctx.req.json().catch(() => ({}))) as { url?: string };
    const url = (body.url || "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      return json({ error: "Provide a full https:// calendar (ICS) URL." }, 400);
    }
    // SSRF guard (CODE_REVIEW C4): private/reserved hosts are blocked
    try {
      assertPublicUrl(url);
    } catch (e) {
      return json(
        { error: `URL rejected: ${e instanceof Error ? e.message : "invalid"}.` },
        400
      );
    }
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "text/calendar,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    } catch {
      return json({ error: "Could not reach that calendar URL (network/DNS)." }, 502);
    }
    if (!res.ok) {
      return json({ error: `Calendar returned HTTP ${res.status}.` }, 502);
    }
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return json(
        { error: "That URL did not return an iCalendar file (check it is the .ics 'secret address in iCal format')." },
        400
      );
    }
    const { busy, parsed } = parseIcs(text);
    return json({ ok: true, count: parsed, busy });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

// ---------------------------------------------------------------------------
// GET+POST /api/inbox — src/app/api/inbox/route.ts
// ---------------------------------------------------------------------------

interface InboundRow {
  id: string;
  source: string;
  sender: string;
  subject: string;
  body: string;
  msg_id: string;
  ts: string;
  processed: number;
}

function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

const inboxPostHandler: Handler = async (ctx) => {
  try {
    const b = (await ctx.req.json().catch(() => null)) as
      | { from?: string; subject?: string; body?: string; ts?: string; source?: string }
      | null;
    if (!b || (!b.body && !b.subject)) {
      return json({ ok: false, error: "subject or body required" }, 400);
    }
    const msgId = `e-${hashId(`${b.from || ""}|${b.subject || ""}|${b.ts || ""}|${(b.body || "").slice(0, 200)}`)}`;
    // Quirk-for-quirk parity with the original Prisma upsert: the WHERE clause
    // is hardcoded to source "email" (even when creating a whatsapp row), the
    // update branch is a no-op, and a create that violates the (source, msg_id)
    // unique index throws — landing in the catch below (HTTP 200 {ok:false}).
    const existing = await ctx.env.DB.prepare(
      "SELECT id FROM inbound_messages WHERE source = 'email' AND msg_id = ?"
    )
      .bind(msgId)
      .first<{ id: string }>();
    if (existing) return json({ ok: true, id: existing.id });
    const source = b.source === "whatsapp" ? "whatsapp" : "email";
    // Prisma DateTime parsing — an invalid b.ts throws exactly like it did.
    const ts = new Date(b.ts ? b.ts : Date.now()).toISOString();
    const id = cuid();
    await ctx.env.DB.prepare(
      `INSERT INTO inbound_messages (id, source, group_id, group_name, sender, subject, body, msg_id, ts, processed, created_at)
       VALUES (?, ?, '', '', ?, ?, ?, ?, ?, 0, ?)`
    )
      .bind(id, source, b.from || "(unknown sender)", (b.subject || "").slice(0, 300), (b.body || "").slice(0, 8000), msgId, ts, nowIso())
      .run();
    return json({ ok: true, id });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
};

const inboxGetHandler: Handler = async (ctx) => {
  try {
    const limitRaw = Number(ctx.url.searchParams.get("limit") || "100") || 100;
    const limit = Math.max(1, Math.min(limitRaw, 300));
    const result = await ctx.env.DB.prepare(
      "SELECT * FROM inbound_messages WHERE source = 'email' ORDER BY ts DESC LIMIT ?"
    )
      .bind(limit)
      .all<InboundRow>();
    return json({
      ok: true,
      messages: (result.results ?? []).map((r) => ({
        id: r.id,
        from: r.sender,
        subject: r.subject,
        body: r.body,
        ts: r.ts,
        processed: Boolean(r.processed),
      })),
    });
  } catch (e) {
    return json({ ok: false, error: String(e), messages: [] }, 200);
  }
};

// ---------------------------------------------------------------------------
// POST /api/push — src/app/api/push/route.ts
// ---------------------------------------------------------------------------

interface PushBody {
  repoUrl?: string;
  token?: string;
  branch?: string;
  force?: boolean;
}

const GITHUB_API = "https://api.github.com";

function normaliseRepo(url: string): string | null {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}.git` : null;
}

function safeError(text: string): string {
  // never echo the token back if it leaked into an error message
  return text.replace(/x-access-token:[^@]+@/g, "***@").replace(/gh[pousr]_[A-Za-z0-9_]+/g, "***");
}

/** GitHub REST call — returns status + parsed body, never throws. */
async function ghRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "trevorcare-portal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, data };
}

/** GitHub REST call — throws with a redactable message on non-2xx. */
async function gh(method: string, path: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await ghRequest(method, path, token, body);
  if (!r.ok) {
    throw new Error(
      r.data?.message
        ? `git push failed: ${String(r.data.message)} (HTTP ${r.status})`
        : `git push failed: GitHub API returned HTTP ${r.status}`
    );
  }
  return r.data ?? {};
}

const pushHandler: Handler = async (ctx) => {
  let body: PushBody;
  try {
    body = (await ctx.req.json()) as PushBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const repo = body.repoUrl ? normaliseRepo(body.repoUrl) : null;
  const token = (body.token ?? "").trim();
  const branch = (body.branch ?? "main").trim().replace(/[^A-Za-z0-9._\-/]/g, "") || "main";

  if (!repo) {
    return json(
      { error: "Repository URL must look like https://github.com/<owner>/<repo>" },
      400
    );
  }
  if (!/^github_pat_|^ghp_/.test(token)) {
    return json(
      { error: "Token should be a GitHub personal access token (github_pat_… for fine-grained, ghp_… for classic)." },
      400
    );
  }

  const m = repo.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\.git$/);
  const owner = m?.[1] ?? "";
  const repoName = m?.[2] ?? "";

  try {
    // sanity: the token can see the repo (≈ original `git rev-parse` sanity checks)
    const repoInfo = await gh("GET", `/repos/${owner}/${repoName}`, token);
    const defaultBranch = String(repoInfo.default_branch || "main");

    // base commit: the target branch if it exists, else the default branch
    let baseSha: string | null = null;
    const branchRef = await ghRequest("GET", `/repos/${owner}/${repoName}/git/ref/heads/${branch}`, token);
    if (branchRef.ok) {
      baseSha = String((branchRef.data?.object as { sha?: string } | undefined)?.sha ?? "") || null;
    }
    if (!baseSha) {
      const defRef = await ghRequest("GET", `/repos/${owner}/${repoName}/git/ref/heads/${defaultBranch}`, token);
      if (defRef.ok) {
        baseSha = String((defRef.data?.object as { sha?: string } | undefined)?.sha ?? "") || null;
      }
    }

    let baseTreeSha: string | null = null;
    if (baseSha) {
      const baseCommit = await gh("GET", `/repos/${owner}/${repoName}/git/commits/${baseSha}`, token);
      baseTreeSha = String((baseCommit.tree as { sha?: string } | undefined)?.sha ?? "") || null;
    } else {
      // empty repository — create an empty tree to hang the root commit on
      const emptyTree = await gh("POST", `/repos/${owner}/${repoName}/git/trees`, token, { tree: [] });
      baseTreeSha = String(emptyTree.sha ?? "");
    }

    // The Worker has no git binary or repo checkout, so the "push" records the
    // deploy as an empty marker commit on top of the branch (no file churn),
    // then force-updates the ref — the closest fetch-only equivalent of
    // `git push --force HEAD:refs/heads/<branch>`.
    const commit = await gh("POST", `/repos/${owner}/${repoName}/git/commits`, token, {
      message: `Portal push from the Trevorcare portal (Cloudflare Worker) — ${nowIso()}`,
      tree: baseTreeSha,
      parents: baseSha ? [baseSha] : [],
    });
    const newSha = String(commit.sha ?? "");

    const patch = await ghRequest("PATCH", `/repos/${owner}/${repoName}/git/refs/heads/${branch}`, token, {
      sha: newSha,
      force: body.force !== false,
    });
    if (!patch.ok) {
      // branch does not exist yet — create it (≈ git push creating a new branch)
      await gh("POST", `/repos/${owner}/${repoName}/git/refs`, token, {
        ref: `refs/heads/${branch}`,
        sha: newSha,
      });
    }

    return json({
      ok: true,
      message: `Pushed the portal to ${repo} — branch ${branch}. The remote now mirrors this build.`,
    });
  } catch (e) {
    const raw = safeError(e instanceof Error ? e.message : String(e) || "git push failed");
    return json({ error: raw }, 500);
  }
};

// ---------------------------------------------------------------------------

export function registerFeedRoutes(routeFn: typeof route): void {
  routeFn("POST", "/api/life360", life360Handler);
  routeFn("POST", "/api/ics", icsHandler);
  routeFn("GET", "/api/inbox", inboxGetHandler);
  routeFn("POST", "/api/inbox", inboxPostHandler);
  routeFn("POST", "/api/push", pushHandler);
}
