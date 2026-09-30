import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The test runner.
 *
 * Every run builds a fresh SQLite file, applies the committed migrations and
 * loads the same seed `npm run db:seed` uses, so the engines are tested against
 * the real schema without touching Turso. The file is the only database the
 * tests can see: TURSO_DATABASE_URL is overridden here, before any test module
 * imports the client.
 */
const TEST_DB = path.resolve(import.meta.dirname, ".vitest/test.db");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server Components bundle, which is
      // exactly where tests run. Its job is a build-time guard, not a runtime one.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/setup.ts"],
    env: {
      TURSO_DATABASE_URL: `file:${TEST_DB}`,
      TURSO_AUTH_TOKEN: "",
      AUTH_SECRET: "test-secret-not-used-by-any-deployment",
    },
    // One file at a time: they share one SQLite file, and SQLite takes one
    // writer. Parallel files would only queue on the lock or trip over it.
    fileParallelism: false,
    // 90s, not 30s: the 5,000-row import test (its own 180s override) does
    // thousands of small commits back to back, and whichever test happens to
    // run right after it can catch the tail of that disk contention. A
    // generous shared ceiling absorbs that without hiding a real hang.
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
