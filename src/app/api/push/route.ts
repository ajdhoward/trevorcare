// Push-to-repo endpoint — one-click "Push portal to repo" for the Deploy tab.
// Accepts a fine-grained GitHub PAT (Contents: Read & Write, scoped to exactly
// this repository) and pushes the current branch as a mirror of this portal.
// The token is used for THIS request only: it lives in a temporary git remote
// that is removed afterwards, and is never stored or logged server-side.
//
// Gated by the portal middleware (valid session cookie required). .env, the
// database and all private-data patterns are excluded by .gitignore. On
// Cloudflare, replace this with Workers Builds / a webhook — docs/GITHUB-SETUP.md.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { promisify } from "util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const run = promisify(execFile);

interface PushBody {
  repoUrl?: string;
  token?: string;
  branch?: string;
  force?: boolean;
}

function normaliseRepo(url: string): string | null {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}.git` : null;
}

function safeError(text: string): string {
  // never echo the token back if it leaked into git's stderr
  return text.replace(/x-access-token:[^@]+@/g, "***@").replace(/gh[pousr]_[A-Za-z0-9_]+/g, "***");
}

export async function POST(req: NextRequest) {
  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const repo = body.repoUrl ? normaliseRepo(body.repoUrl) : null;
  const token = (body.token ?? "").trim();
  const branch = (body.branch ?? "main").trim().replace(/[^A-Za-z0-9._\-/]/g, "") || "main";

  if (!repo) {
    return NextResponse.json(
      { error: "Repository URL must look like https://github.com/<owner>/<repo>" },
      { status: 400 }
    );
  }
  if (!/^github_pat_|^ghp_/.test(token)) {
    return NextResponse.json(
      { error: "Token should be a GitHub personal access token (github_pat_… for fine-grained, ghp_… for classic)." },
      { status: 400 }
    );
  }

  const remoteName = `push-${randomBytes(4).toString("hex")}`;
  const authed = repo.replace("https://", `https://x-access-token:${token}@`);
  try {
    // sanity: we are inside the portal repo with at least one commit
    await run("git", ["rev-parse", "--is-inside-work-tree"]);
    await run("git", ["rev-parse", "HEAD"]);

    await run("git", ["remote", "add", remoteName, authed]);
    try {
      await run("git", ["push", "--quiet", body.force === false ? "" : "--force", remoteName, `HEAD:refs/heads/${branch}`].filter(Boolean), {
        timeout: 120_000,
      });
    } finally {
      await run("git", ["remote", "remove", remoteName]).catch(() => {
        /* best effort cleanup */
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Pushed the portal to ${repo} — branch ${branch}. The remote now mirrors this build.`,
    });
  } catch (e) {
    const err = e as { stderr?: string; message?: string; code?: number };
    const raw = safeError(err.stderr || err.message || "git push failed");
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
