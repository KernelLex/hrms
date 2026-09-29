import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import { actorOf } from "@/lib/change-log";
import { hire } from "@/lib/services/people";
import {
  completeTask,
  confirmProbationAction,
  endProbationAction,
  extendProbationAction,
  issueLetterAction,
  promoteEmployeeAction,
  saveLetterTemplate,
  transferEmployeeAction,
} from "@/app/actions/lifecycle";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * Joining, moving and letters: a hire starts an onboarding checklist and a
 * probation review by itself; transfers and promotions move someone through
 * the same time-slice engine a hire does; a letter keeps the exact wording
 * it was issued with even after its template changes.
 */

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

async function vacantPosition(orgUnitCode = "OU0002"): Promise<string> {
  const code = `PZ${randomUUID().slice(0, 8).toUpperCase()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, ?, ?, 'JB0001', NULL, 0, 1, '2020-01-01', ?, 1)`,
    args: [code, `Test role ${code}`, orgUnitCode, OPEN_ENDED],
  });
  return code;
}

let hr: Person;

beforeAll(async () => {
  hr = await createPerson({ roles: ["HR_ADMIN"], email: false });
});
afterEach(() => actAs(null));

async function hireInto(positionCode: string, amountPaise = 5_000_000): Promise<number> {
  const r = await hire(
    actorOf(hr.session),
    {
      actionType: "Hire",
      effectiveDate: "2024-01-01",
      reason: null,
      companyCode: "CO01",
      areaCode: "PA01",
      orgUnitCode: "OU0002",
      positionCode,
      costCenter: null,
      firstName: "Test",
      lastName: `Hire${positionCode.slice(-4)}`,
      dateOfBirth: null,
      gender: null,
      payScaleGroup: "L1",
      amountPaise,
      currency: "INR",
      workScheduleCode: "WS01",
    },
    "test",
  );
  if (!r.ok) throw new Error(r.error);
  return r.value.employeeId;
}

async function pendingReviewId(employeeId: number): Promise<number> {
  const row = await one(
    "SELECT id FROM pa_it0019_monitoring WHERE employee_id = ? AND monitoring_type = 'Probation review' AND status = 'Pending'",
    [employeeId],
  );
  return Number(row!.id);
}

describe("onboarding", () => {
  it("starts a checklist and a probation review when someone is hired", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const checklist = await one("SELECT * FROM pa_checklist WHERE employee_id = ? AND event = 'onboarding'", [employeeId]);
    expect(checklist).toBeTruthy();
    const tasks = await rawClient().execute({ sql: "SELECT id FROM pa_task WHERE checklist_id = ?", args: [Number(checklist!.id)] });
    expect(tasks.rows.length).toBeGreaterThan(0);
    const review = await one(
      "SELECT status FROM pa_it0019_monitoring WHERE employee_id = ? AND monitoring_type = 'Probation review'",
      [employeeId],
    );
    expect(review?.status).toBe("Pending");
  });

  it("finishes the checklist once every task in it is done", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const checklist = await one("SELECT * FROM pa_checklist WHERE employee_id = ?", [employeeId]);
    const tasks = await rawClient().execute({ sql: "SELECT id FROM pa_task WHERE checklist_id = ?", args: [Number(checklist!.id)] });

    actAs(hr.session);
    for (const t of tasks.rows) {
      const r = await completeTask({}, form({ id: Number(t.id) }));
      expect(r.ok).toBe(true);
    }
    actAs(null);

    const done = await one("SELECT completed_at FROM pa_checklist WHERE id = ?", [Number(checklist!.id)]);
    expect(done?.completed_at).toBeTruthy();
  });
});

describe("transfer", () => {
  it("moves someone to a new position, department and company, freeing the old position", async () => {
    const fromPos = await vacantPosition();
    const employeeId = await hireInto(fromPos);
    const toPos = await vacantPosition("OU0003");

    actAs(hr.session);
    const r = await transferEmployeeAction(
      {},
      form({ employeeId, effectiveDate: day(1), companyCode: "CO01", orgUnitCode: "OU0003", positionCode: toPos }),
    );
    actAs(null);
    expect(r.ok).toBe(true);

    const assignment = await one(
      "SELECT position_code, org_unit_code FROM pa_it0001_org_assignment WHERE employee_id = ? ORDER BY valid_from DESC LIMIT 1",
      [employeeId],
    );
    expect(assignment).toMatchObject({ position_code: toPos, org_unit_code: "OU0003" });
    expect(Number((await one("SELECT is_vacant FROM om_position WHERE code = ?", [fromPos]))!.is_vacant)).toBe(1);
    expect(Number((await one("SELECT is_vacant FROM om_position WHERE code = ?", [toPos]))!.is_vacant)).toBe(0);
  });

  it("refuses a position that is already filled", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const filled = await vacantPosition();
    await hireInto(filled);

    actAs(hr.session);
    const r = await transferEmployeeAction(
      {},
      form({ employeeId, effectiveDate: day(1), companyCode: "CO01", orgUnitCode: "OU0002", positionCode: filled }),
    );
    actAs(null);
    expect(r.error).toMatch(/already filled/);
  });
});

