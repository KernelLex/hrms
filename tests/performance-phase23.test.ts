import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import {
  saveGoalCheckin,
  requestFeedback,
  submitFeedback,
  savePip,
  addPipCheckin,
  closePip,
} from "@/app/actions/performance";
import {
  saveCourse,
  saveSession,
  nominate,
  decideNomination,
  saveDepartmentBudget,
  saveCertification,
} from "@/app/actions/training";
import { peerFeedbackSummary } from "@/lib/performance";
import { enqueueJob } from "@/lib/jobs/queue";
import { processJobs } from "@/lib/jobs/runner";
import { todayInIndia } from "@/lib/dates";
import { form, createBareEmployee } from "./support/fixtures";
import { actAs, createPerson } from "./support/people";

/**
 * Phase 23: goal check-ins and their reminder, 360 feedback kept behind its
 * anonymity threshold, improvement plans, a nomination refused over its
 * department's training budget, and a certification's expiry warning.
 */

const uid = () => randomUUID().slice(0, 6).toUpperCase();

async function one(sql: string, args: (string | number)[] = []) {
  return (await rawClient().execute({ sql, args })).rows[0] as unknown as Record<string, unknown> | undefined;
}

/** Works the queue until it is empty, as the runner's hand-offs would. */
async function drain(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    const { more } = await processJobs(5_000);
    if (!more) return;
  }
}

async function activeCycleWithGoal(employeeId: number): Promise<{ cycleId: number; goalId: number }> {
  const cycle = await rawClient().execute({
    sql: `INSERT INTO pm_appraisal_cycle (name, period_label, start_date, end_date, template_code, status, created_at)
          VALUES (?, 'FY test', '2030-04-01', '2031-03-31', 'STANDARD', 'Active', ?) RETURNING id`,
    args: [`Cycle ${uid()}`, new Date().toISOString()],
  });
  const cycleId = Number(cycle.rows[0].id);
  const goal = await rawClient().execute({
    sql: `INSERT INTO pm_goal (cycle_id, employee_id, category, description, weightage_percent, created_at) VALUES (?, ?, 'Business goal', 'Ship it', 100, ?) RETURNING id`,
    args: [cycleId, employeeId, new Date().toISOString()],
  });
  return { cycleId, goalId: Number(goal.rows[0].id) };
}

afterEach(() => actAs(null));

describe("goal check-ins", () => {
  it("lets the employee and their manager each add their own check-in", async () => {
    const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const employee = await createPerson({ roles: ["EMPLOYEE"], reportsTo: manager.position });
    const { goalId } = await activeCycleWithGoal(employee.employeeId);

    actAs(employee.session);
    const own = await saveGoalCheckin({}, form({ goalId, status: "On track", comment: "Going well." }));
    actAs(null);
    expect(own.ok).toBe(true);

    actAs(manager.session);
    const theirs = await saveGoalCheckin({}, form({ goalId, status: "At risk", comment: "Slower than hoped." }));
    actAs(null);
    expect(theirs.ok).toBe(true);

    const rows = (await rawClient().execute("SELECT author_type, status FROM pm_goal_checkin WHERE goal_id = ? ORDER BY id", [goalId])).rows;
    expect(rows).toMatchObject([
      { author_type: "Employee", status: "On track" },
      { author_type: "Manager", status: "At risk" },
    ]);

    // An unrelated manager may not check in on someone else's goal.
    const outsider = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    actAs(outsider.session);
    const refused = await saveGoalCheckin({}, form({ goalId, status: "On track", comment: "Not mine to say." }));
    actAs(null);
    expect(refused.error).toMatch(/report to you/);
  });

  it("reminds everyone with an open goal and no recent check-in, once a week", async () => {
    const employee = await createPerson({ roles: ["EMPLOYEE"] });
    await activeCycleWithGoal(employee.employeeId);

    await enqueueJob("daily", null, { dedupeKey: `test.daily:${uid()}` });
    await drain();

    const notice = await one("SELECT kind FROM app_notification WHERE user_id = ? AND kind = 'goal_checkin.due'", [employee.userId]);
    expect(notice).toBeTruthy();
  });
});

