import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { seedDatabase } from "@/db/seed";

/**
 * The seed must be safe to run again on a database it has already seeded —
 * every phase since 9 has re-run `npm run db:seed` against the one Turso
 * database rather than a fresh one. It once was not: three repeating
 * infotypes (address, communication, family member) have no unique index,
 * so `.onConflictDoNothing()` guarded nothing and each re-run silently
 * duplicated every row, for years, in production (fixed by migration 0012).
 */
describe("the seed", () => {
  it("adds nothing new to a database it has already seeded", async () => {
    const client = rawClient();
    const count = async (sql: string) => Number((await client.execute(sql)).rows[0].n);
    const before = {
      address: await count("SELECT COUNT(*) AS n FROM pa_it0006_address"),
      communication: await count("SELECT COUNT(*) AS n FROM pa_it0105_communication"),
      family: await count("SELECT COUNT(*) AS n FROM pa_it0021_family_member"),
    };
    expect(before.communication).toBeGreaterThan(0); // the fixture actually seeded something

    await seedDatabase(client);
    await seedDatabase(client);

    expect({
      address: await count("SELECT COUNT(*) AS n FROM pa_it0006_address"),
      communication: await count("SELECT COUNT(*) AS n FROM pa_it0105_communication"),
      family: await count("SELECT COUNT(*) AS n FROM pa_it0021_family_member"),
    }).toEqual(before);

    // Never more than one row per person and type: the actual symptom.
    const grouped = await client.execute(
      "SELECT employee_id, comm_type, COUNT(*) AS n FROM pa_it0105_communication GROUP BY employee_id, comm_type HAVING n > 1",
    );
    expect(grouped.rows).toEqual([]);
  });
});
