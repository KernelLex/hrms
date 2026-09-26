import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * Time master data, plus a year of quotas and one pending request so the
 * approval queue is not empty on first look.
 */
export async function seedTime(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();
  const year = new Date().getUTCFullYear();

  await db
    .insert(s.ptQuotaType)
    .values([
      { code: "ANNUAL", name: "Annual leave", defaultEntitlementDays: 18, isActive: true },
      { code: "SICK", name: "Sick leave", defaultEntitlementDays: 12, isActive: true },
      { code: "CASUAL", name: "Casual leave", defaultEntitlementDays: 6, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.ptAbsenceType)
    .values([
      { code: "0100", name: "Sick leave", isPaid: true, countsAgainstQuota: true, quotaTypeCode: "SICK", isActive: true },
      { code: "0200", name: "Annual leave", isPaid: true, countsAgainstQuota: true, quotaTypeCode: "ANNUAL", isActive: true },
      { code: "0250", name: "Casual leave", isPaid: true, countsAgainstQuota: true, quotaTypeCode: "CASUAL", isActive: true },
      // Unpaid leave is the one payroll prorates against.
      { code: "0300", name: "Unpaid leave", isPaid: false, countsAgainstQuota: false, quotaTypeCode: null, isActive: true },
      { code: "0400", name: "Maternity leave", isPaid: true, countsAgainstQuota: false, quotaTypeCode: null, isActive: true },
      { code: "0500", name: "Bereavement leave", isPaid: true, countsAgainstQuota: false, quotaTypeCode: null, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.ptAttendanceType)
    .values([
      { code: "0800", name: "Overtime", isOvertime: true, isActive: true },
      { code: "0810", name: "On duty / business travel", isOvertime: false, isActive: true },
      { code: "0820", name: "Training", isOvertime: false, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.ptHoliday)
    .values([
      { date: `${year}-01-26`, name: "Republic Day", region: "National" },
      { date: `${year}-08-15`, name: "Independence Day", region: "National" },
      { date: `${year}-10-02`, name: "Gandhi Jayanti", region: "National" },
      { date: `${year}-12-25`, name: "Christmas Day", region: "National" },
      { date: `${year}-11-01`, name: "Kannada Rajyotsava", region: "Karnataka" },
    ])
    .onConflictDoNothing();

  // Entitlements for everyone, for this year.
  const employees = await db.select().from(s.paEmployee);
  for (const e of employees) {
    for (const q of [
      { code: "ANNUAL", days: 18 },
      { code: "SICK", days: 12 },
      { code: "CASUAL", days: 6 },
    ]) {
      await db
        .insert(s.ptAbsenceQuota)
        .values({
          employeeId: e.id,
          quotaTypeCode: q.code,
          year,
          entitledHalfDays: q.days * 2,
          usedHalfDays: 0,
          createdAt,
        })
        .onConflictDoNothing();
    }
  }

  // One pending request, so the manager's approval queue has something in it.
  const arjun = await db.query.paEmployee.findFirst({
    where: eq(s.paEmployee.employeeNumber, "EMP1001"),
  });
  if (arjun) {
    const existing = await db.query.ptLeaveRequest.findFirst({
      where: eq(s.ptLeaveRequest.employeeId, arjun.id),
    });
    if (!existing) {
      await db.insert(s.ptLeaveRequest).values({
        employeeId: arjun.id,
        absenceTypeCode: "0200",
        fromDate: `${year}-12-22`,
        toDate: `${year}-12-24`,
        isHalfDay: false,
        payrollDays: 3,
        reason: "Family trip",
        status: "Pending",
        submittedAt: createdAt,
      });
    }
  }

  notes.push("  3 quota types, 6 absence types, 3 attendance types");
  notes.push(`  5 public holidays, quotas for ${employees.length} employees in ${year}`);
  notes.push("  1 pending leave request awaiting a manager");
  return notes;
}