describe("360 feedback", () => {
  it("keeps peer feedback hidden until three peers have answered", async () => {
    const cycle = await rawClient().execute({
      sql: `INSERT INTO pm_appraisal_cycle (name, period_label, start_date, end_date, template_code, status, created_at)
            VALUES (?, 'FY test', '2030-04-01', '2031-03-31', 'STANDARD', 'Active', ?) RETURNING id`,
      args: [`Cycle ${uid()}`, new Date().toISOString()],
    });
    const cycleId = Number(cycle.rows[0].id);
    const reviewee = await createBareEmployee("RV");
    const peers = [await createBareEmployee("P1"), await createBareEmployee("P2"), await createBareEmployee("P3")];

    const manager = await createPerson({ roles: ["EMPLOYEE"] });
    actAs(manager.session);
    for (const peerId of peers) {
      await rawClient().execute({
        sql: `INSERT INTO pm_feedback_request (cycle_id, reviewee_employee_id, reviewer_employee_id, relationship, status, requested_by, requested_at)
              VALUES (?, ?, ?, 'Peer', 'Requested', 'test', ?)`,
        args: [cycleId, reviewee, peerId, new Date().toISOString()],
      });
    }
    actAs(null);

    const requests = (await rawClient().execute("SELECT id FROM pm_feedback_request WHERE reviewee_employee_id = ?", [reviewee])).rows;

    // Two answer: still hidden.
    for (const r of requests.slice(0, 2)) {
      await rawClient().execute({ sql: "UPDATE pm_feedback_request SET status = 'Submitted' WHERE id = ?", args: [Number(r.id)] });
      await rawClient().execute({ sql: "INSERT INTO pm_feedback (request_id, competency, rating, created_at) VALUES (?, 'Communication', 4, ?)", args: [Number(r.id), new Date().toISOString()] });
    }
    let summary = await peerFeedbackSummary(reviewee, cycleId);
    expect(summary.peerAverageByCompetency).toBeNull();
    expect(summary.peerResponseCount).toBe(2);

    // A third answers: now shown, in aggregate.
    const third = requests[2];
    await rawClient().execute({ sql: "UPDATE pm_feedback_request SET status = 'Submitted' WHERE id = ?", args: [Number(third.id)] });
    await rawClient().execute({ sql: "INSERT INTO pm_feedback (request_id, competency, rating, created_at) VALUES (?, 'Communication', 2, ?)", args: [Number(third.id), new Date().toISOString()] });

    summary = await peerFeedbackSummary(reviewee, cycleId);
    expect(summary.peerAverageByCompetency).toMatchObject({ Communication: 3.3 });
  });

  it("submits only through the reviewer's own request", async () => {
    const cycle = await rawClient().execute({
      sql: `INSERT INTO pm_appraisal_cycle (name, period_label, start_date, end_date, template_code, status, created_at)
            VALUES (?, 'FY test', '2030-04-01', '2031-03-31', 'STANDARD', 'Active', ?) RETURNING id`,
      args: [`Cycle ${uid()}`, new Date().toISOString()],
    });
    const cycleId = Number(cycle.rows[0].id);
    const hr = await createPerson({ roles: ["HR_ADMIN"] });
    const reviewer = await createPerson({ roles: ["EMPLOYEE"] });
    const someoneElse = await createPerson({ roles: ["EMPLOYEE"] });
    const reviewee = await createBareEmployee("RV");

    actAs(hr.session);
    const r = await requestFeedback({}, form({ cycleId, revieweeEmployeeId: reviewee, reviewerEmployeeId: reviewer.employeeId, relationship: "Peer" }));
    actAs(null);
    expect(r.ok).toBe(true);
    const request = await one("SELECT id FROM pm_feedback_request WHERE cycle_id = ? AND reviewer_employee_id = ?", [cycleId, reviewer.employeeId]);

    actAs(someoneElse.session);
    const wrong = await submitFeedback({}, form({ id: Number(request!.id), "rating:Communication": 4, "rating:Collaboration": 4, "rating:Execution": 4, "rating:Leadership": 4 }));
    actAs(null);
    expect(wrong.error).toMatch(/not yours/);

    actAs(reviewer.session);
    const right = await submitFeedback({}, form({ id: Number(request!.id), "rating:Communication": 4, "rating:Collaboration": 4, "rating:Execution": 4, "rating:Leadership": 4 }));
    actAs(null);
    expect(right.ok).toBe(true);
  });
});

