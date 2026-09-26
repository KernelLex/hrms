import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

/**
 * Turso (libSQL) client.
 *
 * The transport is HTTP, so serverless invocations need no connection pool and
 * a module-level client is safe on Vercel.
 *
 * Local development points at a file (`file:./local.db`); preview and
 * production point at Turso. Foreign keys are off by default in SQLite, so we
 * assert them on — see `db/seed/run.ts` for the check.
 */
const url = process.env.TURSO_DATABASE_URL;

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
}

export const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

export type Db = typeof db;
