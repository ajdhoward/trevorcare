// Suite 2 — auth boundary gates: CF Access header maps to an auto-provisioned
// user entity, unauthenticated requests are rejected with 401 {auth:required},
// the legacy signed cookie still opens the gate, and tampered cookies are
// rejected by the HMAC check.

import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import migration from "../migrations/0001_init.sql?raw";
import { applySql } from "./helpers";

beforeAll(async () => {
  await applySql(env.DB, migration);
});

const login = async (password: string): Promise<Response> =>
  SELF.fetch("https://portal.test/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

describe("auth boundary gates", () => {
  it("public routes respond without any credentials", async () => {
    const res = await SELF.fetch("https://portal.test/api");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  it("rejects unauthenticated access to protected routes with 401 {auth:'required'}", async () => {
    const res = await SELF.fetch("https://portal.test/api/subjects");
    expect(res.status).toBe(401);
    const j = (await res.json()) as { auth?: string };
    expect(j.auth).toBe("required");
  });

  it("rejects a wrong password (and logs the attempt)", async () => {
    const res = await login("definitely-wrong");
    expect(res.status).toBe(401);
    const row = await env.DB
      .prepare("SELECT ok FROM signin_log WHERE ok = 0 ORDER BY rowid DESC LIMIT 1")
      .first<{ ok: number }>();
    expect(row?.ok).toBe(0);
  });

  it("issues a legacy session cookie that opens the gate", async () => {
    const res = await login("demo");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("care_session=");
    const cookie = setCookie.split(";")[0];

    const ok = await SELF.fetch("https://portal.test/api/subjects", {
      headers: { Cookie: cookie },
    });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { ok: boolean; subjects: unknown[] };
    expect(j.ok).toBe(true);
    expect(j.subjects.length).toBeGreaterThan(0); // demo subjects seeded
  });

  it("rejects a tampered session cookie (HMAC mismatch)", async () => {
    const res = await login("demo");
    const raw = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
    const value = raw.split("=").slice(1).join("=");
    const tampered = `care_session=${value.slice(0, -2)}zz`;
    const r = await SELF.fetch("https://portal.test/api/subjects", {
      headers: { Cookie: tampered },
    });
    expect(r.status).toBe(401);
  });

  it("maps the CF Access header to an auto-provisioned viewer user", async () => {
    const res = await SELF.fetch("https://portal.test/api/subjects", {
      headers: { "Cf-Access-Authenticated-User-Email": "carer@example.com" },
    });
    expect(res.status).toBe(200);

    const row = await env.DB
      .prepare("SELECT email, role FROM users WHERE email = ?")
      .bind("carer@example.com")
      .first<{ email: string; role: string }>();
    expect(row?.email).toBe("carer@example.com");
    expect(row?.role).toBe("viewer");
  });
});
