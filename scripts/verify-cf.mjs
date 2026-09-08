#!/usr/bin/env node
// verify-cf.mjs — compile-level gate for the Cloudflare conversion.
//
// Checks (per the testing architecture spec):
//   1. Worker purity      — no Node builtins / Next / Prisma / SDK imports in src/worker
//   2. wrangler.jsonc     — entry, ASSETS binding, run_worker_first, D1/KV/R2/AI/Queue, crons
//   3. Static export      — out/ structure vs the ASSETS binding (soft until C3 flips)
//   4. API parity         — every src/app/api/**/route.ts has a Worker registration
//   5. Worker entry shape — fetch/scheduled/email/queue present, satisfies ExportedHandler

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
let failed = 0;
let warned = 0;
const ok = (m) => console.log("  \u2713 " + m);
const warn = (m) => { console.warn("  ! " + m); warned++; };
const bad = (m) => { console.error("  \u2717 " + m); failed++; };

const rel = (p) => relative(root, p);

// ---------------------------------------------------------------------------
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const stripLineComments = (src) =>
  src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------------------------ 1. purity
console.log("\n[1] Worker purity — forbidden imports/exports in src/worker");
const FORBIDDEN = [
  [/from\s+["']node:/, "node: builtin import"],
  [/require\(\s*["']node:/, "node: require"],
  [/from\s+["']next\//, "next/* import"],
  [/from\s+["']next-auth/, "next-auth import"],
  [/from\s+["']@prisma\/client/, "prisma client import"],
  [/from\s+["']z-ai-web-dev-sdk/, "z-ai sdk import"],
  [/from\s+["']sharp["']/, "sharp import"],
];
const workerFiles = walk(join(root, "src", "worker"));
let purityBad = 0;
for (const f of workerFiles) {
  const src = stripLineComments(readFileSync(f, "utf8"));
  for (const [re, label] of FORBIDDEN) {
    if (re.test(src)) { bad(`${rel(f)} — ${label}`); purityBad++; }
  }
  if (/\bBuffer\./.test(src)) warn(`${rel(f)} — Buffer usage (not available in Workers)`);
}
if (purityBad === 0) ok(`${workerFiles.length} worker files are Workers-runtime pure`);

// ------------------------------------------------------------- 2. wrangler.jsonc
console.log("\n[2] wrangler.jsonc wiring");
const rawCfg = readFileSync(join(root, "wrangler.jsonc"), "utf8");
const cfg = JSON.parse(
  rawCfg
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
);
if (cfg.main && existsSync(join(root, cfg.main))) ok(`main → ${cfg.main}`);
else bad(`main missing or not found: ${cfg.main}`);

const assets = cfg.assets || {};
if (assets.binding !== "ASSETS") bad(`assets.binding expected "ASSETS", got ${assets.binding}`);
else ok("assets.binding = ASSETS");
if (Array.isArray(assets.run_worker_first) && assets.run_worker_first.includes("/api/*"))
  ok("run_worker_first = ['/api/*']");
else bad("run_worker_first must include '/api/*'");

const d1 = (cfg.d1_databases || [])[0] || {};
if (d1.binding === "DB" && d1.migrations_dir && existsSync(join(root, d1.migrations_dir)))
  ok(`D1 DB + migrations dir (${d1.migrations_dir})`);
else bad("D1 binding/migrations dir problem");
const kvB = (cfg.kv_namespaces || []).map((n) => n.binding);
for (const b of ["CONSENT", "RATE_LIMIT"])
  kvB.includes(b) ? ok(`KV ${b}`) : bad(`KV ${b} missing`);
(cfg.r2_buckets || []).some((r) => r.binding === "DOCUMENTS")
  ? ok("R2 DOCUMENTS")
  : bad("R2 DOCUMENTS missing");
cfg.ai?.binding === "AI" ? ok("AI binding") : bad("AI binding missing");
const q = (cfg.queues?.producers || [])[0] || {};
q.binding === "WHAPI_QUEUE" && q.queue === "whapi-ingest"
  ? ok("Queue WHAPI_QUEUE → whapi-ingest")
  : bad("Queue producer wiring problem");
const crons = cfg.triggers?.crons || [];
crons.length >= 2 ? ok(`crons ${JSON.stringify(crons)}`) : bad("expected 2 crons");

// ------------------------------------------------------------- 3. static export
console.log("\n[3] Static export (out/) vs ASSETS directory");
const outDir = join(root, assets.directory || "out");
if (!existsSync(outDir)) {
  warn(`${assets.directory || "out/"} does not exist yet — flip lands in C3 (deploy.yml skips gracefully until then)`);
} else {
  if (existsSync(join(outDir, "index.html"))) ok("out/index.html present (SPA entry)");
  else bad("out/ exists but no index.html — not a valid SPA export");
  const hasApi = existsSync(join(outDir, "api"));
  if (hasApi) warn("out/api/ exists — API routes leaked into the export (should be Worker-only)");
  else ok("no api/ in the export");
}

// ------------------------------------------------------------------ 4. parity
console.log("\n[4] API parity — every Next route has a Worker registration");
const apiDir = join(root, "src", "app", "api");
function collect(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, acc);
    else if (e.name === "route.ts") acc.push(p);
  }
  return acc;
}
const routeFiles = collect(apiDir);
const workerSrc = workerFiles.map((f) => readFileSync(f, "utf8")).join("\n");
let parityBad = 0;
for (const f of routeFiles) {
  const sub = relative(apiDir, f).replace(/route\.ts$/, "").replace(/\/$/, "");
  const pattern = ("/api/" + sub).replace(/\/+/g, "/").replace(/\[([^\]]+)\]/g, ":$1");
  const needle = `"${pattern}"`;
  if (workerSrc.includes(needle)) ok(`${pattern}`);
  else { bad(`${pattern} — no Worker registration`); parityBad++; }
}

// ------------------------------------------------------------- 5. entry shape
console.log("\n[5] Worker entry shape");
const entry = readFileSync(join(root, cfg.main), "utf8");
for (const key of ["async fetch", "async scheduled", "async email", "async queue"]) {
  entry.includes(key) ? ok(`${key}() present`) : bad(`${key}() missing`);
}
entry.includes("satisfies ExportedHandler<Env>")
  ? ok("satisfies ExportedHandler<Env>")
  : bad("entry does not satisfy ExportedHandler<Env>");

// ------------------------------------------------------------------- summary
console.log(
  `\nverify-cf: ${failed} error(s), ${warned} warning(s), ` +
  `${routeFiles.length} API routes checked`
);
process.exit(failed > 0 ? 1 : 0);
