import { spawnSync } from "node:child_process";

/**
 * `npm run api:docs`: regenerates the reference section of API.md from the
 * endpoint definitions. It runs through the test runner, which can load the
 * server modules the definitions live in.
 */

const result = spawnSync("npx", ["vitest", "run", "tests/api-reference.test.ts"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, UPDATE_API_DOCS: "1" },
});
process.exit(result.status ?? 1);
