/**
 * Seeds the demo organisation. Run with `npm run db:seed`.
 *
 * The data mirrors the reference mockups in `HR MODULE/` so the screens have
 * recognisable content: Acme Manufacturing, an IT department, and the three
 * positions the org chart draws — one of them vacant, which is what
 * recruitment opens a requisition against later.
 *
 * Safe to re-run: every insert is an upsert on the primary key.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import { loadEnv } from "../load-env";
import * as s from "../schema";

loadEnv();

const OPEN = s.OPEN_ENDED;
const DEMO_PASSWORD = "demo1234";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set.");

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

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

  // Parents must land before children — the tree is self-referencing.
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

  // Likewise for positions — a reporting line points at another position.
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

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const createdAt = s.now();

  const users = [
    { username: "hr.admin", displayName: "Priya Sharma", roles: ["HR_ADMIN"] },
    { username: "ravi.kumar", displayName: "Ravi Kumar", roles: ["MANAGER", "EMPLOYEE"] },
    { username: "arjun.mehta", displayName: "Arjun Mehta", roles: ["EMPLOYEE"] },
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

  console.log("Seeded:");
  console.log("  2 companies, 2 personnel areas, 2 sub-areas, 2 jobs");
  console.log("  3 org units, 4 positions (2 vacant), 2 reporting lines");
  console.log(`  3 users, all with password ${DEMO_PASSWORD}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
