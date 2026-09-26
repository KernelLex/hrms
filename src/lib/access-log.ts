import "server-only";
import { after } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appAccessLog, now } from "@/db/schema";
import type { Session } from "@/lib/auth";

/**
 * Records that someone read a person's pay, bank, tax or documents.
 *
 * Written after the response has gone, so logging never slows a screen, and
 * a failed write is swallowed: an unwritable log must not stop HR doing their
 * job. Every call names the person whose data it is, which is what the
 * question "who has looked at my salary" needs.
 */
export function logAccess(
  session: Session,
  entry: { subjectEmployeeId: number | null; resource: string; resourceId?: string | number },
): void {
  const row = {
    at: now(),
    userId: session.userId,
    username: session.username,
    subjectEmployeeId: entry.subjectEmployeeId,
    resource: entry.resource,
    resourceId: entry.resourceId === undefined ? null : String(entry.resourceId),
  };
  after(async () => {
    try {
      await db.insert(appAccessLog).values(row);
    } catch (err) {
      console.error("Could not write the access log", err);
    }
  });
}

/** The most recent reads of one person's records. */
export async function accessLogFor(subjectEmployeeId: number, limit = 50) {
  return db
    .select()
    .from(appAccessLog)
    .where(eq(appAccessLog.subjectEmployeeId, subjectEmployeeId))
    .orderBy(desc(appAccessLog.at))
    .limit(limit);
}
