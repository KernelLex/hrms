import { NextResponse } from "next/server";
import { rawClient } from "@/lib/db";
import {
  saveTimeSlice,
  readAsOf,
  readHistory,
  deleteTimeSlice,
  SLICED_TABLES,
} from "@/lib/engines/timeslice";

/**
 * Temporary harness for the time-slice engine.
 *
 * Runs all four delimiting cases against a throwaway employee and deletes it
 * afterwards. Exists only to prove the engine before the modules that depend
 * on it are built; remove once there is a real test runner.
 */
export const dynamic = "force-dynamic";

type Check = { name: string; pass: boolean; detail: string };

export async function GET() {
  const client = rawClient();
  const checks: Check[] = [];
  let employeeId: number | undefined;

  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  try {
    const created = await client.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
      args: [`ZZTEST${Date.now()}`, new Date().toISOString()],
    });
    employeeId = created.rows[0].id as number;

    const pay = (amount: number, from: string, to?: string) =>
      saveTimeSlice({
        table: SLICED_TABLES.basicPay,
        employeeId: employeeId!,
        validFrom: from,
        validTo: to,
        data: {
          pay_scale_type: "Monthly salaried",
          pay_scale_area: null,
          pay_scale_group: "L1",
          amount_paise: amount,
          currency: "INR",
        },
        createdBy: "timeslice-check",
      });

    // 1. An open-ended record, then a later one — the first must be delimited.
    await pay(1_000_000, "2020-01-01");
    await pay(2_000_000, "2022-01-01");

    let history = await readHistory<Record<string, string | number>>(
      SLICED_TABLES.basicPay,
      employeeId,
    );
    const first = history.find((h) => h.valid_from === "2020-01-01");
    add(
      "predecessor delimited on later insert",
      first?.valid_to === "2021-12-31",
      `first slice ends ${first?.valid_to}`,
    );

    // 2. Reading a past date returns what was true then, not now.
    const old = await readAsOf<Record<string, number>>(
      SLICED_TABLES.basicPay,
      employeeId,
      "2021-06-01",
    );
    const current = await readAsOf<Record<string, number>>(
      SLICED_TABLES.basicPay,
      employeeId,
      "2023-06-01",
    );
    add(
      "as-of read returns the historical value",
      Number(old?.amount_paise) === 1_000_000 && Number(current?.amount_paise) === 2_000_000,
      `2021 -> ${old?.amount_paise}, 2023 -> ${current?.amount_paise}`,
    );

    // 3. Case 4 — a short correction inside an open-ended record must leave
    //    the later period intact rather than swallowing it.
    await pay(9_900_000, "2023-03-01", "2023-03-31");
    history = await readHistory<Record<string, string | number>>(
      SLICED_TABLES.basicPay,
      employeeId,
    );
    const before = history.find((h) => h.valid_from === "2022-01-01");
    const inserted = history.find((h) => h.valid_from === "2023-03-01");
    const after = history.find((h) => h.valid_from === "2023-04-01");
    add(
      "straddling insert splits the record in three",
      before?.valid_to === "2023-02-28" &&
        inserted?.valid_to === "2023-03-31" &&
        Number(after?.amount_paise) === 2_000_000 &&
        after?.valid_to === "9999-12-31",
      `${before?.valid_from}..${before?.valid_to} | ${inserted?.valid_from}..${inserted?.valid_to} | ${after?.valid_from}..${after?.valid_to}`,
    );

    // 4. The tail after a split must carry the original amount, not the new one.
    const afterCorrection = await readAsOf<Record<string, number>>(
      SLICED_TABLES.basicPay,
      employeeId,
      "2023-06-01",
    );
    add(
      "period after a correction keeps its own value",
      Number(afterCorrection?.amount_paise) === 2_000_000,
      `reads ${afterCorrection?.amount_paise}`,
    );

    // 5. Deleting a slice heals the gap instead of leaving a hole.
    if (inserted) {
      await deleteTimeSlice(SLICED_TABLES.basicPay, Number(inserted.id));
      const healed = await readAsOf<Record<string, string>>(
        SLICED_TABLES.basicPay,
        employeeId,
        "2023-03-15",
      );
      add(
        "delete extends the predecessor over the gap",
        healed !== undefined && healed.valid_from === "2022-01-01",
        healed ? `covered by slice from ${healed.valid_from}` : "gap left in history",
      );
    }

    // 6. No two slices may overlap.
    history = await readHistory<Record<string, string>>(SLICED_TABLES.basicPay, employeeId);
    const sorted = [...history].sort((a, b) => (a.valid_from < b.valid_from ? -1 : 1));
    let overlap = false;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].valid_from <= sorted[i - 1].valid_to) overlap = true;
    }
    add("no overlapping slices remain", !overlap, `${sorted.length} slices`);
  } catch (err) {
    add("engine threw", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (employeeId) {
      await client.execute({
        sql: "DELETE FROM pa_employee WHERE id = ?",
        args: [employeeId],
      });
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  );
}
