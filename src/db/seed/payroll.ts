import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * Wage types, tax slabs and an open payroll period.
 *
 * The slab figures are the Indian rates for FY 2025-26, stored as data so a
 * rate change is a row edit. Rates are basis points; amounts are paise.
 */
export async function seedPayroll(db: Db): Promise<string[]> {
  const notes: string[] = [];

  await db
    .insert(s.pyWageType)
    .values([
      { code: "BASIC", name: "Basic salary", kind: "Earning", amountType: "Fixed", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: null, isTaxable: true, isAutomatic: true, glAccount: "5010", sortOrder: 10, isActive: true },
      { code: "HRA", name: "House rent allowance", kind: "Earning", amountType: "PercentOfBasic", percentBasisPoints: 4000, fixedAmountPaise: null, formulaKey: null, isTaxable: true, isAutomatic: true, glAccount: "5010", sortOrder: 20, isActive: true },
      { code: "CONV", name: "Conveyance allowance", kind: "Earning", amountType: "PercentOfBasic", percentBasisPoints: 1000, fixedAmountPaise: null, formulaKey: null, isTaxable: true, isAutomatic: true, glAccount: "5010", sortOrder: 30, isActive: true },
      { code: "SPECIAL", name: "Special allowance", kind: "Earning", amountType: "Fixed", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: null, isTaxable: true, isAutomatic: false, glAccount: "5010", sortOrder: 40, isActive: true },
      { code: "BONUS", name: "Performance bonus", kind: "Earning", amountType: "Fixed", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: null, isTaxable: true, isAutomatic: false, glAccount: "5010", sortOrder: 50, isActive: true },
      { code: "REIMB", name: "Travel reimbursement", kind: "Earning", amountType: "Fixed", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: null, isTaxable: false, isAutomatic: false, glAccount: "5020", sortOrder: 60, isActive: true },
      { code: "PF", name: "Provident fund", kind: "Deduction", amountType: "PercentOfBasic", percentBasisPoints: 1200, fixedAmountPaise: null, formulaKey: "PF", isTaxable: false, isAutomatic: true, glAccount: "2120", sortOrder: 110, isActive: true },
      { code: "TDS", name: "Income tax (TDS)", kind: "Deduction", amountType: "Formula", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: "TDS", isTaxable: false, isAutomatic: true, glAccount: "2130", sortOrder: 120, isActive: true },
      { code: "LOAN", name: "Loan repayment", kind: "Deduction", amountType: "Fixed", percentBasisPoints: null, fixedAmountPaise: null, formulaKey: null, isTaxable: false, isAutomatic: false, glAccount: "1310", sortOrder: 130, isActive: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.tdsSectionMaster)
    .values([
      { code: "192", description: "TDS on salary income (slab based)", rateBasisPoints: null, isSlabBased: true, thresholdPaise: 25_000_000, applicableTo: "Employee", isActive: true },
      { code: "194J", description: "Professional or technical fees", rateBasisPoints: 1000, isSlabBased: false, thresholdPaise: 3_000_000, applicableTo: "Vendor", isActive: true },
      { code: "194C", description: "Contractor payments", rateBasisPoints: 100, isSlabBased: false, thresholdPaise: 3_000_000, applicableTo: "Vendor", isActive: true },
    ])
    .onConflictDoNothing();

  const fy = "2025-26";
  const existingSlabs = await db.select().from(s.tdsTaxSlab);
  if (existingSlabs.length === 0) {
    await db.insert(s.tdsTaxSlab).values([
      // New regime, FY 2025-26
      { regime: "New", financialYear: fy, fromPaise: 0, toPaise: 40_000_000, rateBasisPoints: 0 },
      { regime: "New", financialYear: fy, fromPaise: 40_000_000, toPaise: 80_000_000, rateBasisPoints: 500 },
      { regime: "New", financialYear: fy, fromPaise: 80_000_000, toPaise: 120_000_000, rateBasisPoints: 1000 },
      { regime: "New", financialYear: fy, fromPaise: 120_000_000, toPaise: 160_000_000, rateBasisPoints: 1500 },
      { regime: "New", financialYear: fy, fromPaise: 160_000_000, toPaise: 200_000_000, rateBasisPoints: 2000 },
      { regime: "New", financialYear: fy, fromPaise: 200_000_000, toPaise: 240_000_000, rateBasisPoints: 2500 },
      { regime: "New", financialYear: fy, fromPaise: 240_000_000, toPaise: null, rateBasisPoints: 3000 },
      // Old regime, FY 2025-26
      { regime: "Old", financialYear: fy, fromPaise: 0, toPaise: 25_000_000, rateBasisPoints: 0 },
      { regime: "Old", financialYear: fy, fromPaise: 25_000_000, toPaise: 50_000_000, rateBasisPoints: 500 },
      { regime: "Old", financialYear: fy, fromPaise: 50_000_000, toPaise: 100_000_000, rateBasisPoints: 2000 },
      { regime: "Old", financialYear: fy, fromPaise: 100_000_000, toPaise: null, rateBasisPoints: 3000 },
    ]);
  }

  // The same slabs for the current financial year, so a run today has rates.
  const today = new Date().toISOString().slice(0, 10);
  const currentFy = (() => {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const start = month >= 4 ? year : year - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  })();

  if (currentFy !== fy) {
    const already = await db.select().from(s.tdsTaxSlab);
    if (!already.some((r) => r.financialYear === currentFy)) {
      const base = already.filter((r) => r.financialYear === fy);
      if (base.length > 0) {
        await db.insert(s.tdsTaxSlab).values(
          base.map((r) => ({
            regime: r.regime,
            financialYear: currentFy,
            fromPaise: r.fromPaise,
            toPaise: r.toPaise,
            rateBasisPoints: r.rateBasisPoints,
          })),
        );
      }
    }
  }

  // An open period for the current month, for each personnel area.
  const areas = await db.select().from(s.omPersonnelArea);
  const nowDate = new Date();
  for (const a of areas) {
    await db
      .insert(s.pyPayrollPeriod)
      .values({
        areaCode: a.code,
        year: nowDate.getUTCFullYear(),
        month: nowDate.getUTCMonth() + 1,
        payDate: null,
        status: "Open",
        releasedBy: null,
        releasedAt: null,
        postedAt: null,
      })
      .onConflictDoNothing();
  }

  notes.push("  9 wage types, 3 TDS sections");
  notes.push(`  tax slabs for ${fy}${currentFy !== fy ? ` and ${currentFy}` : ""}, both regimes`);
  notes.push(`  open payroll period for ${areas.length} personnel areas`);
  return notes;
}
