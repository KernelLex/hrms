import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import { dispatch } from "@/lib/api";
import { createApiClient } from "@/lib/api/clients";
import { ERP_SCOPES } from "@/lib/api/scopes";
import { deliverWebhooks, deriveEvents, replayDeliveries, setWebhookTransport, signWebhook, newWebhookSecret, MAX_WEBHOOK_ATTEMPTS } from "@/lib/api/events";
import { upsertCostCentre } from "@/lib/services/records";
import { issueLetter } from "@/lib/services/letters";
import { systemActor } from "@/lib/change-log";
import { runPayroll } from "@/lib/engines/payroll";
import { generateBankFile, postToLedger } from "@/app/actions/payroll";
import { todayInIndia } from "@/lib/dates";
import { ApiSession, MockErp, verifyWebhook, type Fetcher } from "../tools/mock-erp/erp";
import { runScenario } from "../tools/mock-erp/scenario";
import { apiClient, call } from "./support/api";
import { form } from "./support/fixtures";
import { createArea, createPeriod, hireForPayroll, postPeriod } from "./support/payroll-fixtures";

/**
 * The integration as the client's ERP lives it: the mock ERP (tools/mock-erp)
 * runs its whole scenario in-process, through the same router HTTP reaches,
 * with webhooks handed to its receiver instead of the network. Then what the
 * scenario cannot arrange on its own: deliveries that fail, are retried,
 * parked and replayed; forged signatures; and pay that must never show
 * without the scope for it.
 */

const BASE = "http://localhost/api/v1";
/** Where the mock ERP receives webhooks; other test files' subscriptions go elsewhere. */
const ERP_HOOK = "https://erp.test/hrms/webhooks";
const inProcess: Fetcher = (url, init) => dispatch(new Request(url, init), new URL(url).pathname.replace(/^\/api\/v1/, ""));
const pump = async () => {
  await deriveEvents();
  await deliverWebhooks();
};

let erp: MockErp;
let hr: ApiSession;

beforeAll(async () => {
  // Something to hire into, a posted payroll to book, and salaries to pay.
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, 'Integration analyst', 'OU0002', 'JB0001', 'PS0001', 0, 1, '2024-01-01', ?, 1)`,
    args: [`PSMK${randomUUID().slice(0, 6).toUpperCase()}`, OPEN_ENDED],
  });
  const area = await createArea();
  await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 60_000 }] });
  const periodId = await createPeriod(area, 2026, 6);
  const { runId } = await runPayroll({ periodId, runBy: "test" });
  await postPeriod(periodId);
  expect((await postToLedger({}, form({ runId, postingDate: "2026-06-30" }))).error).toBeUndefined();
  expect((await generateBankFile({}, form({ runId, paymentDate: "2026-06-30" }))).error).toBeUndefined();

  const erpClient = await createApiClient({ name: "Mock ERP (test)", scopes: ERP_SCOPES, companies: null, createdBy: "test" });
  const hrClient = await createApiClient({ name: "HR tool (test)", scopes: ["employees:hire", "employees:read", "pay:read"], companies: null, createdBy: "test" });
  erp = new MockErp(new ApiSession({ baseUrl: BASE, clientId: erpClient.clientId, secret: erpClient.secret, fetch: inProcess }));
  hr = new ApiSession({ baseUrl: BASE, clientId: hrClient.clientId, secret: hrClient.secret, fetch: inProcess });
  // Like the network: a delivery reaches the mock ERP only if addressed to it.
  setWebhookTransport(async (req) => ({ status: req.url === ERP_HOOK ? erp.receive({ headers: req.headers, body: req.body }) : 200 }));
});

afterAll(() => setWebhookTransport(null));

describe("the mock ERP", () => {
  it("runs its whole scenario", async () => {
    const steps = await runScenario({
      erp,
      hr,
      webhookUrl: ERP_HOOK,
      today: todayInIndia(),
      pump,
      badSession: new ApiSession({ baseUrl: BASE, clientId: erp.session.clientId, secret: "wrong", fetch: inProcess }),
    });
    const failed = steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`);
    expect(failed).toEqual([]);
    // Every step did its work: none found nothing to do.
    const idle = steps.filter((s) => /^(no |skipped)/.test(s.detail)).map((s) => `${s.name}: ${s.detail}`);
    expect(idle).toEqual([]);
    expect(steps.length).toBeGreaterThanOrEqual(20);
  });
});

