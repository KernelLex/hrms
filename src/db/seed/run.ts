/**
 * Seeds the demo organisation. Run with `npm run db:seed`.
 *
 * The data itself lives in ./index.ts, shared with the test runner.
 */
import { createClient } from "@libsql/client";
import { loadEnv } from "../load-env";
import { seedDatabase } from "./index";

loadEnv();

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set.");

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const notes = await seedDatabase(client);

  console.log("Seeded:");
  for (const n of notes) console.log(n);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
