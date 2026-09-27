import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { cancelChange, requestChange } from "@/app/actions/corrections";
import { decideApproval } from "@/app/actions/approvals";
import { requestFor } from "@/lib/workflow/engine";
import { readAsOf } from "@/lib/engines/timeslice";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";
import { apiClient, call } from "./support/api";

/**
 * Correcting one's own record: a request, an approval, and a change written
 * from its effective date with the history intact. A bank change needs proof
 * and two different people.
 */

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const proof = () => new File([new TextEncoder().encode("%PDF-1.4\n% cheque\n%%EOF")], "cheque.pdf", { type: "application/pdf" });

let manager: Person;
let employee: Person;

beforeAll(async () => {
  manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
  employee = await createPerson({ roles: ["EMPLOYEE"], reportsTo: manager.position });
  await rawClient().batch(
    [
      {
        sql: `INSERT INTO pa_it0006_address (employee_id, address_type, line, city, state, postal_code, country, valid_from, valid_to, seq, created_by, created_at)
              VALUES (?, 'Permanent', '1 Old Road', 'Mysuru', 'Karnataka', '570001', 'India', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
        args: [employee.employeeId, new Date().toISOString()],
      },
      {
        sql: `INSERT INTO pa_it0009_bank_details (employee_id, bank_name, account_number, ifsc, holder_name, valid_from, valid_to, seq, created_by, created_at)
              VALUES (?, 'Old Bank', '111122223333', 'OLDB0000001', 'Test Person', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
        args: [employee.employeeId, new Date().toISOString()],
      },
    ],
    "write",
  );
});

afterEach(() => actAs(null));

async function ask(values: Record<string, string>, file?: File) {
  actAs(employee.session);
  const f = form(values);
  if (file) f.set("evidence", file);
  const r = await requestChange({}, f);
  actAs(null);
  return r;
}

async function latestRequest(section: string) {
  const row = (
    await rawClient().execute({
      sql: "SELECT * FROM pa_change_request WHERE employee_id = ? AND section = ? ORDER BY id DESC LIMIT 1",
      args: [employee.employeeId, section],
    })
  ).rows[0];
  return { row, approval: await requestFor("pa_change_request", Number(row.id)) };
}

const decide = (requestId: number, decision: "Approved" | "Rejected", comment = "") =>
  decideApproval({}, form({ requestId, decision, comment }));

describe("an address change", () => {
  it("applies from its effective date once HR approves, and the old address stays in the history", async () => {
    const from = day(10);
    const r = await ask({ section: "address", subtype: "Permanent", line: "22 New Street", city: "Bengaluru", state: "Karnataka", postal_code: "560038", country: "India", effectiveDate: from, note: "Moved house" });
    expect(r).toEqual({ ok: true });
    const { row, approval } = await latestRequest("address");
    expect(approval?.status).toBe("Pending");
    expect(JSON.parse(String(row.current)).line).toBe("1 Old Road");

    expect((await decide(approval!.id, "Approved")).ok).toBe(true);
    expect((await requestFor("pa_change_request", Number(row.id)))?.status).toBe("Approved");

    const lineOn = async (date: string) =>
      (
        await rawClient().execute({
          sql: "SELECT line FROM pa_it0006_address WHERE employee_id = ? AND address_type = 'Permanent' AND valid_from <= ? AND valid_to >= ?",
          args: [employee.employeeId, date, date],
        })
      ).rows.map((a) => String(a.line));
    expect(await lineOn(day(9))).toEqual(["1 Old Road"]);
    expect(await lineOn(from)).toEqual(["22 New Street"]);

    const logged = await rawClient().execute({
      sql: "SELECT reason FROM app_change_log WHERE entity = 'pa_it0006_address' AND subject_employee_id = ? AND action = 'create' ORDER BY id DESC LIMIT 1",
      args: [employee.employeeId],
    });
    expect(String(logged.rows[0].reason)).toMatch(/^Requested by Test Person .*; approved by hr\.admin$/);
    const told = await rawClient().execute({
      sql: "SELECT title FROM app_notification WHERE user_id = ? AND kind = 'change_request.decided' ORDER BY id DESC LIMIT 1",
      args: [employee.userId],
    });
    expect(String(told.rows[0].title)).toBe("Your change to your permanent address was approved");
  });

  it("is refused when nothing changes, and only one can wait at a time", async () => {
    expect((await ask({ section: "contact", subtype: "Mobile phone", value: "+91 90000 00001", effectiveDate: day(0) })).ok).toBe(true);
    expect((await ask({ section: "contact", subtype: "Mobile phone", value: "+91 90000 00002", effectiveDate: day(0) })).error).toMatch(/already waiting/);
    const { row } = await latestRequest("contact");
    actAs(employee.session);
    expect((await cancelChange({}, form({ id: Number(row.id) }))).ok).toBe(true);
    actAs(null);
    expect((await requestFor("pa_change_request", Number(row.id)))?.status).toBe("Cancelled");
  });
});

describe("a bank change", () => {
  const bank = { section: "bank", bank_name: "HDFC Bank", account_number: "50100123456789", ifsc: "HDFC0001234", holder_name: "Test Person" };

  it("needs proof, a real IFSC, and a date no earlier than today", async () => {
    expect((await ask({ ...bank, effectiveDate: day(0) })).error).toMatch(/proof/i);
    expect((await ask({ ...bank, ifsc: "HDFC1234", effectiveDate: day(0) }, proof())).error).toMatch(/IFSC/);
    expect((await ask({ ...bank, effectiveDate: day(-3) }, proof())).error).toMatch(/today or later/);
  });

  it("needs two approvers: HR, then the manager — never the same person twice", async () => {
    expect((await ask({ ...bank, effectiveDate: day(1) }, proof())).ok).toBe(true);
    const { row, approval } = await latestRequest("bank");
    expect(row.evidence_document_id).not.toBeNull();

    expect((await decide(approval!.id, "Approved")).ok).toBe(true);
    const after1 = await requestFor("pa_change_request", Number(row.id));
    expect(after1).toMatchObject({ status: "Pending", currentStep: 2 });

    // The first approver cannot take the second step as well.
    expect((await decide(approval!.id, "Approved")).error).toMatch(/Someone else has to approve/);
    const unchanged = await readAsOf<{ account_number: string }>("pa_it0009_bank_details", employee.employeeId, day(1));
    expect(unchanged?.account_number).toBe("111122223333");

    actAs(manager.session);
    expect((await decide(approval!.id, "Approved")).ok).toBe(true);
    actAs(null);
    const changed = await readAsOf<{ account_number: string; ifsc: string }>("pa_it0009_bank_details", employee.employeeId, day(1));
    expect(changed).toMatchObject({ account_number: "50100123456789", ifsc: "HDFC0001234" });
    const before = await readAsOf<{ account_number: string }>("pa_it0009_bank_details", employee.employeeId, day(0));
    expect(before?.account_number).toBe("111122223333");
  });

  it("changes nothing when rejected, and tells the employee why", async () => {
    expect((await ask({ ...bank, account_number: "99990000111122", effectiveDate: day(2) }, proof())).ok).toBe(true);
    const { approval } = await latestRequest("bank");
    expect((await decide(approval!.id, "Rejected", "The cheque is from a different account.")).ok).toBe(true);
    const now = await readAsOf<{ account_number: string }>("pa_it0009_bank_details", employee.employeeId, day(2));
    expect(now?.account_number).toBe("50100123456789");
    const told = await rawClient().execute({
      sql: "SELECT body FROM app_notification WHERE user_id = ? AND kind = 'change_request.decided' ORDER BY id DESC LIMIT 1",
      args: [employee.userId],
    });
    expect(String(told.rows[0].body)).toBe("The cheque is from a different account.");
  });
});

describe("through the API", () => {
  it("files a correction that waits for HR, and keeps bank details to those allowed", async () => {
    const plain = await apiClient(["employees:read", "employees:write"]);
    const address = await call("POST", `/employees/${employee.employeeId}/change-requests`, {
      token: plain.token,
      body: { section: "address", subtype: "Temporary", values: { line: "Hostel block C", city: "Pune", postal_code: "411001" }, effective_date: day(3) },
      headers: { "Idempotency-Key": `cr-${Date.now()}` },
    });
    expect(address.status).toBe(201);
    expect(address.body).toMatchObject({ section: "address", subtype: "Temporary", status: "Pending", channel: "api" });

    const bankWithoutScope = await call("POST", `/employees/${employee.employeeId}/change-requests`, {
      token: plain.token,
      body: { section: "bank", values: { bank_name: "SBI", account_number: "30000000000001", ifsc: "SBIN0000001", holder_name: "Test Person" }, effective_date: day(1) },
    });
    expect(bankWithoutScope.status).toBe(403);

    const banker = await apiClient(["employees:read", "employees:write", "bank:read"]);
    const bank = await call("POST", `/employees/${employee.employeeId}/change-requests`, {
      token: banker.token,
      body: {
        section: "bank",
        values: { bank_name: "SBI", account_number: "30000000000001", ifsc: "SBIN0000001", holder_name: "Test Person" },
        effective_date: day(1),
        evidence: { file_name: "cheque.pdf", content_base64: Buffer.from("%PDF-1.4 %%EOF").toString("base64") },
      },
    });
    expect(bank.status).toBe(201);

    const listed = await call("GET", `/change-requests?employee_id=${employee.employeeId}&status=Pending`, { token: plain.token });
    const theirs = (listed.body as { data: { section: string; proposed: Record<string, string> }[] }).data.find((r) => r.section === "bank");
    expect(theirs?.proposed.account_number).toBe("••••0001");
  });
});
