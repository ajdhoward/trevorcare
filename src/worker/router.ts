// Router primitives for the Trevorcare Worker. API modules register their
// routes here; index.ts wires modules together and owns the entry point.

/** Worker bindings — mirrors the top-level Env (wrangler.jsonc + secrets). */
export interface Env {
  DB: D1Database;
  CONSENT: KVNamespace;
  RATE_LIMIT: KVNamespace;
  DOCUMENTS: R2Bucket;
  /** Remote binding — absent under `wrangler dev --local`; all call sites guard. */
  AI?: Ai;
  /** Absent on the $0 plan (Queues need Workers Paid) — ingest degrades to direct. */
  WHAPI_QUEUE?: Queue<Record<string, unknown>>;
  ASSETS: Fetcher;
  /** Legacy dev-fallback gate (optional secret). */
  PORTAL_PASSWORD?: string;
  /** Legacy cookie-signing secret (optional — auto-generated if unset). */
  SESSION_SECRET?: string;
  AI_GATEWAY_ID?: string;
  PORTAL_NAME?: string;
  /** PIM OAuth apps (optional — the connect flows are inactive until set). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
}

export interface RequestContext {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** Authenticated identity: Access email, or legacy session username. */
  actor: string;
  /** How the request was authenticated. */
  via: "access" | "session" | "public";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (ctx: RequestContext) => Promise<Response>;

interface RouteDef {
  method: string;
  pattern: string;
  public?: boolean;
  handler: Handler;
}

const routes: RouteDef[] = [];

export function route(
  method: string,
  pattern: string,
  handler: Handler,
  opts?: { public?: boolean }
): void {
  routes.push({ method, pattern, public: opts?.public, handler });
}

export function matchRoute(
  method: string,
  pathname: string
): { handler: Handler; isPublic: boolean; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const pp = r.pattern.split("/").filter(Boolean);
    const sp = pathname.split("/").filter(Boolean);
    if (pp.length !== sp.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
      else if (pp[i] !== sp[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, isPublic: Boolean(r.public), params };
  }
  return null;
}
