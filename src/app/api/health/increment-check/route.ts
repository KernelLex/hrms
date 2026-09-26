import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import {
  pmAppraisalCycle,
  pmAppraisal,
  pmCalibration,
  pmIncrementRecommendation,
  OPEN_ENDED,
} from "@/db/schema";
import { readAsOf, readHistory, SLICED_TABLES } from "@/lib/engines/timeslice";
import { formatINR } from "@/lib/money";

/**
 * Temporary harness for the increment push.
 *
 * Builds a throwaway employee, cycle, appraisal and calibration, drives the
 * whole chain to a pushed increment, and checks that basic pay ends up with
 * two records rather than one overwritten one. Removes everything afterwards.
 */
export const dynamic = "force-dynamic";

type Check = { name: string; pass: boolean; detail: string };

export async function GET() {
  const client = rawClient();
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  let employeeId: number | undefined;
  let cycleId: number | undefined;

  try {
    const stamp = Date.now();

    const created = await client.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
      args: [`ZZINC${stamp}`, new Date().toISOString()],
    });
    employeeId = created.rows[0].id as number;

    // One open-ended basic pay record of ₹60,000.
    await client.execute({
      sql: `INSERT INTO pa_it0008_basic_pay
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?, '2024-01-01', ?, 1, 'increment-check', ?,
             'Monthly salaried', 'Bengaluru', 'L2', 6000000, 'INR')`,
      args: [employeeId, OPEN_ENDED, new Date().toISOString()],
    });

    const [cycle] = await db
      .insert(pmAppraisalCycle)
      .values({
        name: `ZZ increment check ${stamp}`,
        periodLabel: "check",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        templateCode: "STANDARD",
        status: "Active",
        createdAt: new Date().toISOString(),
      })
      .returning({ id: pmAppraisalCycle.id });
    cycleId = cycle.id;

    const [appraisal] = await db
      .insert(pmAppraisal)
      .values({
        cycleId,
        employeeId,
        selfRating: 4,
        managerRating: 4,
        status: "Completed",
        updatedAt: new Date().toISOString(),
      })
      .returning({ id: pmAppraisal.id });

    await db.insert(pmCalibration).values({
      appraisalId: appraisal.id,
      calibratedRating: 4,
      status: "Finalised",
      finalisedBy: "increment-check",
      finalisedAt: new Date().toISOString(),
    });

    /* ---- generate ---- */
    const effectiveDate = "2026-04-01";
    const genForm = new FormData();
    genForm.set("cycleId", String(cycleId));
    genForm.set("effectiveDate", effectiveDate);
    const { generateIncrements, approveIncrement, pushIncrementsToPayroll } = await import(
      "@/app/actions/performance"
    );
    const gen = await generateIncrements({}, genForm);

    let rec = await db.query.pmIncrementRecommendation.findFirst({
      where: and(
        eq(pmIncrementRecommendation.cycleId, cycleId),
        eq(pmIncrementRecommendation.employeeId, employeeId),
      ),
    });

    add(
      "a finalised rating produces a draft increment",
      gen.ok === true && Boolean(rec) && rec!.status === "Draft",
      rec
        ? `rating ${rec.finalRating} -> ${(rec.incrementBasisPoints / 100).toFixed(1)}% on ${formatINR(rec.currentSalaryPaise)}`
        : (gen.error ?? "no recommendation created"),
    );

    add(
      "the new salary is the increment applied to the current one",
      Boolean(rec) &&
        rec!.newSalaryPaise ===
          rec!.currentSalaryPaise +
            Math.round((rec!.currentSalaryPaise * rec!.incrementBasisPoints) / 10_000),
      rec ? `${formatINR(rec.currentSalaryPaise)} -> ${formatINR(rec.newSalaryPaise)}` : "n/a",
    );

    /* ---- pushing before approval must be refused ---- */
    const earlyPush = new FormData();
    earlyPush.set("cycleId", String(cycleId));
    const early = await pushIncrementsToPayroll({}, earlyPush);
    add(
      "a draft increment cannot be pushed",
      early.ok !== true,
      early.error ?? "the push was allowed",
    );

    /* ---- approve then push ---- */
    const approveForm = new FormData();
    approveForm.set("id", String(rec!.id));
    await approveIncrement({}, approveForm);

    const pushForm = new FormData();
    pushForm.set("cycleId", String(cycleId));
    const pushed = await pushIncrementsToPayroll({}, pushForm);

    rec = await db.query.pmIncrementRecommendation.findFirst({
      where: eq(pmIncrementRecommendation.id, rec!.id),
    });
    add(
      "an approved increment pushes",
      pushed.ok === true && rec?.status === "Pushed",
      pushed.error ?? `status ${rec?.status}`,
    );

    /* ---- the history is what matters ---- */
    const history = await readHistory<Record<string, string | number>>(
      SLICED_TABLES.basicPay,
      employeeId,
    );
    const older = history.find((h) => h.valid_from === "2024-01-01");
    const newer = history.find((h) => h.valid_from === effectiveDate);

    add(
      "basic pay now has two records, not one overwritten",
      history.length === 2 && Boolean(older) && Boolean(newer),
      `${history.length} records: ${history.map((h) => `${h.valid_from}..${h.valid_to}`).join(" | ")}`,
    );

    add(
      "the old salary was delimited, not destroyed",
      older?.valid_to === "2026-03-31" && Number(older?.amount_paise) === 6_000_000,
      older ? `${formatINR(Number(older.amount_paise))} ends ${older.valid_to}` : "missing",
    );

    const before = await readAsOf<{ amount_paise: number }>(
      SLICED_TABLES.basicPay,
      employeeId,
      "2026-01-15",
    );
    const after = await readAsOf<{ amount_paise: number }>(
      SLICED_TABLES.basicPay,
      employeeId,
      "2026-06-15",
    );
    add(
      "payroll reads the old figure before the date and the new one after",
      Number(before?.amount_paise) === 6_000_000 &&
        Number(after?.amount_paise) === rec!.newSalaryPaise,
      `Jan 2026 ${formatINR(Number(before?.amount_paise))}, Jun 2026 ${formatINR(Number(after?.amount_paise))}`,
    );

    add(
      "the new record records where it came from",
      typeof newer?.source_ref === "string" && newer.source_ref.includes("Increment"),
      String(newer?.source_ref ?? "no source recorded"),
    );

    /* ---- pushing twice must not double-apply ---- */
    const again = await pushIncrementsToPayroll({}, pushForm);
    const afterSecond = await readHistory(SLICED_TABLES.basicPay, employeeId);
    add(
      "pushing again does nothing",
      again.ok !== true && afterSecond.length === 2,
      `${again.error ?? "allowed"}, ${afterSecond.length} records`,
    );
  } catch (err) {
    add("chain threw", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (cycleId) {
      await client.execute({ sql: "DELETE FROM pm_appraisal_cycle WHERE id = ?", args: [cycleId] });
    }
    if (employeeId) {
      await client.execute({ sql: "DELETE FROM pa_employee WHERE id = ?", args: [employeeId] });
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  );
}
