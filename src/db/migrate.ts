/**
 * Applies pending migrations. Run with `npm run db:migrate`.
 *
 * Works against both a local file (`file:./local.db`) and Turso, because the
 * libSQL client speaks to each over the same interface.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set.");

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, timeout: 5000 });
  const db = drizzle(client);

  // A local file only: WAL mode lets a reader and a writer work at once
  // instead of blocking each other, which is what the test suite's
  // sequential-but-overlapping file handoffs need. It is stored in the file
  // itself, so this only has to run once, and Turso's own remote connections
  // do not speak this pragma at all.
  if (url.startsWith("file:")) await client.execute("PRAGMA journal_mode = WAL");

  console.log(`Migrating ${url}`);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations applied.");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
