import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { readEnv } from "@/lib/env";

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

  const url = readEnv("TURSO_DATABASE_URL");
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  // A local SQLite file otherwise fails SQLITE_BUSY the instant another
  // connection briefly holds the write lock, rather than waiting for it —
  // the sequential test suite's own worker-to-worker handoffs are enough to
  // trigger that. Turso's remote connections ignore this option.
  _client = createClient({ url, authToken: readEnv("TURSO_AUTH_TOKEN"), timeout: 5000 });
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
