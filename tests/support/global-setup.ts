import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { seedDatabase } from "../../src/db/seed";

/**
 * Runs once before the suite: a fresh file, the committed migrations, the demo
 * seed. Starting from nothing each time means no test depends on what a
 * previous run left behind.
 */
export default async function setup() {
  const dir = path.resolve(__dirname, "../../.vitest");
  const file = path.join(dir, "test.db");

  fs.mkdirSync(dir, { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(file + suffix, { force: true });
  }

  // Matches vitest.config.mts's own test.env: some seed steps reach for the
  // engines' rawClient() singleton (e.g. leave-policy accrual), which reads
  // this directly and otherwise only sees it once a test file's worker
  // process starts — after this setup has already run.
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  process.env.TURSO_AUTH_TOKEN = "";

  const client = createClient({ url: `file:${file}`, timeout: 5000 });
  await migrate(drizzle(client), {
    migrationsFolder: path.resolve(__dirname, "../../src/db/migrations"),
  });
  await seedDatabase(client);
  client.close();
}