describe("improvement plans", () => {
  it("is opened, checked in on, and closed with an outcome", async () => {
    const employeeId = await createBareEmployee("IP");
    const opened = await savePip({}, form({ employeeId, reason: "Missed two deadlines", goals: "Deliver on time for 90 days", startDate: todayInIndia(), endDate: "2031-01-01" }));
    expect(opened.ok).toBe(true);
    const pip = await one("SELECT id FROM pm_pip WHERE employee_id = ?", [employeeId]);

    expect((await addPipCheckin({}, form({ pipId: Number(pip!.id), note: "First week: on track." }))).ok).toBe(true);
    expect((await closePip({}, form({ id: Number(pip!.id), outcome: "Passed" }))).ok).toBe(true);

    const closed = await one("SELECT outcome FROM pm_pip WHERE id = ?", [Number(pip!.id)]);
    expect(closed).toMatchObject({ outcome: "Passed" });
  });
});

describe("training nominations", () => {
  /** A fresh course and session costing ₹50,000, with the department's budget for its year set as asked. */
  async function courseWithBudget(allocatedRupees: number): Promise<number> {
    const code = `CRS${uid()}`;
    await saveCourse({}, form({ code, title: "Test course" }));
    await saveSession({}, form({ courseCode: code, startDate: "2030-06-01", endDate: "2030-06-02", capacity: 10, cost: "50000" }));
    const session = await one("SELECT id FROM ld_session WHERE course_code = ?", [code]);
    await saveDepartmentBudget({}, form({ orgUnitCode: "OU0002", year: 2030, allocated: String(allocatedRupees) }));
    return Number(session!.id);
  }

  it("is refused once it would take the department over its training budget for the year", async () => {
    const employee = await createPerson({ roles: ["EMPLOYEE"] });
    const sessionId = await courseWithBudget(40_000); // allocated less than the session's ₹50,000 cost
    actAs(employee.session);
    await nominate({}, form({ sessionId }));
    actAs(null);
    const nomination = await one("SELECT id FROM ld_nomination WHERE session_id = ? AND employee_id = ?", [sessionId, employee.employeeId]);

    const decision = await decideNomination({}, form({ id: Number(nomination!.id), decision: "Approved" }));
    expect(decision.error).toMatch(/budget/);
    expect((await one("SELECT status FROM ld_nomination WHERE id = ?", [Number(nomination!.id)]))!.status).toBe("Requested");
  });

  it("is approved when it fits the budget", async () => {
    const employee = await createPerson({ roles: ["EMPLOYEE"] });
    const sessionId = await courseWithBudget(100_000); // comfortably above the session's ₹50,000 cost
    actAs(employee.session);
    await nominate({}, form({ sessionId }));
    actAs(null);
    const nomination = await one("SELECT id FROM ld_nomination WHERE session_id = ? AND employee_id = ?", [sessionId, employee.employeeId]);

    const decision = await decideNomination({}, form({ id: Number(nomination!.id), decision: "Approved" }));
    expect(decision.ok).toBe(true);
  });
});

describe("certifications", () => {
  it("warns the holder and their manager ahead of expiry, once", async () => {
    const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const holder = await createPerson({ roles: ["EMPLOYEE"], reportsTo: manager.position });

    actAs(holder.session);
    const saved = await saveCertification({}, form({ name: "Forklift license", issuedDate: "2029-01-01", expiryDate: "2031-01-01" }));
    actAs(null);
    expect(saved.ok).toBe(true);
    // Within the 30-day warning window, whatever today happens to be.
    const cert = await one("SELECT id FROM ld_certification WHERE employee_id = ?", [holder.employeeId]);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await rawClient().execute({ sql: "UPDATE ld_certification SET expiry_date = ? WHERE id = ?", args: [soon, Number(cert!.id)] });

    await enqueueJob("daily", null, { dedupeKey: `test.daily:${uid()}` });
    await drain();

    const holderNotice = await one("SELECT id FROM app_notification WHERE user_id = ? AND kind = 'certification.expiring'", [holder.userId]);
    expect(holderNotice).toBeTruthy();
    const managerNotice = await one("SELECT id FROM app_notification WHERE user_id = ? AND kind = 'certification.expiring'", [manager.userId]);
    expect(managerNotice).toBeTruthy();

    // Not told twice: a second tick finds it already reminded.
    await enqueueJob("daily", null, { dedupeKey: `test.daily:${uid()}` });
    await drain();
    const count = await one("SELECT COUNT(*) AS n FROM app_notification WHERE user_id = ? AND kind = 'certification.expiring'", [holder.userId]);
    expect(Number(count!.n)).toBe(1);
  });
});
