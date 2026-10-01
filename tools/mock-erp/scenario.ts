import { randomUUID } from "node:crypto";
import { ApiSession, MockErp, type CloudEvent, type Employee, type Problem } from "./erp";

/**
 * The integration, end to end, as the ERP would live it: connect, keep a
 * copy of the people, push what it owns, be refused what it does not, hear
 * about a hire made elsewhere through a signed webhook and the pull feed,
 * never hear its own changes back, book the payroll journal and confirm the
 * salaries it paid. Each step says what it checked.
 *
 * `pump` moves background work along: in-process it runs the job queue;
 * against a running app the app does that itself after each call.
 */

export type Step = { name: string; ok: boolean; detail: string };

export type ScenarioOptions = {
  erp: MockErp;
  /** Another system allowed to hire — the sandbox HR tool. */
  hr: ApiSession;
  /** Where the ERP receives webhooks, or null to rely on the pull feed. */
  webhookUrl: string | null;
  /** YYYY-MM-DD, for effective dates. */
  today: string;
  pump: () => Promise<void>;
  log?: (step: Step) => void;
  /** A wrong secret for the refusal check. */
  badSession?: ApiSession;
};

class Failed extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Failed(message);
}

const problemOf = (body: unknown) => body as Problem;

type Position = { code: string; department: string; is_vacant: boolean; is_active: boolean };
type Department = { code: string; company: string | null; personnel_area: string | null };
type CostCentre = { code: string; name: string };
type Money = { amount: string; currency: string };
type GlPosting = { id: number; total_debit: Money; total_credit: Money; acknowledgement: { state: string; reference: string | null } };
type Batch = { id: number; lines: { employee_id: number; payment_status: string }[] };

