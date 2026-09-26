import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import { omCompany, secAppUser } from "@/db/schema";

/**
 * Liveness and database connectivity.
 *
 * Deliberately reports no data beyond row counts, and is excluded from the
 * proxy's auth redirect so a deployment check can reach it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [companies] = await db.select({ n: count() }).from(omCompany);
    const [users] = await db.select({ n: count() }).from(secAppUser);

    // The relational query API is only populated when the schema registers
    // correctly through the bundler; sign-in depends on it.
    const relational = typeof db.query?.secAppUser?.findFirst === "function";

    return NextResponse.json({
      ok: true,
      database: "reachable",
      relationalQueryApi: relational,
      counts: { companies: companies.n, users: users.n },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
