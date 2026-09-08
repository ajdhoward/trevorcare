// Minimal ambient types for the Cloudflare Workers runtime subset this Worker
// uses. Declared locally so the Worker typechecks alongside the Next.js app
// (DOM lib) without adding @cloudflare/workers-types and its global conflicts.
// Names are unique (D1Database, KVNamespace…) so they cannot clash with DOM.

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T[]>>;
}
interface D1Result<T> {
  results?: T;
  success: boolean;
  meta?: Record<string, unknown>;
}
interface KVNamespace {
  get(key: string, type?: "text" | "json"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, opts?: {
    httpMetadata?: { contentType?: string };
  }): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}
interface R2Object { key: string; size: number; uploaded: Date }
interface R2ObjectBody extends R2Object { body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }
interface Ai {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}
interface Queue<Body> {
  send(body: Body): Promise<void>;
}
interface QueueMessageBody {
  [key: string]: unknown;
}
interface QueueMessage<Body = QueueMessageBody> {
  id: string;
  body: Body;
  attempts: number;
}
interface MessageBatch<Body = QueueMessageBody> {
  queue: string;
  messages: QueueMessage<Body>[];
  ackAll(): void;
  retryAll(opts?: { delaySeconds?: number }): void;
}
interface ForwardableEmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
  rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Record<string, string>): Promise<void>;
}
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
interface ExportedHandler<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Response | Promise<Response>;
  scheduled?(controller: { cron: string; scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> | void;
  email?(message: ForwardableEmailMessage, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> | void;
  queue?(batch: MessageBatch, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> | void;
}
interface ScheduledController { cron: string; scheduledTime: number }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
