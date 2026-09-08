// Suite 1 — idempotent migrations: the real 0001_init.sql applied to a fresh
// in-memory D1 (no SQL mocks) must succeed, create every table, and re-apply
// cleanly (IF NOT EXISTS idempotency).

import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import migration from "../migrations/0001_init.sql?raw";
import { applySql } from "./helpers";

const EXPECTED_TABLES = [
  "ai_feedback",
  "app_secrets",
  "audit_log",
  "care_subjects",
  "extracted_facts",
  "finance_entries",
  "inbound_messages",
  "mcp_servers",
  "pim_integrations",
  "posts",
  "research_claims",
  "research_runs",
  "share_links",
  "signin_log",
  "users",
  "vault_documents",
  "wizard_defs",
];

describe("idempotent D1 migrations", () => {
  beforeAll(async () => {
    await applySql(env.DB, migration);
  });

  it("applies the real 0001_init.sql to a fresh database", async () => {
    // No throw = the SQL is SQLite/D1-compatible as written.
    await applySql(env.DB, migration);
  });

  it("creates every expected table", async () => {
    const res = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' " +
        "AND name NOT IN ('d1_migrations')"
    ).all<{ name: string }>();
    const names = (res.results ?? []).map((r) => r.name);
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
  });

  it("has the audit chain columns (prev_hmac/hmac) and the vault R2 key", async () => {
    const audit = await env.DB.prepare("PRAGMA table_info(audit_log)").all<{ name: string }>();
    const auditCols = (audit.results ?? []).map((c) => c.name);
    expect(auditCols).toContain("prev_hmac");
    expect(auditCols).toContain("hmac");

    const vault = await env.DB.prepare("PRAGMA table_info(vault_documents)").all<{ name: string }>();
    expect((vault.results ?? []).map((c) => c.name)).toContain("r2_key");
  });

  it("is idempotent — applying twice does not throw", async () => {
    await applySql(env.DB, migration);
    await applySql(env.DB, migration);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(n?.n).toBe(0); // re-apply must not seed or duplicate anything
  });
});