export async function runScenario(o: ScenarioOptions): Promise<Step[]> {
  const { erp, hr } = o;
  const s = erp.session;
  const steps: Step[] = [];
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  let costCentre = "";
  let hiredId = 0;
  let feedStart = 0;

  async function step(name: string, run: () => Promise<string>): Promise<boolean> {
    try {
      const detail = await run();
      steps.push({ name, ok: true, detail });
    } catch (err) {
      steps.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
    o.log?.(steps[steps.length - 1]);
    return steps[steps.length - 1].ok;
  }

  /** Until the predicate holds, moving background work along; fifteen seconds at most. */
  async function waitFor<T>(what: string, find: () => T | undefined | Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const found = await find();
      if (found) return found;
      if (Date.now() > deadline) throw new Failed(`Gave up waiting for ${what}.`);
      await o.pump();
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const steady = [
    async () =>
      step("Takes a token with client credentials", async () => {
        const t = await s.takeToken();
        check(t.status === 200, `The token endpoint answered ${t.status}.`);
        check(s.scope.split(" ").includes("employees:read"), `The token's scopes were "${s.scope}".`);
        return `scopes: ${s.scope}`;
      }),

    async () =>
      step("Is refused with a wrong secret", async () => {
        if (!o.badSession) return "skipped";
        const t = await o.badSession.takeToken();
        check(t.status === 401 && t.body.code === "invalid_client", `Expected 401 invalid_client, got ${t.status} ${t.body.code}.`);
        return "401 invalid_client";
      }),

    async () =>
      step("Reads who owns what", async () => {
        const r = await s.get<{ data: { record_type: string; field: string | null; owner: string }[] }>("/ownership");
        check(r.status === 200, `Answered ${r.status}.`);
        const owner = (t: string) => r.body.data.find((d) => d.record_type === t && d.field === null)?.owner;
        check(owner("cost_centre") === "erp", "The ERP should own cost centres.");
        check(owner("employee") === "hrms", "The HRMS should own employees.");
        return r.body.data.map((d) => `${d.record_type}${d.field ? `.${d.field}` : ""}=${d.owner}`).join(", ");
      }),

    async () =>
      step("Subscribes to webhooks", async () => {
        if (!o.webhookUrl) return "no receiver: using the pull feed only";
        const existing = await s.get<{ data: { id: number; url: string }[] }>("/webhook-subscriptions");
        for (const w of existing.body.data.filter((w) => w.url === o.webhookUrl)) {
          await s.request("DELETE", `/webhook-subscriptions/${w.id}`);
        }
        const r = await s.request<{ id: number; secret: string }>("POST", "/webhook-subscriptions", {
          body: { url: o.webhookUrl },
          headers: { "Idempotency-Key": randomUUID() },
        });
        check(r.status === 201, `Answered ${r.status}: ${JSON.stringify(r.body)}`);
        check(r.body.secret?.startsWith("whsec_"), "The signing secret was not returned.");
        erp.webhookSecret = r.body.secret;
        return `subscription ${r.body.id} to ${o.webhookUrl}`;
      }),

    async () =>
      step("Starts the pull feed from now", async () => {
        const { nextAfter } = await erp.feed(0, { includeOwn: true });
        erp.feedAfter = nextAfter;
        feedStart = nextAfter;
        return `after=${nextAfter}`;
      }),

    async () =>
      step("Copies every employee, a page at a time", async () => {
        const first = await erp.sync(2);
        check(first.changed > 0, "No employees came back.");
        check(erp.employees.size === first.changed, "A page repeated an employee.");
        const sample = [...erp.employees.values()][0];
        check(sample.basic_pay !== undefined, "pay:read was granted, but basic pay is missing.");
        return `${erp.employees.size} employees`;
      }),

    async () =>
      step("Links its own id to an employee and finds them by it", async () => {
        const e = [...erp.employees.values()][0];
        const mine = `ERP-${stamp}-${e.id}`;
        const put = await s.request<{ external_ids: Record<string, string> }>("PUT", `/employees/${e.id}/external-ids`, { body: { external_id: mine } });
        check(put.status === 200, `Answered ${put.status}.`);
        const found = await s.get<{ data: Employee[] }>(`/employees?external_id=${encodeURIComponent(mine)}`);
        check(found.body.data.length === 1 && found.body.data[0].id === e.id, "Looking the employee up by the ERP's id failed.");
        return `${e.employee_number} is ${mine}`;
      }),

    async () =>
      step("Pushes a cost centre, then is stopped from overwriting a newer one", async () => {
        const companies = await s.get<{ data: { code: string }[] }>("/companies");
        costCentre = `CC-MOCK-${stamp}`;
        const created = await s.request<CostCentre>("PUT", `/cost-centres/${costCentre}`, { body: { name: "Mock ERP projects", company: companies.body.data[0]?.code ?? null } });
        check(created.status === 201, `Creating answered ${created.status}: ${JSON.stringify(created.body)}`);
        const etag = created.headers.get("etag");
        check(etag, "No ETag came back.");
        const updated = await s.request<CostCentre>("PUT", `/cost-centres/${costCentre}`, {
          body: { name: "Mock ERP projects and services" },
          headers: { "If-Match": etag },
        });
        check(updated.status === 200, `Updating with the current ETag answered ${updated.status}.`);
        const stale = await s.request("PUT", `/cost-centres/${costCentre}`, { body: { name: "Stale" }, headers: { "If-Match": etag } });
        check(stale.status === 412 && problemOf(stale.body).code === "precondition_failed", `The stale write answered ${stale.status}.`);
        return `${costCentre} created, updated, stale write refused with 412`;
      }),

    async () =>
      step("Is refused a field the HRMS owns", async () => {
        const e = [...erp.employees.values()][0];
        const r = await s.request("PATCH", `/employees/${e.id}`, { body: { valid_from: o.today, first_name: "Changed" } });
        check(r.status === 409 && problemOf(r.body).code === "owned_by_hrms", `Expected 409 owned_by_hrms, got ${r.status}.`);
        return "409 owned_by_hrms";
      }),

    async () =>
      step("Is refused what its scopes do not cover", async () => {
        const r = await s.request("POST", "/employees", { body: {} });
        check(r.status === 403 && problemOf(r.body).code === "insufficient_scope", `Expected 403 insufficient_scope, got ${r.status}.`);
        return "403 insufficient_scope for employees:hire";
      }),

    async () =>
      step("Another system hires someone, once, however often it retries", async () => {
        const positions = await erp.all<Position>("/positions");
        const departments = await erp.all<Department>("/departments");
        const vacant = positions.find((p) => p.is_vacant && p.is_active && departments.some((d) => d.code === p.department && d.company));
        check(vacant, "There is no vacant position to hire into. Reset the sandbox (npm run db:reset) and run again.");
        const dept = departments.find((d) => d.code === vacant.department)!;
        const key = randomUUID();
        const body = {
          effective_date: o.today,
          company: dept.company,
          personnel_area: dept.personnel_area,
          department: dept.code,
          position: vacant.code,
          first_name: "Kavya",
          last_name: "Menon",
          basic_pay: { amount: "52000.00", currency: "INR" },
          external_ids: { hr_tool: `HRT-${stamp}` },
        };
        const first = await hr.request<Employee>("POST", "/employees", { body, headers: { "Idempotency-Key": key } });
        check(first.status === 201, `The hire answered ${first.status}: ${JSON.stringify(first.body)}`);
        const again = await hr.request<Employee>("POST", "/employees", { body, headers: { "Idempotency-Key": key } });
        check(again.status === 201 && again.body.id === first.body.id, "Retrying with the same key did not return the same hire.");
        check(again.headers.get("idempotent-replayed") === "true", "The retry was not marked as replayed.");
        hiredId = first.body.id;
        return `${first.body.employee_number} into ${vacant.code}; the retry replayed it`;
      }),

    async () =>
      step("Hears about the hire through a signed webhook", async () => {
        check(hiredId, "No hire to hear about.");
        if (!o.webhookUrl) return "skipped: no receiver";
        const event = await waitFor("employee.hired", () =>
          erp.received.find((e) => e.type === "employee.hired" && e.subject === `employees/${hiredId}`),
        );
        check(erp.refused.length === 0, `Refused deliveries: ${erp.refused.join("; ")}`);
        return `${event.id}, sequence ${event.sequence}, signature verified`;
      }),

    async () =>
      step("Finds the same event in the pull feed", async () => {
        check(hiredId, "No hire to find.");
        const pulled: CloudEvent[] = [];
        const event = await waitFor("employee.hired in the feed", async () => {
          pulled.push(...(await erp.pull()));
          return pulled.find((e) => e.type === "employee.hired" && e.subject === `employees/${hiredId}`);
        });
        const pushed = erp.received.find((e) => e.id === event.id);
        check(!o.webhookUrl || pushed, "The feed's event is not the one the webhook carried.");
        return `${event.id}${pushed ? ", identical to the webhook's" : ""}`;
      }),

    async () =>
      step("Picks the hire up with updated_since", async () => {
        check(hiredId, "No hire to pick up.");
        const r = await erp.sync();
        check(erp.employees.has(hiredId), "The new employee was not in the changes since the last sync.");
        return `${r.changed} changed, ${r.deleted} deleted since the last sync`;
      }),

    async () =>
      step("Sees the new hire's onboarding tasks, and completes one", async () => {
        check(hiredId, "No hire to check tasks for.");
        const tasks = await s.get<{ data: { id: number; status: string }[] }>(`/tasks?employee_id=${hiredId}&status=Pending`);
        check(tasks.status === 200, `Answered ${tasks.status}.`);
        if (tasks.body.data.length === 0) return "no onboarding tasks for this hire";
        const task = tasks.body.data[0];
        const done = await s.request<{ status: string }>("POST", `/tasks/${task.id}/complete`, { headers: { "Idempotency-Key": randomUUID() } });
        check(done.status === 200 && done.body.status === "Done", `Answered ${done.status}: ${JSON.stringify(done.body)}`);
        return `task ${task.id} of ${tasks.body.data.length} marked done`;
      }),

    async () =>
      step("Sends a claim its own process already approved, to be paid through payroll", async () => {
        check(hiredId, "No hire to claim for.");
        const body = {
          employee_id: hiredId,
          category: "FUEL",
          claim_date: o.today,
          lines: [{ date: o.today, description: "Client-site mileage", amount: { amount: "1500.00", currency: "INR" } }],
        };
        const key = randomUUID();
        type ClaimRep = { id: number; status: string; wage_type: string };
        const first = await s.request<ClaimRep>("POST", "/claims", { body, headers: { "Idempotency-Key": key } });
        check(first.status === 201, `Answered ${first.status}: ${JSON.stringify(first.body)}`);
        check(first.body.status === "Approved", `Expected Approved, got ${first.body.status}.`);
        check(first.body.wage_type === "REIMB", `Expected REIMB (fuel is not taxable), got ${first.body.wage_type}.`);
        const again = await s.request<ClaimRep>("POST", "/claims", { body, headers: { "Idempotency-Key": key } });
        check(again.status === 201 && again.body.id === first.body.id, "Retrying with the same key did not return the same claim.");
        return `claim ${first.body.id} for employee ${hiredId}, approved and queued on REIMB`;
      }),

    async () =>
      step("Does not hear its own change back", async () => {
        await o.pump();
        const echoed = erp.received.find((e) => e.type === "cost_centre.changed" && e.subject === `cost-centres/${costCentre}`);
        check(!echoed, "The ERP's own cost centre change came back to it by webhook.");
        const plain = await erp.feed(feedStart);
        check(!plain.events.some((e) => e.subject === `cost-centres/${costCentre}`), "The feed returned the ERP's own change.");
        const own = await erp.feed(feedStart, { includeOwn: true });
        const mine = own.events.find((e) => e.subject === `cost-centres/${costCentre}`);
        check(mine, "include_own=true did not return the ERP's own change.");
        check(mine.originclient === s.clientId, `originclient was ${mine.originclient}.`);
        return "not sent; visible with include_own=true, marked as its own";
      }),

    async () =>
      step("Books a payroll journal and reports the totals", async () => {
        const pending = await s.get<{ data: GlPosting[] }>("/gl-postings?ack_state=pending&limit=5");
        check(pending.status === 200, `Answered ${pending.status}.`);
        const journal = pending.body.data[0];
        if (!journal) return "no journal waiting to be booked";
        const reference = `JV/MOCK/${stamp}`;
        const body = { status: "acknowledged", reference, totals: { debit: journal.total_debit, credit: journal.total_credit } };
        const key = randomUUID();
        const r = await s.request<{ state: string; reference: string }>("POST", `/gl-postings/${journal.id}/acknowledgement`, { body, headers: { "Idempotency-Key": key } });
        check(r.status === 200 && r.body.state === "acknowledged", `Answered ${r.status}: ${JSON.stringify(r.body)}`);
        const booked = await s.get<{ data: GlPosting[] }>("/gl-postings?ack_state=acknowledged&limit=200");
        check(booked.body.data.some((p) => p.id === journal.id && p.acknowledgement.reference === reference), "The journal does not show as booked.");
        return `journal ${journal.id} booked as ${reference}`;
      }),

    async () =>
      step("Confirms salary payments, and flags one it cannot place", async () => {
        const pending = await s.get<{ data: Batch[] }>("/payment-batches?state=pending&limit=5");
        check(pending.status === 200, `Answered ${pending.status}.`);
        const batch = pending.body.data[0];
        if (!batch) return "no payment batch waiting";
        const line = batch.lines.find((l) => l.payment_status === "pending")!;
        const body = {
          items: [
            { employee_id: line.employee_id, status: "paid", reference: `UTR${stamp}`, paid_on: o.today },
            { employee_id: 987654321, status: "paid", reference: `UTR${stamp}X`, paid_on: o.today },
          ],
        };
        type Outcomes = { outcomes: { employee_id: number; outcome: string; issue_id?: number }[] };
        const r = await s.request<Outcomes>("POST", `/payment-batches/${batch.id}/confirmations`, { body, headers: { "Idempotency-Key": randomUUID() } });
        check(r.status === 200, `Answered ${r.status}: ${JSON.stringify(r.body)}`);
        const outcome = (id: number) => r.body.outcomes.find((x) => x.employee_id === id);
        check(outcome(line.employee_id)?.outcome === "applied", "The payment was not applied.");
        const stray = outcome(987654321);
        check(stray?.outcome === "not_in_batch" && stray.issue_id, "The stray payment was not flagged.");
        const twice = await s.request<Outcomes>("POST", `/payment-batches/${batch.id}/confirmations`, { body: { items: [body.items[0]] } });
        check(twice.body.outcomes[0]?.outcome === "unchanged", "Confirming twice changed something.");
        const issues = await s.get<{ data: { id: number; state: string }[] }>("/sync-issues?state=open");
        check(issues.body.data.some((i) => i.id === stray.issue_id), "The sync issue is not listed.");
        return `batch ${batch.id}: one paid, one sent to HR as sync issue ${stray.issue_id}`;
      }),

    async () =>
      step("Downloads a payslip as a PDF for its own portal", async () => {
        const runs = await s.get<{ data: { id: number; status: string }[] }>("/payroll/runs?limit=200");
        check(runs.status === 200, `Answered ${runs.status}.`);
        const run = runs.body.data.find((r) => r.status === "Completed");
        if (!run) return "no payslip to download";
        type Results = { data: { id: number; year_to_date: { financial_year: string; net: Money } }[] };
        const results = await s.get<Results>(`/payroll/runs/${run.id}/results?limit=1`);
        const first = results.body.data[0];
        if (!first) return "no payslip to download";
        check(first.year_to_date?.financial_year, "The result has no year to date.");
        const pdf = await s.download(`/payroll/results/${first.id}/payslip`);
        check(pdf.status === 200 && pdf.contentType === "application/pdf", `Answered ${pdf.status} ${pdf.contentType}.`);
        check(Buffer.from(pdf.bytes.slice(0, 5)).toString() === "%PDF-", "That is not a PDF.");
        return `result ${first.id}: ${pdf.bytes.length} bytes, year to date ${first.year_to_date.net.amount} net in ${first.year_to_date.financial_year}`;
      }),

    async () =>
      step("Is told its rate limit", async () => {
        const r = await s.get("/companies");
        const limit = r.headers.get("ratelimit-limit");
        check(limit && r.headers.get("ratelimit-remaining"), "No RateLimit headers.");
        check(r.headers.get("x-request-id"), "No X-Request-Id.");
        return `${r.headers.get("ratelimit-remaining")} of ${limit} left this minute`;
      }),
  ];

  for (const run of steady) {
    const ok = await run();
    // The first steps are the connection itself; without it nothing else can work.
    if (!ok && steps.length <= 1) break;
  }
  return steps;
}
