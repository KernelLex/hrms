/**
 * The demo organisation, as a function, so both the `db:seed` script and the
 * test runner's fresh database are built from exactly the same data.
 *
 * The data mirrors the reference mockups in `HR MODULE/` so the screens have
 * recognisable content: Acme Manufacturing, an IT department, and the three
 * positions the org chart draws — one of them vacant, which is what
 * recruitment opens a requisition against later.
 *
 * Safe to re-run: every insert is an upsert on the primary key.
 */
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { ADOPT_PENDING_LEAVE } from "../../lib/workflow/adopt";
import { seedSandboxClients } from "../../lib/api/sandbox";
import bcrypt from "bcryptjs";
import * as s from "../schema";
import { seedPersonnel } from "./personnel";
import { seedTime } from "./time";
import { seedPayroll } from "./payroll";
import { seedStatutory } from "./statutory";
import { seedCorrections } from "./corrections";
import { seedRecruitment } from "./recruitment";
import { seedPerformance } from "./performance";
import { seedTraining } from "./training";
import { seedLifecycle } from "./lifecycle";
import { seedHeadcount } from "./headcount";
import { seedImports } from "./imports";
import { seedAttendance } from "./attendance";
import { seedLoansAndClaims } from "./loans";

const OPEN = s.OPEN_ENDED;
export const DEMO_PASSWORD = "demo1234";

