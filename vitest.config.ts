import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Workers-pool test setup. Bindings are provisioned directly through
// Miniflare (fresh + isolated per test) rather than pointing at
// wrangler.jsonc, because the real config references build output (out/)
// that only exists after `next build`, and pins a production
// compatibility date newer than the test-bundled workerd.
//
// Tests import the worker entry (src/worker/index.ts) directly and drive
// `env` from "cloudflare:test" — real in-memory D1/KV/R2/Queues, no mocks
// of the data layer.

export default defineWorkersConfig({
  test: {
    rules: [
      // import migration SQL as text — no fs in the Workers runtime
      { type: "Text", globs: ["**/*.sql"] },
    ],
    poolOptions: {
      workers: {
        main: "./src/worker/index.ts",
        miniflare: {
          compatibilityDate: "2025-09-01",
          d1Databases: ["DB"],
          kvNamespaces: ["CONSENT", "RATE_LIMIT"],
          r2Buckets: ["DOCUMENTS"],
          queueProducers: ["WHAPI_QUEUE"],
        },
      },
    },
  },
});
