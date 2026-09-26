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

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client);

  console.log(`Migrating ${url}`);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations applied.");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
