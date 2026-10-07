import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { rawClient } from "@/lib/db";
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
      { code: "0600", name: "Compensatory off", isPaid: true, countsAgainstQuota: false, quotaTypeCode: null, isCompOff: true, isActive: true },
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
    .insert(s.ptHolidayCalendar)
    .values([
      // Two optional holidays each, so the choice is real: a festival the
      // company leaves to the employee is a working day until they take it.
      { code: "NATIONAL", name: "National", optionalAllowance: 2, isActive: true },
      { code: "KARNATAKA", name: "Karnataka", optionalAllowance: 2, isActive: true },
      { code: "MAHARASHTRA", name: "Maharashtra", optionalAllowance: 2, isActive: true },
    ])
    .onConflictDoNothing();

  // Each calendar lists every holiday its area observes, national ones
  // included — a calendar is the complete list, not a state list layered
  // onto a separate national one.
  const NATIONAL_HOLIDAYS = [
    { date: `${year}-01-26`, name: "Republic Day" },
    { date: `${year}-08-15`, name: "Independence Day" },
    { date: `${year}-10-02`, name: "Gandhi Jayanti" },
    { date: `${year}-12-25`, name: "Christmas Day" },
  ];
  // Festivals the company leaves to each person: three on every calendar,
  // of which anyone may take two.
  const OPTIONAL_HOLIDAYS = [
    { date: `${year}-03-25`, name: "Holi" },
    { date: `${year}-04-14`, name: "Tamil New Year" },
    { date: `${year}-09-05`, name: "Onam" },
  ];
  await db
    .insert(s.ptHoliday)
    .values([
      ...NATIONAL_HOLIDAYS.map((h) => ({ ...h, calendarCode: "NATIONAL" })),
      ...NATIONAL_HOLIDAYS.map((h) => ({ ...h, calendarCode: "KARNATAKA" })),
      ...NATIONAL_HOLIDAYS.map((h) => ({ ...h, calendarCode: "MAHARASHTRA" })),
      { date: `${year}-11-01`, name: "Kannada Rajyotsava", calendarCode: "KARNATAKA" },
      { date: `${year}-05-01`, name: "Maharashtra Day", calendarCode: "MAHARASHTRA" },
      ...OPTIONAL_HOLIDAYS.flatMap((h) =>
        ["NATIONAL", "KARNATAKA", "MAHARASHTRA"].map((calendarCode) => ({ ...h, calendarCode, isOptional: true })),
      ),
    ])
    .onConflictDoNothing();

  // The head office sits in Karnataka; the factory, for the demo, in
  // Maharashtra — enough for payroll and quotas to show two real calendars.
  await db.update(s.omPersonnelArea).set({ calendarCode: "KARNATAKA" }).where(eq(s.omPersonnelArea.code, "PA01"));
  await db.update(s.omPersonnelArea).set({ calendarCode: "MAHARASHTRA" }).where(eq(s.omPersonnelArea.code, "PA02"));

  // One policy per quota type, open to every grade and area, covering the
  // same entitlements the old flat grant used — but earned through the
  // ledger now, so a joiner is pro-rated and a balance is always explained
  // by what accrued it. Each demonstrates a different corner of the engine:
  // annual accrues yearly, carries forward a little and can be encashed or
  // sandwiched; sick accrues monthly; casual neither carries forward nor
  // pro-rates a joiner.
  await db
    .insert(s.ptLeavePolicy)
    .values([
      {
        code: "ANNUAL-STD",
        name: "Annual leave",
        quotaTypeCode: "ANNUAL",
        entitlementHalfDaysPerYear: 36,
        accrualFrequency: "Yearly",
        proRataForJoiners: true,
        carryForwardCapHalfDays: 10,
        lapseOn: "03-31",
        encashableHalfDaysPerYear: 10,
        sandwichRule: true,
        isActive: true,
        createdAt,
      },
      {
        code: "SICK-STD",
        name: "Sick leave",
        quotaTypeCode: "SICK",
        entitlementHalfDaysPerYear: 24,
        accrualFrequency: "Monthly",
        proRataForJoiners: true,
        carryForwardCapHalfDays: 0,
        lapseOn: "03-31",
        encashableHalfDaysPerYear: 0,
        sandwichRule: false,
        isActive: true,
        createdAt,
      },
      {
        code: "CASUAL-STD",
        name: "Casual leave",
        quotaTypeCode: "CASUAL",
        entitlementHalfDaysPerYear: 12,
        accrualFrequency: "Yearly",
        proRataForJoiners: false,
        carryForwardCapHalfDays: 0,
        lapseOn: "03-31",
        encashableHalfDaysPerYear: 0,
        sandwichRule: false,
        isActive: true,
        createdAt,
      },
    ])
    .onConflictDoNothing();

  // Entitlement for everyone, for this year — written straight to the
  // ledger, not through the accrual engine: seed code runs standalone
  // (`tsx`, outside any bundler), and the engines are guarded with
  // "server-only" the way every engine in this codebase is, so seeding
  // stays plain SQL the way every other table here is seeded. The monthly
  // and year-end jobs (`leave-policy.ts`) take over from here.
  const employees = await db.select().from(s.paEmployee);
  for (const e of employees) {
    for (const grant of [
      { code: "ANNUAL", halfDays: 36 },
      { code: "SICK", halfDays: 24 },
      { code: "CASUAL", halfDays: 12 },
    ]) {
      const already = await rawClient().execute({
        sql: "SELECT 1 FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = ? AND year = ? AND ref_type = 'seed' LIMIT 1",
        args: [e.id, grant.code, year],
      });
      if (already.rows.length > 0) continue;

      await rawClient().execute({
        sql: `INSERT INTO pt_quota_ledger (employee_id, quota_type_code, year, entry_type, half_days, note, ref_type, ref_id, created_by, created_at)
              VALUES (?, ?, ?, 'Accrual', ?, 'Seeded entitlement', 'seed', ?, 'seed', ?)`,
        args: [e.id, grant.code, year, grant.halfDays, `${grant.code}:${year}`, createdAt],
      });
      await rawClient().execute({
        sql: `INSERT INTO pt_it2006_absence_quota (employee_id, quota_type_code, year, entitled_half_days, used_half_days, created_at)
              VALUES (?, ?, ?, ?, 0, ?)
              ON CONFLICT (employee_id, quota_type_code, year)
              DO UPDATE SET entitled_half_days = entitled_half_days + excluded.entitled_half_days`,
        args: [e.id, grant.code, year, grant.halfDays, createdAt],
      });
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

  notes.push("  3 quota types, 7 absence types, 3 attendance types");
  notes.push("  3 holiday calendars (National, Karnataka, Maharashtra), 14 holidays and 3 optional ones each (take any 2); the head office and the factory each on their own");
  notes.push("  3 leave policies (annual, sick, casual), each seeded as its own ledger entry");
  notes.push(`  entitlement for ${employees.length} employees in ${year}`);
  notes.push("  1 pending leave request awaiting a manager");
  return notes;
}
