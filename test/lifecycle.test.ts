// Suite 4 — lifecycle handlers and binding interactions, driven against the
// real worker entry: fetch routing + a full subjects CRUD round-trip;
// scheduled/email/queue handlers resolve without throwing (C4 stubs for
// now); R2 and KV round-trips; the queue producer accepts a message.

import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import migration from "../migrations/0001_init.sql?raw";
import migrationAlerts from "../migrations/0002_alerts.sql?raw";
import { applySql } from "./helpers";

const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

beforeAll(async () => {
  await applySql(env.DB, migration);
  await applySql(env.DB, migrationAlerts);
});

const loginCookie = async (): Promise<string> => {
  const res = await SELF.fetch("https://portal.test/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "demo" }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0];
};

describe("fetch routing + CRUD", () => {
  it("serves the public index route", async () => {
    const res = await SELF.fetch("https://portal.test/api");
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown API paths", async () => {
    const res = await SELF.fetch("https://portal.test/api/definitely-not-a-route");
    expect(res.status).toBe(404);
  });

  it("runs a full subjects CRUD round-trip", async () => {
    const cookie = await loginCookie();
    const h = { "Content-Type": "application/json", Cookie: cookie };

    const create = await SELF.fetch("https://portal.test/api/subjects", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ displayName: "Test Subject", setting: "home" }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { subject: { id: string; displayName: string } };
    expect(created.subject.displayName).toBe("Test Subject");
    const id = created.subject.id;

    const list = await SELF.fetch("https://portal.test/api/subjects", { headers: h });
    const listed = (await list.json()) as { subjects: Array<{ id: string }> };
    expect(listed.subjects.some((s) => s.id === id)).toBe(true);

    const patch = await SELF.fetch(`https://portal.test/api/subjects/${id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    expect(patch.status).toBeLessThan(300);

    const one = await SELF.fetch(`https://portal.test/api/subjects/${id}`, { headers: h });
    const oneJ = (await one.json()) as { subject?: { displayName?: string } & Record<string, unknown> };
    const subject = oneJ.subject ?? (oneJ as unknown as { displayName: string });
    expect(subject.displayName).toBe("Renamed");

    const del = await SELF.fetch(`https://portal.test/api/subjects/${id}?hard=1`, {
      method: "DELETE",
      headers: h,
    });
    expect(del.status).toBeLessThan(300);

    const gone = await SELF.fetch(`https://portal.test/api/subjects/${id}`, { headers: h });
    expect(gone.status).toBe(404);
  });
});

describe("inbound intake → queue → D1 (full pipeline)", () => {
  const payload = {
    messages: [
      {
        id: "wam.test1",
        chat_id: "1203@g.us",
        from_name: "Tester",
        text: { body: "hello from the queue" },
        timestamp: 1757300000,
      },
    ],
  };

  it("webhook hands the payload to WHAPI_QUEUE when the binding exists", async () => {
    const res = await SELF.fetch("https://portal.test/api/whapi/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; queued?: boolean };
    expect(j.ok).toBe(true);
    expect(j.queued).toBe(true); // queue binding is provisioned in the test env
  });

  it("queue() handler commits the message to inbound_messages", async () => {
    const batch = {
      queue: "whapi-ingest",
      messages: [{ id: "q1", timestamp: Date.now(), body: payload, attempts: 1 }],
      ackAll() {},
      retryAll() {},
      maxAttempts: 3,
    } as unknown as MessageBatch;
    await worker.queue(batch, env, execCtx);

    const row = await env.DB
      .prepare("SELECT source, sender, body FROM inbound_messages WHERE msg_id = ?")
      .bind("wam.test1")
      .first<{ source: string; sender: string; body: string }>();
    expect(row?.source).toBe("whatsapp");
    expect(row?.sender).toBe("Tester");
    expect(row?.body).toBe("hello from the queue");
  });

  it("queue() handler dedupes on replay (at-least-once delivery is safe)", async () => {
    const batch = {
      queue: "whapi-ingest",
      messages: [{ id: "q2", timestamp: Date.now(), body: payload, attempts: 2 }],
      ackAll() {},
      retryAll() {},
      maxAttempts: 3,
    } as unknown as MessageBatch;
    await worker.queue(batch, env, execCtx); // same msg_id — must not duplicate

    const n = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM inbound_messages WHERE msg_id = ?")
      .bind("wam.test1")
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("scheduled() evaluates alert_rules and records alert_events", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO alert_rules (id, subject_id, kind, config, channel, enabled, created_at, updated_at) VALUES (?, '', 'no-checkin', '{\"hours\":1}', 'inbox', 1, ?, ?)"
    )
      .bind("rule-digest-1", now, now)
      .run();

    const controller = { scheduledTime: Date.now(), cron: "0 8 * * *" };
    await worker.scheduled(controller as unknown as ScheduledController, env, execCtx);

    const ev = await env.DB
      .prepare("SELECT state, detail FROM alert_events WHERE rule_id = ?")
      .bind("rule-digest-1")
      .first<{ state: string; detail: string }>();
    expect(ev?.state).toBeDefined();
    expect(["ok", "warning", "alert"]).toContain(ev?.state);

    const rule = await env.DB
      .prepare("SELECT last_state, last_run_at FROM alert_rules WHERE id = ?")
      .bind("rule-digest-1")
      .first<{ last_state: string; last_run_at: string }>();
    expect(rule?.last_run_at).not.toBe("");
    expect(rule?.last_state).toBe(ev?.state);
  });
});

describe("scheduled / email / queue handlers (C4)", () => {
  it("scheduled() resolves without throwing", async () => {
    const controller = { scheduledTime: Date.now(), cron: "0 8 * * *" };
    await expect(
      worker.scheduled(controller as unknown as ScheduledController, env, execCtx)
    ).resolves.toBeUndefined();
  });

  it("email() resolves without throwing", async () => {
    const message = {
      from: "relative@example.com",
      to: "care@portal.test",
      headers: new Headers(),
      raw: new Response("hello care team").body as unknown as ReadableStream,
      rawSize: 15,
      setReject() {},
      forward() {},
      reply() {},
    };
    await expect(
      worker.email(message as unknown as ForwardableEmailMessage, env, execCtx)
    ).resolves.toBeUndefined();
  });

  it("queue() resolves without throwing on an empty batch", async () => {
    const batch = {
      queue: "whapi-ingest",
      messages: [],
      ackAll() {},
      retryAll() {},
      maxAttempts: 1,
    };
    await expect(
      worker.queue(batch as unknown as MessageBatch, env, execCtx)
    ).resolves.toBeUndefined();
  });
});

describe("binding interactions", () => {
  it("R2 DOCUMENTS round-trip (put/get/delete)", async () => {
    await env.DOCUMENTS.put("test/hello.txt", "hello vault");
    const obj = await env.DOCUMENTS.get("test/hello.txt");
    expect(await obj?.text()).toBe("hello vault");
    await env.DOCUMENTS.delete("test/hello.txt");
    expect(await env.DOCUMENTS.get("test/hello.txt")).toBeNull();
  });

  it("KV CONSENT round-trip", async () => {
    await env.CONSENT.put("consent:test", "granted");
    expect(await env.CONSENT.get("consent:test")).toBe("granted");
    await env.CONSENT.delete("consent:test");
  });

  it("queue producer WHAPI_QUEUE accepts a message", async () => {
    await expect(env.WHAPI_QUEUE.send({ hello: "world" })).resolves.toBeUndefined();
  });
});
