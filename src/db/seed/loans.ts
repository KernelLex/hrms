import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * The benchmark rate rule 3(7)(i) compares a concessional loan against, and
 * the claim categories most companies reimburse — fuel and phone exempt up
 * to their limit, LTA exempt the same way, medical taxable now that the
 * 2018 budget folded its old exemption into the standard deduction instead.
 */
export async function seedLoansAndClaims(db: Db): Promise<string[]> {
  const notes: string[] = [];

  const existingRate = await db.select().from(s.pyLoanBenchmarkRate).limit(1);
  if (existingRate.length === 0) {
    await db.insert(s.pyLoanBenchmarkRate).values({ validFrom: "2020-01-01", validTo: s.OPEN_ENDED, rateBasisPoints: 850 }); // SBI's typical benchmark, illustrative
  }

  const categories: { code: string; name: string; isTaxable: boolean; limitRupees: number }[] = [
    { code: "FUEL", name: "Fuel and conveyance", isTaxable: false, limitRupees: 21_600 },
    { code: "PHONE", name: "Phone and internet", isTaxable: false, limitRupees: 12_000 },
    { code: "MEDICAL", name: "Medical", isTaxable: true, limitRupees: 15_000 },
    { code: "LTA", name: "Leave travel allowance", isTaxable: false, limitRupees: 50_000 },
  ];
  const existingCategories = await db.select().from(s.pyClaimCategory).limit(1);
  if (existingCategories.length === 0) {
    await db.insert(s.pyClaimCategory).values(
      categories.map((c) => ({ code: c.code, name: c.name, isTaxable: c.isTaxable, defaultAnnualLimitPaise: c.limitRupees * 100, isActive: true })),
    );
    // Senior grades travel more: a higher LTA limit for M1 and M2.
    await db.insert(s.pyClaimCategoryLimit).values([
      { categoryCode: "LTA", grade: "M1", annualLimitPaise: 75_000 * 100 },
      { categoryCode: "LTA", grade: "M2", annualLimitPaise: 75_000 * 100 },
    ]);
  }

  notes.push("  a loan benchmark rate, and 4 claim categories (fuel, phone, medical, LTA), with a higher LTA limit for M1 and M2");
  return notes;
}