export async function seedDatabase(client: Client): Promise<string[]> {
  // SQLite leaves foreign keys off by default; this schema depends on them.
  await client.execute("PRAGMA foreign_keys = ON");
  const fk = await client.execute("PRAGMA foreign_keys");
  if (fk.rows[0]?.["foreign_keys"] !== 1) {
    throw new Error("Foreign key enforcement could not be enabled.");
  }

  const db = drizzle(client, { schema: s });

  /* ------------------------------------------------------------- org */

  await db
    .insert(s.omCompany)
    .values([
      {
        code: "CO01",
        name: "Acme Manufacturing Pvt Ltd",
        address: "Plot 12, Industrial Area",
        city: "Bengaluru",
        country: "India",
        isActive: true,
      },
      {
        code: "CO02",
        name: "Acme Retail Pvt Ltd",
        address: "5th Cross, MG Road",
        city: "Mumbai",
        country: "India",
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omPersonnelArea)
    .values([
      { code: "PA01", companyCode: "CO01", name: "Head office", location: "Bengaluru campus", isActive: true },
      { code: "PA02", companyCode: "CO01", name: "Factory unit 1", location: "Hosur plant", isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omPersonnelSubArea)
    .values([
      { code: "PSA01", areaCode: "PA02", name: "Day shift", isActive: true },
      { code: "PSA02", areaCode: "PA02", name: "Night shift", isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omJob)
    .values([
      { code: "JB0001", title: "Software engineer", jobGroup: "IT", description: "Develops and maintains applications", isActive: true },
      { code: "JB0002", title: "HR executive", jobGroup: "HR", description: "Handles recruitment and employee relations", isActive: true },
    ])
    .onConflictDoNothing();

  // Parents must land before children — the tree is self-referencing.
  await db
    .insert(s.omOrgUnit)
    .values([
      { code: "OU0001", name: "Information technology", parentCode: null, companyCode: "CO01", areaCode: "PA01", validFrom: "2024-01-01", validTo: OPEN, isActive: true },
      { code: "OU0003", name: "Human resources", parentCode: null, companyCode: "CO01", areaCode: "PA01", validFrom: "2024-01-01", validTo: OPEN, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omOrgUnit)
    .values([
      { code: "OU0002", name: "Application development", parentCode: "OU0001", companyCode: "CO01", areaCode: "PA01", validFrom: "2024-01-01", validTo: OPEN, isActive: true },
    ])
    .onConflictDoNothing();

  // Likewise for positions — a reporting line points at another position.
  await db
    .insert(s.omPosition)
    .values([
      { code: "PS0001", title: "IT manager", orgUnitCode: "OU0001", jobCode: "JB0001", reportsToCode: null, isManager: true, isVacant: false, validFrom: "2024-01-01", validTo: OPEN, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omPosition)
    .values([
      { code: "PS0002", title: "Senior software engineer", orgUnitCode: "OU0002", jobCode: "JB0001", reportsToCode: "PS0001", isManager: false, isVacant: false, validFrom: "2024-01-01", validTo: OPEN, isActive: true },
      { code: "PS0004", title: "HR executive", orgUnitCode: "OU0003", jobCode: "JB0002", reportsToCode: "PS0001", isManager: false, isVacant: true, validFrom: "2024-01-01", validTo: OPEN, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omPosition)
    .values([
      { code: "PS0003", title: "Software engineer", orgUnitCode: "OU0002", jobCode: "JB0001", reportsToCode: "PS0002", isManager: false, isVacant: true, validFrom: "2024-03-01", validTo: OPEN, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.omReportingLine)
    .values([
      { positionCode: "PS0002", reportsToCode: "PS0001", effectiveFrom: "2024-01-01", remarks: "Initial assignment" },
      { positionCode: "PS0003", reportsToCode: "PS0002", effectiveFrom: "2024-03-01", remarks: "Initial assignment" },
    ])
    .onConflictDoNothing();

  /* -------------------------------------------------------- security */

  await db
    .insert(s.secRole)
    .values([
      { code: "HR_ADMIN", name: "HR administrator" },
      { code: "MANAGER", name: "Manager" },
      { code: "EMPLOYEE", name: "Employee" },
    ])
    .onConflictDoNothing();

  // A role HR created, to show one: hiring, with no view of pay. The
  // built-in roles and their permissions come from migration 0008.
  await db
    .insert(s.secRole)
    .values({
      code: "RECRUITER",
      name: "Recruiter",
      description: "Runs hiring: requisitions, candidates, the pipeline and interviews. Sees no pay.",
      isBuiltIn: false,
    })
    .onConflictDoNothing();
  await db
    .insert(s.secRolePermission)
    .values([
      { roleCode: "RECRUITER", permissionCode: "recruitment.manage" },
      { roleCode: "RECRUITER", permissionCode: "recruitment.interview" },
    ])
    .onConflictDoNothing();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const createdAt = s.now();

  const users = [
    { username: "hr.admin", displayName: "Priya Sharma", roles: ["HR_ADMIN"] },
    { username: "ravi.kumar", displayName: "Ravi Kumar", roles: ["MANAGER", "EMPLOYEE"] },
    { username: "arjun.mehta", displayName: "Arjun Mehta", roles: ["EMPLOYEE"] },
    { username: "neha.iyer", displayName: "Neha Iyer", roles: ["RECRUITER"] },
  ] as const;

  for (const u of users) {
    await db
      .insert(s.secAppUser)
      .values({
        username: u.username,
        passwordHash,
        displayName: u.displayName,
        employeeId: null,
        isActive: true,
        createdAt,
      })
      .onConflictDoNothing();

    const row = await db.query.secAppUser.findFirst({
      where: (t, { eq }) => eq(t.username, u.username),
    });
    if (!row) throw new Error(`User ${u.username} was not created.`);

    await db
      .insert(s.secUserRole)
      .values(u.roles.map((roleCode) => ({ userId: row.id, roleCode })))
      .onConflictDoNothing();
  }

  // Core HR depends on the org structure and the users above.
  const personnelNotes = await seedPersonnel(db);
  const timeNotes = await seedTime(db);
  const payrollNotes = await seedPayroll(db);
  const statutoryNotes = await seedStatutory(db);
  const loanNotes = await seedLoansAndClaims(db);
  const recruitmentNotes = await seedRecruitment(db);
  const performanceNotes = await seedPerformance(db);
  const trainingNotes = await seedTraining(db);

  // Pending leave goes onto the approval engine, as migration 0008 does for
  // requests that existed before it.
  for (const sql of ADOPT_PENDING_LEAVE) await client.execute(sql);
  const correctionNotes = await seedCorrections(client);
  const lifecycleNotes = await seedLifecycle(client);
  const headcountNotes = await seedHeadcount(client);
  const importNotes = await seedImports(client);
  const attendanceNotes = await seedAttendance(client);

  // Integration sandbox: known API credentials, only where asked for.
  const sandboxSecret = process.env.SANDBOX_CLIENT_SECRET?.trim();
  const sandboxNotes = sandboxSecret ? await seedSandboxClients(client, sandboxSecret) : [];

  return [
    "  2 companies, 2 personnel areas, 2 sub-areas, 2 jobs",
    "  3 org units, 4 positions, 2 reporting lines",
    `  4 users, all with password ${DEMO_PASSWORD}, one a recruiter who sees no pay`,
    ...personnelNotes,
    ...timeNotes,
    ...payrollNotes,
    ...statutoryNotes,
    ...loanNotes,
    ...recruitmentNotes,
    ...performanceNotes,
    ...trainingNotes,
    ...correctionNotes,
    ...lifecycleNotes,
    ...headcountNotes,
    ...importNotes,
    ...attendanceNotes,
    ...sandboxNotes,
  ];
}
