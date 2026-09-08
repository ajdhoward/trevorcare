// Suite 3 — self-generating secrets: the first authenticated action triggers
// crypto.getRandomValues() and persists the value in the D1 app_secrets table;
// later requests read the same value seamlessly (no regeneration, no manual
// paste). Only real D1 — no mocks.

import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import migration from "../migrations/0001_init.sql?raw";
import { applySql } from "./helpers";

beforeAll(async () => {
  await applySql(env.DB, migration);
});

const login = (): Promise<Response> =>
  SELF.fetch("https://portal.test/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "demo" }),
  });

const secretValue = async (): Promise<string | undefined> =>
  (
    await env.DB
      .prepare("SELECT value FROM app_secrets WHERE key = 'session_secret'")
      .first<{ value: string }>()
  )?.value;

describe("self-generating app_secrets", () => {
  it("starts with an empty app_secrets table", async () => {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_secrets").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("generates the secret on first login and reuses it on later logins", async () => {
    const res1 = await login();
    expect(res1.status).toBe(200);
    const first = await secretValue();
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    // Second login must read the stored secret, not regenerate it.
    const res2 = await login();
    expect(res2.status).toBe(200);
    expect(await secretValue()).toBe(first);
  });
});