describe("promotion", () => {
  it("moves position and raises basic pay together, from the effective date", async () => {
    const employeeId = await hireInto(await vacantPosition(), 5_000_000);
    const toPos = await vacantPosition();

    actAs(hr.session);
    const r = await promoteEmployeeAction(
      {},
      form({ employeeId, effectiveDate: day(1), positionCode: toPos, amount: 60000, currency: "INR" }),
    );
    actAs(null);
    expect(r.ok).toBe(true);

    const pay = await one("SELECT amount_paise FROM pa_it0008_basic_pay WHERE employee_id = ? ORDER BY valid_from DESC LIMIT 1", [employeeId]);
    expect(Number(pay!.amount_paise)).toBe(6_000_000);
    const assignment = await one("SELECT position_code FROM pa_it0001_org_assignment WHERE employee_id = ? ORDER BY valid_from DESC LIMIT 1", [employeeId]);
    expect(assignment!.position_code).toBe(toPos);
  });

  it("refuses a salary that is not above the current one", async () => {
    const employeeId = await hireInto(await vacantPosition(), 5_000_000);
    const toPos = await vacantPosition();

    actAs(hr.session);
    const r = await promoteEmployeeAction(
      {},
      form({ employeeId, effectiveDate: day(1), positionCode: toPos, amount: 40000, currency: "INR" }),
    );
    actAs(null);
    expect(r.error).toMatch(/above the current/);
  });
});

describe("probation", () => {
  it("confirms employment", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const id = await pendingReviewId(employeeId);

    actAs(hr.session);
    const r = await confirmProbationAction({}, form({ id, note: "Doing well" }));
    actAs(null);
    expect(r.ok).toBe(true);
    expect((await one("SELECT status FROM pa_it0019_monitoring WHERE id = ?", [id]))?.status).toBe("Confirmed");
  });

  it("extends the review to a new date, keeping the one it replaces on record", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const id = await pendingReviewId(employeeId);

    actAs(hr.session);
    const r = await extendProbationAction({}, form({ id, newDate: day(150) }));
    actAs(null);
    expect(r.ok).toBe(true);
    expect((await one("SELECT status FROM pa_it0019_monitoring WHERE id = ?", [id]))?.status).toBe("Extended");
    expect(await one("SELECT id FROM pa_it0019_monitoring WHERE employee_id = ? AND status = 'Pending'", [employeeId])).toBeTruthy();
  });

  it("ends employment and frees the position", async () => {
    const pos = await vacantPosition();
    const employeeId = await hireInto(pos);
    const id = await pendingReviewId(employeeId);

    actAs(hr.session);
    const r = await endProbationAction({}, form({ id, effectiveDate: day(10), note: "Did not pass probation" }));
    actAs(null);
    expect(r.ok).toBe(true);
    expect((await one("SELECT employment_status FROM pa_employee WHERE id = ?", [employeeId]))?.employment_status).toBe("Terminated");
    expect(Number((await one("SELECT is_vacant FROM om_position WHERE code = ?", [pos]))!.is_vacant)).toBe(1);
  });
});

describe("letters", () => {
  it("merges the template with the record, and keeps the exact wording once a later version is saved", async () => {
    const employeeId = await hireInto(await vacantPosition());
    const kind = `TestLetter${randomUUID().slice(0, 6)}`;

    actAs(hr.session);
    expect((await saveLetterTemplate({}, form({ kind, body: "Dear {{first_name}}, welcome to {{company_name}}." }))).ok).toBe(true);
    const template = await one("SELECT id FROM pa_letter_template WHERE kind = ? AND is_active = 1", [kind]);

    const issued = await issueLetterAction({}, form({ employeeId, templateId: Number(template!.id), issueDate: day(0) }));
    actAs(null);
    expect(issued.ok).toBe(true);

    const letter = await one("SELECT * FROM pa_letter WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employeeId]);
    expect(String(letter!.merged_text)).toContain("Dear Test, welcome to");
    expect(String(letter!.merged_text)).not.toContain("{{");

    actAs(hr.session);
    await saveLetterTemplate({}, form({ kind, body: "This wording changed for {{first_name}}." }));
    actAs(null);
    const unchanged = await one("SELECT merged_text FROM pa_letter WHERE id = ?", [Number(letter!.id)]);
    expect(unchanged!.merged_text).toBe(letter!.merged_text);
  });
});