describe("guided actions, tasks and letters through the API", () => {
  const one = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

  // The ERP is already subscribed to webhooks (the earlier scenario did
  // that); draining what these tests derive keeps the webhook-delivery
  // tests below from tripping over a leftover queued delivery.
  afterEach(() => pump());

  async function vacantPosition(): Promise<string> {
    const code = `PSMK${randomUUID().slice(0, 6).toUpperCase()}`;
    await rawClient().execute({
      sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
            VALUES (?, 'Integration role', 'OU0002', 'JB0001', NULL, 0, 1, '2024-01-01', ?, 1)`,
      args: [code, OPEN_ENDED],
    });
    return code;
  }

  it("transfers, promotes and confirms probation, deriving their events", async () => {
    const posA = await vacantPosition();
    const posB = await vacantPosition();
    const hireClient = await apiClient(["employees:hire", "employees:read", "pay:read"]);
    const hired = await call("POST", "/employees", {
      token: hireClient.token,
      body: {
        effective_date: "2026-01-05",
        company: "CO01",
        personnel_area: "PA01",
        department: "OU0002",
        position: posA,
        first_name: "Test",
        last_name: "Lifecycle",
        basic_pay: { amount: "50000.00", currency: "INR" },
      },
    });
    expect(hired.status).toBe(201);
    const employeeId = (hired.body as { id: number }).id;

    const write = await apiClient(["employees:write", "employees:read", "pay:read"]);

    const transferred = await call("POST", `/employees/${employeeId}/actions`, {
      token: write.token,
      body: { action: "transfer", effective_date: "2026-01-10", company: "CO01", department: "OU0002", position: posB },
    });
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(200);
    expect((transferred.body as { org_assignment: { position: { code: string } } }).org_assignment.position.code).toBe(posB);

    // posA is vacant again since the transfer freed it.
    const promoted = await call("POST", `/employees/${employeeId}/actions`, {
      token: write.token,
      body: { action: "promotion", effective_date: "2026-01-20", position: posA, basic_pay: { amount: "60000.00", currency: "INR" } },
    });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect((promoted.body as { basic_pay: { amount: { amount: string } } }).basic_pay.amount.amount).toBe("60000.00");

    const pending = await one("SELECT id FROM pa_it0019_monitoring WHERE employee_id = ? AND status = 'Pending'", [employeeId]);
    const confirmed = await call("POST", `/employees/${employeeId}/actions`, {
      token: write.token,
      body: { action: "confirmation", outcome: "confirm" },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await one("SELECT status FROM pa_it0019_monitoring WHERE id = ?", [Number(pending!.id)]))?.status).toBe("Confirmed");

    await deriveEvents();
    const events = await rawClient().execute({ sql: "SELECT type FROM int_event WHERE subject = ?", args: [`employees/${employeeId}`] });
    const types = events.rows.map((r) => String(r.type));
    expect(types).toContain("employee.transferred");
    expect(types).toContain("employee.promoted");
    expect(types).toContain("employee.confirmed");
  });

  it("lists and completes onboarding tasks, and lists and downloads a letter", async () => {
    const hireClient = await apiClient(["employees:hire", "employees:read", "pay:read"]);
    const hired = await call("POST", "/employees", {
      token: hireClient.token,
      body: {
        effective_date: "2026-01-05",
        company: "CO01",
        personnel_area: "PA01",
        department: "OU0002",
        position: await vacantPosition(),
        first_name: "Second",
        last_name: "Lifecycle",
        basic_pay: { amount: "50000.00", currency: "INR" },
      },
    });
    expect(hired.status).toBe(201);
    const employeeId = (hired.body as { id: number }).id;

    const read = await apiClient(["employees:read"]);
    const tasks = await call("GET", `/tasks?employee_id=${employeeId}&status=Pending`, { token: read.token });
    expect(tasks.status).toBe(200);
    const task = (tasks.body as { data: { id: number }[] }).data[0];
    expect(task).toBeTruthy();

    const write = await apiClient(["employees:write"]);
    const done = await call("POST", `/tasks/${task.id}/complete`, { token: write.token });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((done.body as { status: string }).status).toBe("Done");

    const template = await one("SELECT id FROM pa_letter_template WHERE is_active = 1 LIMIT 1");
    const issued = await issueLetter(systemActor("test"), { employeeId, templateId: Number(template!.id), issueDate: "2026-01-05" }, "test");
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const letters = await call("GET", `/letters?employee_id=${employeeId}`, { token: read.token });
    expect(letters.status).toBe(200);
    expect((letters.body as { data: { id: number }[] }).data.some((l) => l.id === issued.value.id)).toBe(true);

    const pdf = await call("GET", `/letters/${issued.value.id}/pdf`, { token: read.token });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(pdf.bytes!.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

/** An HRMS-side change the ERP hears about, and the delivery carrying it. */
async function changeAndFindDelivery() {
  const code = `CC-WH-${randomUUID().slice(0, 6).toUpperCase()}`;
  const saved = await upsertCostCentre(systemActor("test"), code, { name: "Webhook test", companyCode: null, isActive: true });
  expect(saved.ok).toBe(true);
  await deriveEvents();
  const r = await rawClient().execute({
    sql: "SELECT id FROM app_outbox WHERE channel = 'webhook' AND subject = 'cost_centre.changed' AND body_text LIKE ? ORDER BY id DESC LIMIT 1",
    args: [`%${code}%`],
  });
  expect(r.rows.length).toBe(1);
  return { code, id: Number(r.rows[0].id) };
}

async function delivery(id: number) {
  const r = await rawClient().execute({ sql: "SELECT status, attempts, last_error FROM app_outbox WHERE id = ?", args: [id] });
  return r.rows[0] as unknown as { status: string; attempts: number; last_error: string | null };
}

/** Makes a waiting retry due now, instead of in thirty seconds or an hour. */
const dueNow = (id: number) =>
  rawClient().execute({ sql: "UPDATE app_outbox SET next_attempt_at = ? WHERE id = ?", args: [new Date(Date.now() - 1000).toISOString(), id] });

const receivedFor = (code: string) => erp.received.filter((e) => e.subject === `cost-centres/${code}`);

describe("webhook delivery", () => {
  it("retries a delivery the ERP failed, and delivers it once", async () => {
    const { code, id } = await changeAndFindDelivery();
    erp.failNext = 1;
    await deliverWebhooks();
    expect(await delivery(id)).toMatchObject({ status: "queued", attempts: 1, last_error: "The endpoint answered 500." });
    expect(receivedFor(code)).toHaveLength(0);

    await dueNow(id);
    await deliverWebhooks();
    expect((await delivery(id)).status).toBe("sent");
    expect(receivedFor(code)).toHaveLength(1);
  });

  it("parks a delivery after ten failures, and sends it when replayed", async () => {
    const { code, id } = await changeAndFindDelivery();
    erp.failNext = 1000;
    for (let i = 0; i < MAX_WEBHOOK_ATTEMPTS; i++) {
      await dueNow(id);
      await deliverWebhooks();
    }
    expect(await delivery(id)).toMatchObject({ status: "failed", attempts: MAX_WEBHOOK_ATTEMPTS });

    erp.failNext = 0;
    expect(await replayDeliveries([id])).toBe(1);
    await deliverWebhooks();
    expect((await delivery(id)).status).toBe("sent");
    expect(receivedFor(code)).toHaveLength(1);
  });

  it("carries the same event as the pull feed", async () => {
    const { code } = await changeAndFindDelivery();
    await deliverWebhooks();
    const pushed = receivedFor(code)[0];
    const { events } = await erp.feed(Number(pushed.sequence) - 1);
    expect(events.find((e) => e.id === pushed.id)).toEqual(pushed);
  });
});

describe("webhook signatures", () => {
  const secret = newWebhookSecret();
  const body = JSON.stringify({ id: "evt_1", type: "employee.hired" });
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const headers = (signature: string, timestamp = ts) => ({ "webhook-id": "evt_1", "webhook-timestamp": String(timestamp), "webhook-signature": signature });

  it("verify with the subscription's secret", () => {
    expect(verifyWebhook(secret, headers(signWebhook(secret, "evt_1", ts, body)), body, now)).toEqual({ ok: true });
  });

  it("accept any listed signature, as during a secret rotation", () => {
    expect(verifyWebhook(secret, headers(`v1,bm9wZQ== ${signWebhook(secret, "evt_1", ts, body)}`), body, now).ok).toBe(true);
  });

  it("refuse a changed body, another secret, or an old timestamp", () => {
    const good = signWebhook(secret, "evt_1", ts, body);
    expect(verifyWebhook(secret, headers(good), `${body} `, now).ok).toBe(false);
    expect(verifyWebhook(newWebhookSecret(), headers(good), body, now).ok).toBe(false);
    const old = ts - 600;
    expect(verifyWebhook(secret, headers(signWebhook(secret, "evt_1", old, body), old), body, now).ok).toBe(false);
  });
});

/** Every key anywhere in a JSON document. */
function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  }
  return out;
}

// Events about people and their pay; remittances and journals are totals, and
// carry amounts with payroll:read and gl:read by design.
const PERSONAL_EVENTS = "employee.hired,employee.updated,employee.status_changed,payroll.run.completed,payment_batch.created";

describe("sensitive data", () => {
  it("never shows pay or bank details without pay:read and bank:read", async () => {
    const c = await apiClient(["employees:read", "payroll:read", "events:read"]);
    const list = await call("GET", "/employees?limit=200", { token: c.token });
    const someone = (list.body as { data: { id: number }[] }).data[0].id;
    const bodies = await Promise.all(
      ["/employees?limit=200", `/employees/${someone}`, "/payroll/runs?limit=200", "/payment-batches?limit=200", `/events?after=0&limit=200&types=${PERSONAL_EVENTS}`].map(
        async (p) => (await call("GET", p, { token: c.token })).body,
      ),
    );
    const keys = keysIn(bodies);
    for (const k of ["basic_pay", "bank_account", "account_number", "gross_total", "net_total", "total", "amount", "currency"]) {
      expect(keys.has(k), k).toBe(false);
    }
    const history = await call("GET", `/employees/${someone}/history?record=basic_pay`, { token: c.token });
    expect(history.status).toBe(403);
  });

  it("shows pay but not bank details with pay:read alone", async () => {
    const c = await apiClient(["employees:read", "payroll:read", "pay:read"]);
    const bodies = [(await call("GET", "/employees?limit=200", { token: c.token })).body, (await call("GET", "/payment-batches?limit=200", { token: c.token })).body];
    const keys = keysIn(bodies);
    expect(keys.has("basic_pay")).toBe(true);
    expect(keys.has("bank_account")).toBe(false);
    expect(keys.has("account_number")).toBe(false);
  });

  it("records who read someone's pay through the API", async () => {
    const c = await apiClient(["employees:read", "pay:read"]);
    const list = await call("GET", "/employees?limit=1", { token: c.token });
    const id = (list.body as { data: { id: number }[] }).data[0].id;
    await call("GET", `/employees/${id}/history?record=basic_pay`, { token: c.token });
    const logged = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM app_access_log WHERE client_pk = ? AND subject_employee_id = ?", args: [c.pk, id] });
    expect(Number(logged.rows[0].n)).toBeGreaterThan(0);
  });
});
