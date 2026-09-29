import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { requestHeadcount } from "@/app/actions/headcount";
import { decideApproval } from "@/app/actions/approvals";
import { saveRequisition } from "@/app/actions/recruitment";
import { requestFor } from "@/lib/workflow/engine";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * Headcount requests: a manager asks for a new position, and approving it —
 * through as many steps as the flow has — opens the position, vacant and
 * budgeted, ready for recruitment to hire against.
 */

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

let manager: Person;

beforeAll(async () => {
  manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
});
afterEach(() => actAs(null));

async function latestRequestFor(employeeId: number) {
  const row = await one(
    "SELECT * FROM om_headcount_request WHERE requested_by_employee_id = ? ORDER BY id DESC LIMIT 1",
    [employeeId],
  );
  return { row, approval: await requestFor("om_headcount_request", Number(row!.id)) };
}

/** Decides every step still pending, as HR — the test default session — until the request is final. */
async function decideAllSteps(id: number, decision: "Approved" | "Rejected"): Promise<void> {
  for (let guard = 0; guard < 5; guard += 1) {
    const request = await requestFor("om_headcount_request", id);
    if (!request || request.status !== "Pending") return;
    const r = await decideApproval({}, form({ requestId: request.id, decision, comment: "" }));
    if (!r.ok) throw new Error(r.error);
  }
  throw new Error("The request did not finish after 5 decisions.");
}

describe("asking for a new position", () => {
  it("needs a department, a job, a title and a budget above zero", async () => {
    actAs(manager.session);
    const missingBudget = await requestHeadcount(
      {},
      form({ orgUnitCode: "OU0002", jobCode: "JB0001", title: "QA engineer", grade: "", budget: 0, reason: "" }),
    );
    expect(missingBudget.error).toMatch(/budget/i);

    const missingTitle = await requestHeadcount(
      {},
      form({ orgUnitCode: "OU0002", jobCode: "JB0001", title: "", grade: "", budget: 60000, reason: "" }),
    );
    expect(missingTitle.error).toBeTruthy();
  });

  it("goes to approval, and approving it opens a vacant, budgeted position recruitment can hire against", async () => {
    actAs(manager.session);
    const r = await requestHeadcount(
      {},
      form({ orgUnitCode: "OU0002", jobCode: "JB0001", title: "QA engineer", grade: "L2", budget: 60000, reason: "Testing cannot keep up." }),
    );
    expect(r.ok).toBe(true);
    actAs(null); // back to HR to decide it — the requester cannot decide their own request

    const { row, approval } = await latestRequestFor(manager.employeeId);
    expect(approval?.status).toBe("Pending");
    expect(row!.status).toBe("Pending");
    expect(row!.position_code).toBeNull();

    await decideAllSteps(Number(row!.id), "Approved");

    const decided = await one("SELECT * FROM om_headcount_request WHERE id = ?", [Number(row!.id)]);
    expect(decided!.status).toBe("Approved");
    const positionCode = String(decided!.position_code);
    expect(positionCode).toBeTruthy();

    const position = await one("SELECT * FROM om_position WHERE code = ?", [positionCode]);
    expect(position).toMatchObject({ title: "QA engineer", org_unit_code: "OU0002", job_code: "JB0001", is_vacant: 1, budget_paise: 6_000_000 });

    // The done-when: recruitment can open a requisition against it.
    const opened = await saveRequisition(
      {},
      form({ positionCode, title: "QA engineer", openings: 1, postedDate: day(0) }),
    );
    expect(opened.error).toBeUndefined();
    const requisition = await one("SELECT position_code FROM rc_requisition WHERE code = ?", [opened.code!]);
    expect(requisition!.position_code).toBe(positionCode);
  });

  it("only marks the request when rejected — no position opens", async () => {
    actAs(manager.session);
    const r = await requestHeadcount(
      {},
      form({ orgUnitCode: "OU0002", jobCode: "JB0001", title: "Rejected role", grade: "", budget: 40000, reason: "" }),
    );
    expect(r.ok).toBe(true);
    actAs(null); // back to HR to decide it
    const { row } = await latestRequestFor(manager.employeeId);

    await decideAllSteps(Number(row!.id), "Rejected");
    const decided = await one("SELECT * FROM om_headcount_request WHERE id = ?", [Number(row!.id)]);
    expect(decided!.status).toBe("Rejected");
    expect(decided!.position_code).toBeNull();
    const stray = await one("SELECT code FROM om_position WHERE title = 'Rejected role'");
    expect(stray).toBeUndefined();
  });
});
