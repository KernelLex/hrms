import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

/**
 * Turso (libSQL) client.
 *
 * The transport is HTTP, so serverless invocations need no connection pool and
 * a module-level instance is safe on Vercel.
 *
 * Connection is established lazily on first use rather than at import time.
 * Next.js evaluates route modules while collecting page data during the build,
 * where connection details may legitimately be absent — throwing at module
 * scope fails the whole build instead of the one request that actually needs a
 * database.
 */

type Database = LibSQLDatabase<typeof schema>;

let _client: Client | undefined;
let _db: Database | undefined;

function connect(): Database {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  _db = drizzle(_client, { schema });
  return _db;
}

/** The Drizzle handle. Connects on first property access. */
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(connect(), prop);
  },
});

/** The raw libSQL client, for PRAGMA statements and batches. */
export function rawClient(): Client {
  connect();
  return _client!;
}

export type Db = Database;
