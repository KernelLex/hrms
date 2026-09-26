import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

const OPEN = s.OPEN_ENDED;
const BY = "seed";

/**
 * Three employees with real infotype history.
 *
 * Arjun deliberately has two basic-pay slices — 65,000 until March 2025 and
 * 72,000 after — so the as-of-date viewer (CH-03) has something truthful to
 * demonstrate rather than a single row that looks the same on every date.
 */
export async function seedPersonnel(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();

  await db
    .insert(s.ptWorkScheduleRule)
    .values([
      { code: "WS01", name: "General 9-6 (Mon-Fri)", weeklyHours: 40, workingDays: "Mon-Fri", isActive: true },
      { code: "WS02", name: "Shift A (rotating)", weeklyHours: 40, workingDays: "Mon-Sat, rotating", isActive: true },
      { code: "WS03", name: "Shift B (night)", weeklyHours: 40, workingDays: "Mon-Sat, night", isActive: true },
    ])
    .onConflictDoNothing();

  const people = [
    {
      employeeNumber: "EMP1000",
      hireDate: "2021-06-10",
      first: "Ravi",
      last: "Kumar",
      dob: "1985-02-14",
      gender: "Male",
      marital: "Married",
      position: "PS0001",
      orgUnit: "OU0001",
      costCenter: "CC-IT-01",
      payGroup: "M2",
      payPaise: 12_000_000,
      bank: { bankName: "HDFC Bank", accountNumber: "XXXXXXXX9001", ifsc: "HDFC0001234" },
      email: "ravi.kumar@acme.com",
      phone: "+91 98450 11111",
      username: "ravi.kumar",
    },
    {
      employeeNumber: "EMP1001",
      hireDate: "2024-01-15",
      first: "Arjun",
      last: "Mehta",
      dob: "1993-08-21",
      gender: "Male",
      marital: "Single",
      position: "PS0002",
      orgUnit: "OU0002",
      costCenter: "CC-IT-01",
      payGroup: "L3",
      payPaise: 7_200_000,
      bank: { bankName: "HDFC Bank", accountNumber: "XXXXXXXX1234", ifsc: "HDFC0001234" },
      email: "arjun.mehta@acme.com",
      phone: "+91 98450 12345",
      username: "arjun.mehta",
    },
    {
      employeeNumber: "EMP1002",
      hireDate: "2024-03-01",
      first: "Sneha",
      last: "Rao",
      dob: "1996-11-05",
      gender: "Female",
      marital: "Single",
      position: "PS0003",
      orgUnit: "OU0002",
      costCenter: "CC-IT-01",
      payGroup: "L2",
      payPaise: 5_800_000,
      bank: { bankName: "ICICI Bank", accountNumber: "XXXXXXXX5678", ifsc: "ICIC0005678" },
      email: "sneha.rao@acme.com",
      phone: "+91 98450 22222",
      username: null,
    },
  ] as const;

  for (const p of people) {
    await db
      .insert(s.paEmployee)
      .values({
        employeeNumber: p.employeeNumber,
        hireDate: p.hireDate,
        employmentStatus: "Active",
        terminationDate: null,
        createdAt,
      })
      .onConflictDoNothing();

    const emp = await db.query.paEmployee.findFirst({
      where: eq(s.paEmployee.employeeNumber, p.employeeNumber),
    });
    if (!emp) throw new Error(`Employee ${p.employeeNumber} was not created.`);

    const common = {
      employeeId: emp.id,
      validFrom: p.hireDate,
      validTo: OPEN,
      seq: 1,
      createdBy: BY,
      createdAt,
    };

    await db
      .insert(s.paAction)
      .values({ ...common, actionType: "Hire", reason: "New position" })
      .onConflictDoNothing();

    await db
      .insert(s.paOrgAssignment)
      .values({
        ...common,
        companyCode: "CO01",
        areaCode: "PA01",
        subAreaCode: null,
        orgUnitCode: p.orgUnit,
        positionCode: p.position,
        costCenter: p.costCenter,
      })
      .onConflictDoNothing();

    await db
      .insert(s.paPersonalData)
      .values({
        ...common,
        firstName: p.first,
        lastName: p.last,
        dateOfBirth: p.dob,
        gender: p.gender,
        maritalStatus: p.marital,
        nationality: "Indian",
      })
      .onConflictDoNothing();

    await db
      .insert(s.paPlannedWorkingTime)
      .values({ ...common, workScheduleCode: "WS01", weeklyHours: 40, employmentPercent: 100 })
      .onConflictDoNothing();

    await db
      .insert(s.paBankDetails)
      .values({
        ...common,
        bankName: p.bank.bankName,
        accountNumber: p.bank.accountNumber,
        ifsc: p.bank.ifsc,
        holderName: `${p.first} ${p.last}`,
      })
      .onConflictDoNothing();

    await db
      .insert(s.paCommunication)
      .values([
        { ...common, commType: "Email (official)", value: p.email, seq: 1 },
        { ...common, commType: "Mobile phone", value: p.phone, seq: 2 },
      ])
      .onConflictDoNothing();

    // Basic pay: Arjun gets two slices, everyone else one.
    if (p.employeeNumber === "EMP1001") {
      await db
        .insert(s.paBasicPay)
        .values([
          {
            employeeId: emp.id,
            validFrom: p.hireDate,
            validTo: "2025-03-31",
            seq: 1,
            createdBy: BY,
            createdAt,
            payScaleType: "Monthly salaried",
            payScaleArea: "Bengaluru",
            payScaleGroup: "L2",
            amountPaise: 6_500_000,
            currency: "INR",
            sourceRef: null,
          },
          {
            employeeId: emp.id,
            validFrom: "2025-04-01",
            validTo: OPEN,
            seq: 1,
            createdBy: BY,
            createdAt,
            payScaleType: "Monthly salaried",
            payScaleArea: "Bengaluru",
            payScaleGroup: "L3",
            amountPaise: 7_200_000,
            currency: "INR",
            sourceRef: "Annual increment 2025",
          },
        ])
        .onConflictDoNothing();
    } else {
      await db
        .insert(s.paBasicPay)
        .values({
          ...common,
          payScaleType: "Monthly salaried",
          payScaleArea: "Bengaluru",
          payScaleGroup: p.payGroup,
          amountPaise: p.payPaise,
          currency: "INR",
          sourceRef: null,
        })
        .onConflictDoNothing();
    }

    // The chair is taken.
    await db
      .update(s.omPosition)
      .set({ isVacant: false })
      .where(eq(s.omPosition.code, p.position));

    // Link the sign-in account to the person.
    if (p.username) {
      await db
        .update(s.secAppUser)
        .set({ employeeId: emp.id })
        .where(eq(s.secAppUser.username, p.username));
    }
  }

  const arjun = await db.query.paEmployee.findFirst({
    where: eq(s.paEmployee.employeeNumber, "EMP1001"),
  });
  if (arjun) {
    await db
      .insert(s.paAddress)
      .values({
        employeeId: arjun.id,
        addressType: "Permanent",
        line: "221 Residency Road",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560025",
        country: "India",
        validFrom: "2024-01-15",
        validTo: OPEN,
        seq: 1,
        createdBy: BY,
        createdAt,
      })
      .onConflictDoNothing();

    await db
      .insert(s.paFamilyMember)
      .values({
        employeeId: arjun.id,
        relationship: "Spouse",
        name: "Kavya Mehta",
        dateOfBirth: "1994-06-02",
        validFrom: "2024-01-15",
        validTo: OPEN,
        seq: 1,
        createdBy: BY,
        createdAt,
      })
      .onConflictDoNothing();
  }

  notes.push("  3 work schedule rules");
  notes.push("  3 employees with org assignment, personal data, working time, bank and contact");
  notes.push("  4 basic pay slices (Arjun has two, so as-of-date reads differ)");
  return notes;
}
