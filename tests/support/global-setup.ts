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

  const client = createClient({ url: `file:${file}` });
  await migrate(drizzle(client), {
    migrationsFolder: path.resolve(__dirname, "../../src/db/migrations"),
  });
  await seedDatabase(client);
  client.close();
}
