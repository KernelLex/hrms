# HRMS API

This is the guide for developers connecting another system to the HRMS — first of all the ERP. It explains how to connect, the conventions every endpoint follows, how to keep a copy of the HRMS's data in step, how the HRMS tells you what changed, and how to send back what your system did. The reference at the end lists every scope, event type, error code and endpoint; it is generated from the code, so it is always current.

- **Base URL:** `https://<hrms-host>/api/v1`. For the current deployment: `https://hrms-amogh24.vercel.app/api/v1`.
- **Interactive reference:** `https://<hrms-host>/developers` — every endpoint with its schemas, and a console to try calls.
- **OpenAPI 3.1 specification:** `https://<hrms-host>/api/v1/openapi.json` — generate a client from it in any language.
- **A working example:** `tools/mock-erp/` in the HRMS repository is a small ERP written against this guide alone. Its scenario (`scenario.ts`) runs every flow described here, and the HRMS test suite runs it on every change.

## Contents

1. [How the two systems divide the work](#1-how-the-two-systems-divide-the-work)
2. [Getting connected](#2-getting-connected)
3. [Authentication](#3-authentication)
4. [Conventions](#4-conventions)
5. [Keeping a copy in step](#5-keeping-a-copy-in-step)
6. [Events and webhooks](#6-events-and-webhooks)
7. [Writing to the HRMS](#7-writing-to-the-hrms)
8. [Payroll: the journal, payments and remittances](#8-payroll-the-journal-payments-and-remittances)
9. [Errors, retries and limits](#9-errors-retries-and-limits)
10. [The sandbox and the mock ERP](#10-the-sandbox-and-the-mock-erp)
11. [Before going live](#11-before-going-live)
12. [Versions and changes](#12-versions-and-changes)
13. [Reference](#13-reference)

## 1. How the two systems divide the work

The HRMS is the system of record for **people**: who works here, in which position, department and company, their dated history, time off, pay and tax. The ERP is the system of record for **money and cost structure**: cost centres, the chart of accounts, the books, and the payments that leave the bank.

Every kind of record has one owner. Only the owner writes it; the other system reads it, and a write from the side that does not own it is refused (`owned_by_hrms` or `owned_by_erp`). The defaults:

| Record | Owner | Meaning |
| --- | --- | --- |
| Employees and their records | HRMS | Hiring, org assignment, personal data, pay. Individual fields (name, work email, cost centre) can be handed to the ERP. |
| Organisation | HRMS | Companies, personnel areas, departments, jobs, positions. |
| Absences | HRMS | Leave and absences. Can be handed to the ERP if it runs time and attendance. |
| Payroll | HRMS | Runs, results, the journal, payment batches, remittances. |
| Cost centres | ERP | The ERP creates and changes them; the HRMS assigns people to them. |
| GL accounts | ERP | The chart of accounts the journal is booked against. |
| Payments | ERP | Whether each salary and remittance was actually paid. |

HR changes ownership on the **Ownership** screen (Administration → Integrations). Read the current state with `GET /ownership`; do not hard-code it.

The flows between the two:

```
HRMS ──── people, org, time, events ─────────────────────▶ ERP
HRMS ──── payroll journal, payment batches, remittances ─▶ ERP
HRMS ◀─── cost centres, GL accounts ─────────────────────── ERP
HRMS ◀─── journal booked / refused, salaries paid / failed ─ ERP
```

## 2. Getting connected

An HR administrator registers your system in the HRMS: **Administration → Integrations → Connect a system**. They choose:

- **Scopes** — what the system may read and write (the [scope reference](#scopes)). The screen suggests the set an ERP needs.
- **Companies** — optionally, the companies it may see. Everything else is invisible to it: lists leave it out and single records answer 404.
- **Allowed addresses** — optionally, the IP addresses calls may come from.
- **System key** — how the system's own ids are labelled in `external_ids` (default `erp`).

They are then shown a **client id** (`cl_…`) and a **client secret** (`hs_…`) — the secret once only. Keep it in your secret store. The HRMS keeps only a hash of it.

## 3. Authentication

The API uses OAuth 2.0 client credentials. Exchange the id and secret for a bearer token, valid for an hour:

```sh
curl -X POST https://<hrms-host>/api/v1/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=cl_4f2a9c7e1b3d \
  -d client_secret=hs_...
```

```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs…", "token_type": "Bearer", "expires_in": 3600, "scope": "org:read employees:read …" }
```

The credentials can also be sent as a JSON body or with HTTP Basic authentication. Then send the token on every call:

```sh
curl https://<hrms-host>/api/v1/employees?limit=10 -H "Authorization: Bearer eyJhbGciOi…"
```

- **Reuse the token** until shortly before it expires; do not take one per call. On a `401` with code `invalid_token`, take a new one and retry once.
- **Fewer scopes:** pass `scope=org:read employees:read` to take a token that carries only those. A token never carries a scope the client does not hold, and if HR removes a scope from the client, tokens already issued lose it at once.
- **Suspension:** if HR suspends the client, its tokens stop working immediately (`401`).
- **Rotating the secret:** HR issues a new secret on the client's screen. The old one keeps working for 24 hours so you can deploy the new one; HR can also stop older secrets at once.

## 4. Conventions

**JSON everywhere**, with `snake_case` names. Unknown fields may be added to responses at any time: ignore what you do not recognise.

**Identifiers.** Employees and transactional records (runs, journals, batches, absences) have integer `id`s. Master data (companies, departments, positions, cost centres, accounts) is identified by its `code`. Your own ids live in `external_ids` (see [section 7](#external-ids)).

**Dates and times.** A date is `YYYY-MM-DD`, a calendar date in India. A timestamp is ISO 8601 in UTC, such as `2026-09-27T09:12:44.103Z`.

**Dated records.** Much of an employee's data is kept as time slices: each record is valid from one date to another. `valid_to: null` means it is open-ended. Read a record as it stood on a date with `as_of=2026-04-01`; read every slice with `GET /employees/{id}/history?record=org_assignment`.

**Money** is always an object with a decimal string, never a number, so nothing is lost to floating point:

```json
{ "amount": "72000.00", "currency": "INR" }
```

Send amounts the same way, with at most two decimal places.

**Sensitive data needs its own scope.** Without `pay:read`, pay fields are *absent* — not null, not zero — from every response and every event: basic pay, run totals, payment amounts. Without `bank:read`, bank account numbers are absent. Every read of someone's pay or bank details through the API is recorded in the HRMS's access log, against your client.

**Pagination.** Lists return a page and a cursor:

```json
{ "data": [ … ], "next_cursor": "Mw" }
```

Pass `cursor=Mw` for the next page, until `next_cursor` is null. `limit` is 50 by default, 200 at most. Cursors are opaque; do not build them.

**Choosing fields.** `fields=id,employee_number,personal` returns only those top-level fields (the `id` or `code` always comes back).

## 5. Keeping a copy in step

The ERP usually keeps its own copy of employees. The recipe:

1. **Once:** page through `GET /employees`. Note the time you *started* (minus a few seconds for clock drift).
2. **Then, regularly:** `GET /employees?updated_since=<that time>` returns only employees with any change since — a new slice, a changed record, a status change. Take the start time again.
3. **Deletions:** `GET /deletions?since=<that time>` lists records deleted since then, so your copy can drop them too.
4. **Better still:** subscribe to [events](#6-events-and-webhooks) for changes as they happen, and keep the periodic `updated_since` pass (nightly, say) as a safety net.

```ts
let since: string | null = null;
async function sync() {
  const started = new Date(Date.now() - 5000).toISOString();
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: "200" });
    if (since) q.set("updated_since", since);
    if (cursor) q.set("cursor", cursor);
    const page = await api.get(`/employees?${q}`);
    for (const e of page.data) upsert(e);
    cursor = page.next_cursor;
  } while (cursor);
  since = started;
}
```

`updated_since` is also accepted by `GET /cost-centres` and `GET /absences`.

## 6. Events and webhooks

Whenever something changes in the HRMS — on a screen, in a background job, or through the API — an **event** is recorded. Events are [CloudEvents](https://cloudevents.io/):

```json
{
  "specversion": "1.0",
  "id": "evt_812_employee_hired",
  "type": "employee.hired",
  "source": "urn:hrms",
  "subject": "employees/7",
  "time": "2026-09-27T09:12:44.103Z",
  "datacontenttype": "application/json",
  "sequence": "41",
  "data": { "id": 7, "employee_number": "EMP1007", "status": "Active", … }
}
```

- `type` says what happened (the [event types](#event-types)). You see only the types your scopes allow, and `data` is shaped by your scopes like any response: no pay without `pay:read`.
- `sequence` increases with every event. Use it to order events and to resume the feed.
- `data` is usually the record as it stands, so most events need no follow-up call.
- `originclient` appears when the change came through the API, naming the client that made it.

There are two ways to receive events. They carry exactly the same events.

### Webhooks

Subscribe a URL (needs `events:read`):

```sh
curl -X POST https://<hrms-host>/api/v1/webhook-subscriptions \
  -H "Authorization: Bearer …" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5f0c…" \
  -d '{"url": "https://erp.example.com/hrms/webhooks", "event_types": ["employee.hired", "gl.posting.created"]}'
```

The answer includes a `secret` (`whsec_…`) — shown this once. Leave `event_types` out to receive every type your scopes allow.

Each event is `POST`ed to your URL with `Content-Type: application/cloudevents+json` and three headers, following the [Standard Webhooks](https://www.standardwebhooks.com/) specification:

| Header | Value |
| --- | --- |
| `webhook-id` | The event id. The same on every retry. |
| `webhook-timestamp` | Unix seconds when this attempt was sent. |
| `webhook-signature` | `v1,<base64 HMAC-SHA256>` — possibly several, space-separated. |

**Verify every delivery** before trusting it: compute HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}` with the secret's bytes (the base64 after `whsec_`), and compare it with each `v1` signature in constant time. Refuse a timestamp more than five minutes from now. Use the raw body exactly as received, before any JSON parsing.

TypeScript (Node):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret: string, headers: Record<string, string>, rawBody: string): boolean {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sigs = headers["webhook-signature"];
  if (!id || !ts || !sigs || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64"));
  return sigs.split(" ").some((s) => {
    const [version, value = ""] = s.split(",");
    const given = Buffer.from(value);
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

Python:

```python
import base64, hashlib, hmac, time

def verify(secret: str, headers: dict, raw_body: bytes) -> bool:
    msg_id, ts, sigs = headers.get("webhook-id"), headers.get("webhook-timestamp"), headers.get("webhook-signature")
    if not (msg_id and ts and sigs) or abs(time.time() - int(ts)) > 300:
        return False
    key = base64.b64decode(secret.removeprefix("whsec_"))
    expected = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + raw_body, hashlib.sha256).digest()).decode()
    return any(v == "v1" and hmac.compare_digest(s, expected)
               for v, _, s in (part.partition(",") for part in sigs.split(" ")))
```

Standard Webhooks publishes ready-made verification libraries for most languages; they work with these deliveries as they are.

**Answer `2xx` within ten seconds**, and do the work afterwards (queue it). Anything else — an error status, a timeout, a refused connection — is retried after 30 seconds, then 1, 2, 4, 8 minutes and so on, capped at an hour between attempts. After ten failed attempts the delivery is **parked**: HR sees it on your client's screen and can send it again once your endpoint is back.

Deliveries are **at least once**: the same event can arrive twice, for instance if your `2xx` was lost. Keep the `webhook-id`s you have handled and ignore repeats. Events can also arrive out of order across retries; compare `sequence` (or the record's `updated_at`) before overwriting newer data with older.

**Your own changes are not sent back to you.** A cost centre you `PUT` does not come back as a `cost_centre.changed` webhook to you, so your system never loops on its own writes. Subscribe with `"include_own": true` if you want them anyway.

List your subscriptions with `GET /webhook-subscriptions` and remove one with `DELETE /webhook-subscriptions/{id}`. HR can pause a subscription that misbehaves.

### The pull feed

A system that would rather ask than be told reads `GET /events?after=<sequence>`:

```sh
curl "https://<hrms-host>/api/v1/events?after=0&limit=200" -H "Authorization: Bearer …"
```

```json
{ "data": [ …events… ], "next_after": 41 }
```

Store `next_after` and pass it next time. When there is nothing new, `data` is empty and `next_after` is unchanged. Filter with `types=employee.hired,employee.updated`; add `include_own=true` to see your own changes too. The feed keeps every event, so a system that was down catches up by reading from where it stopped.

## 7. Writing to the HRMS

Every write goes through the same checks as HR's screens and is recorded in the HRMS's change log under your client's name, so HR can always see what your system changed.

**Hiring.** `POST /employees` (scope `employees:hire`) runs the hire action: the employee, their action, org assignment, personal data, working time and basic pay, and the position marked filled — all or nothing. The position must be vacant (`409 conflict` otherwise). Always send an `Idempotency-Key`: a retry then cannot hire the same person twice.

**Employee fields the ERP owns.** `PATCH /employees/{id}` (scope `employees:write`) changes fields HR has handed to the ERP — first and last name, work email, cost centre — from a date (`valid_from`), keeping the earlier records. A field the HRMS owns is refused with `409 owned_by_hrms`. Send the `ETag` you read as `If-Match`.

**Cost centres and GL accounts.** `PUT /cost-centres/{code}` and `PUT /gl-accounts/{code}` create or replace one (`201` when created, `200` when replaced). Send a new cost centre before moving anyone to it: the HRMS refuses a move to a cost centre it does not know.

**Absences.** `POST /absences` (scope `time:write`) records an absence — only when HR has made the ERP the owner of absences.

**Corrections an employee asks for.** If the ERP has its own employee portal, `POST /employees/{id}/change-requests` (scope `employees:write`) files a correction to that person's personal details, an address, a contact, or their bank account, on their behalf. It is not applied at once: it goes through the same approval as a request made in the HRMS — HR checks it, and a bank change needs a second approver and proof (a cancelled cheque or passbook page, sent base64 in `evidence`; bank changes also need `bank:read`). Approved, it is written from its effective date, keeping the history, and arrives as `employee.updated`; either way the outcome arrives as `change_request.decided`. `GET /change-requests` lists them. Each section's fields:

| Section | Subtype | Fields in `values` |
| --- | --- | --- |
| `personal` | — | `first_name`, `last_name`, `date_of_birth`, `gender` (Female, Male, Other), `marital_status` (Single, Married, Divorced, Widowed), `nationality` |
| `address` | `Permanent` or `Temporary` | `line`, `city`, `state`, `postal_code` (six digits), `country` |
| `contact` | `Mobile phone` or `Email (personal)` | `value` |
| `bank` | — | `bank_name`, `account_number` (9 to 18 digits), `ifsc`, `holder_name` |

**Payments to add to payroll.** `POST /one-off-payments` and `POST /recurring-payments` (scope `payroll:write`) add a payment for someone, for the next payroll run to pay.

<a id="external-ids"></a>**Your ids.** Every record the ERP cares about carries `external_ids`, a map from system key to id. Record yours with `PUT /employees/{id}/external-ids` or in the hire request (`"external_ids": {"erp": "EMP-0107"}`), then find the employee by it: `GET /employees?external_id=EMP-0107`. You never need to store the HRMS's ids if you would rather not.

### Safe updates: ETag and If-Match

Single records come with an `ETag` header. Send it back as `If-Match` when you change the record. If the record changed in between — HR edited it, say — the write is refused with `412 precondition_failed` instead of silently overwriting their change: read it again, reapply your change, and retry.

### Retrying safely: Idempotency-Key

Any `POST` can carry an `Idempotency-Key` header — a UUID you generate per logical operation. If the request is sent again with the same key (because the connection dropped, say), the HRMS does not act twice: it answers with the first response, marked `Idempotent-Replayed: true`. The same key with a *different* request is refused (`422 idempotency_key_reused`); a key whose first request is still running answers `409 idempotency_in_progress` — retry after a second. Keys are kept for seven days. The endpoints that say "Send an Idempotency-Key" in the reference are the ones where it matters most.

## 8. Payroll: the journal, payments and remittances

When HR posts a payroll run, the HRMS produces three things for the ERP. Each has an event, a list endpoint, and a way to report back.

**The journal** (`gl.posting.created`, `GET /gl-postings`, scope `gl:read`). Debits and credits by GL account and cost centre, balanced. Book it, then tell the HRMS:

```sh
curl -X POST https://<hrms-host>/api/v1/gl-postings/12/acknowledgement \
  -H "Authorization: Bearer …" -H "Content-Type: application/json" -H "Idempotency-Key: …" \
  -d '{"status": "acknowledged", "reference": "JV/2026/0912",
       "totals": {"debit": {"amount": "412500.00", "currency": "INR"}, "credit": {"amount": "412500.00", "currency": "INR"}}}'
```

HR sees "Booked in the ERP as JV/2026/0912" on the posting screen, and the reconciliation report compares your totals with the HRMS's. If you cannot book it, send `"status": "rejected"` with a `reason`; HR fixes the cause and re-sends it, which arrives as a fresh `gl.posting.created` event. `GET /gl-postings?ack_state=pending` lists journals you have not answered.

**Payment batches** (`payment_batch.created`, `GET /payment-batches`). Each person's net pay with their bank details (amounts with `pay:read`, account numbers with `bank:read`). Pay them, then confirm, all at once or as the bank reports:

```json
POST /payment-batches/7/confirmations
{ "items": [
    { "employee_id": 3, "status": "paid", "reference": "UTR2610050012", "paid_on": "2026-10-01" },
    { "employee_id": 5, "status": "failed", "reason": "Account closed" } ] }
```

Each item comes back `applied`, `unchanged` (already confirmed) or `not_in_batch`. An item for someone not in the batch is not applied: it becomes a **sync issue** for HR to look at, and you can follow it with `GET /sync-issues`. `GET /payment-batches?state=pending` lists batches with anything unconfirmed.

**Payslips** (`payslip.published`, `GET /payroll/runs/{id}/results`). Each result carries its lines and the **year to date** for the financial year (April to March), summed from the payslips the employee has had so far — the same figures their payslip shows. `payslip.published` says when a payslip became visible to its employee: its month posted, or an off-cycle payment made. For the ERP's own portal, `GET /payroll/results/{id}/payslip` returns the payslip as a PDF (`Content-Type: application/pdf`), exactly as the employee would download it; it is not password-protected, so show it only to that person. Both need `pay:read`.

**Statutory remittances** (`remittance.due`, `GET /remittances`). Provident fund and TDS owed from each run, with due dates. Record the payment with `POST /remittances/{id}/payment`.

## 9. Errors, retries and limits

Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem documents, with `Content-Type: application/problem+json`:

```json
{
  "type": "https://<hrms-host>/developers/errors#owned_by_hrms",
  "title": "This record or field is owned by the HRMS; only the HRMS writes it.",
  "status": 409,
  "code": "owned_by_hrms",
  "detail": "first_name is owned by the HRMS; only HR changes it.",
  "request_id": "0b6f2c1e-7d4a-4e8b-9a51-3c2f8d6e1a90"
}
```

Switch on `code` — it is stable; the wording of `title` and `detail` may change. `type` links to a page explaining the code. Validation failures (`422 validation_failed`) list each problem in `errors`, with the field's `path`. Every response carries an `X-Request-Id` — yours, if you sent one, or a new one — so you can correlate calls with your own logs; quote it to HR when something goes wrong, and they can find the call on your client's screen. The [error code reference](#error-codes) lists every code.

**What to retry:**

| Status | Retry? |
| --- | --- |
| `401 invalid_token` | Take a new token, then retry once. |
| `409 idempotency_in_progress` | After a second, with the same key. |
| `412 precondition_failed` | Read the record again, reapply your change, retry. |
| `429 rate_limited` | After `Retry-After` seconds. |
| `500`, `502`, `503`, `504`, timeouts | With backoff, and the same `Idempotency-Key`. |
| Any other `4xx` | No: the request itself needs fixing. |

**Rate limits.** Each client may make a number of calls a minute — 600 unless HR set another. Every response says where you stand: `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds). Past the limit, calls answer `429` with `Retry-After`.

HR sees your client's latest calls — method, path, status, time and request id — on its screen. Calls are kept for 30 days.

## 10. The sandbox and the mock ERP

For development, run the HRMS locally with a known secret for two ready-made clients:

```sh
# in the HRMS repository
export SANDBOX_CLIENT_SECRET=choose-any-long-value
npm run db:reset        # a fresh local database, seeded with the sandbox clients
npm run dev             # the HRMS on http://localhost:3000
```

| Client id | Secret | Scopes |
| --- | --- | --- |
| `cl_mock_erp` | `$SANDBOX_CLIENT_SECRET` | Everything an ERP needs |
| `cl_sandbox_hr` | `$SANDBOX_CLIENT_SECRET-hr` | `employees:hire employees:read pay:read` — another system that hires, to see events arrive |

Sandbox clients are created only when `SANDBOX_CLIENT_SECRET` is set; production never has them.

Then, in another terminal, `npm run sandbox` runs the mock ERP against it. It listens for webhooks on `http://localhost:4010/webhooks` and walks through every flow in this guide — token, full and incremental sync, its own ids, pushing a cost centre and being stopped from overwriting a newer one, being refused a field the HRMS owns, a hire made by the other system arriving as a signed webhook and in the feed, not hearing its own changes back, booking a journal and confirming payments — printing what each step checked. Its source in `tools/mock-erp/` is a compact example of a client done right.

## 11. Before going live

Check each of these against the sandbox, then against the production HRMS with HR:

- [ ] Tokens are reused until they expire and renewed on `401 invalid_token`; the secret lives in a secret store, never in code or logs.
- [ ] The first full sync pages to the end; later syncs use `updated_since` from the *start* of the previous one, and apply `/deletions`.
- [ ] Webhook signatures are verified on the raw body, with the five-minute timestamp check; deliveries are answered `2xx` within ten seconds and processed afterwards.
- [ ] Repeated deliveries of the same `webhook-id` are ignored; older events never overwrite newer data.
- [ ] Every `POST` carries an `Idempotency-Key`, reused on retry; retries follow the table in section 9.
- [ ] Updates send `If-Match` and handle `412` by reading again.
- [ ] Ownership is read from `GET /ownership`, and `owned_by_hrms` is handled rather than retried.
- [ ] Every journal is acknowledged or rejected; every payment batch line is confirmed paid or failed.
- [ ] Unknown fields and unknown event types are ignored, not treated as errors.
- [ ] The client holds only the scopes it uses; `pay:read` and `bank:read` only if it needs them.
- [ ] If calls come from fixed addresses, HR has set the allowlist.
- [ ] `X-Request-Id` is logged with every failed call.

## 12. Versions and changes

The version is in the path: `/api/v1`. Within v1 the HRMS only makes **additive** changes — new endpoints, new optional fields and parameters, new event types, new error codes — which a client written to this guide handles without change. A change that could break a client (removing or renaming a field, changing a meaning) would come as `/api/v2`, with v1 kept running alongside while clients move.

Whenever the HRMS changes in a way that affects the API, this guide and the reference below are updated in the same change; the reference cannot fall behind the code, because the HRMS's tests fail if it does.

## 13. Reference

Generated from the endpoint definitions, the same ones that validate every request and produce the OpenAPI document.

<!-- endpoint-reference:start (generated by npm run api:docs; do not edit by hand) -->

### Scopes

| Scope | Lets the client |
| --- | --- |
| `org:read` | Read companies, personnel areas, departments, jobs, positions and cost centres |
| `org:write` | Write cost centres, which the ERP owns by default |
| `employees:read` | Read employees and their dated records, without pay, bank or tax identifiers |
| `employees:write` | Change the employee fields the ERP owns, and record the ERP's own ids |
| `employees:hire` | Hire people through the hire action, with the same checks as the screens (sets basic pay) |
| `pay:read` | See salaries and every amount of pay: basic pay, pay results, payment amounts |
| `bank:read` | See bank account numbers |
| `tax_ids:read` | See tax identifiers such as PAN, where they are held (none are held yet) |
| `time:read` | Read holidays, absences, leave requests and leave balances |
| `time:write` | Record absences |
| `payroll:read` | Read payroll periods, runs, payment batches and statutory remittances |
| `payroll:write` | Send one-off and recurring payments, and confirm salary and remittance payments |
| `gl:read` | Read the payroll journal (GL postings) and the chart of accounts |
| `gl:write` | Acknowledge or reject journals, and write the accounts the ERP owns |
| `tax:read` | Read the TDS register |
| `recruitment:read` | Read requisitions and applications |
| `performance:read` | Read appraisal cycles and final ratings |
| `events:read` | Read the event feed and deletions, and manage the client's own webhook subscriptions |

### Event types

| Type | Needs | Means |
| --- | --- | --- |
| `employee.hired` | `employees:read` | Someone was hired — on the screen, through recruitment or through the API. `data` is the employee. |
| `employee.updated` | `employees:read` | Any of an employee's dated records changed. `data` is the employee as of today. |
| `employee.status_changed` | `employees:read` | An employee went on leave, came back, or was terminated. `data` is the employee. |
| `org.changed` | `org:read` | A company, personnel area, sub-area, job or department was created, changed or removed. `data` says which. |
| `position.changed` | `org:read` | A position or its reporting line changed. `data` names the position. |
| `cost_centre.changed` | `org:read` | A cost centre was created or changed. `data` is the cost centre. |
| `leave.requested` | `time:read` | Someone asked for leave. `data` is the request. |
| `leave.approved` | `time:read` | A leave request was approved. `data` is the request. |
| `leave.rejected` | `time:read` | A leave request was rejected. `data` is the request. |
| `leave.cancelled` | `time:read` | A leave request was withdrawn. `data` is the request. |
| `absence.recorded` | `time:read` | An absence was recorded — approved leave, or entered by HR or the ERP. `data` is the absence. |
| `absence.removed` | `time:read` | An absence was removed. `data` has its id. |
| `payroll.run.completed` | `payroll:read` | A payroll run finished calculating. `data` is the run; totals with pay:read. |
| `payroll.period.posted` | `payroll:read` | A payroll month was posted: payslips are final. `data` is the period. |
| `gl.posting.created` | `gl:read` | A payroll journal was posted, ready to book. `data` is the journal with its lines. Acknowledge it. |
| `payment_batch.created` | `payroll:read` | Salaries of a run are ready to pay. `data` is the batch; amounts with pay:read, accounts with bank:read. Confirm it. |
| `payslip.published` | `payroll:read` | A payslip became visible to its employee: its month was posted, or its off-cycle payment made. `data` names it; the PDF is at /payroll/results/{id}/payslip. Net pay with pay:read. |
| `remittance.due` | `payroll:read` | A statutory remittance fell due. `data` is the remittance. |
| `change_request.decided` | `employees:read` | HR decided a correction an employee asked for to their record. `data` says what, from when, and the outcome; an approved change also arrives as employee.updated. |
| `candidate.hired` | `recruitment:read` | An offered candidate became an employee. `data` has the application and the new employee's id. |
| `appraisal.finalised` | `performance:read` | Calibration made a rating final. `data` is the appraisal. |
| `employee.transferred` | `employees:read` | An employee moved to a new position, department or company. `data` is the employee. |
| `employee.promoted` | `employees:read` | An employee moved into a new position with new pay. `data` is the employee; the new basic pay needs pay:read. |
| `employee.confirmed` | `employees:read` | A probation review confirmed someone's employment. `data` is the employee. |
| `onboarding.completed` | `employees:read` | A new joiner's onboarding checklist finished — every task done. `data` is the employee. |
| `letter.issued` | `employees:read` | A letter was issued to an employee from a template. `data` names it; the PDF is at /letters/{id}/pdf. |
| `headcount_request.decided` | `org:read` | A headcount request was approved or rejected. `data` says which, and the position it opened, if any; an approval also arrives as position.changed. |
| `import.completed` | `org:read` | A bulk import finished. `data` is its counts: written, already on record, and could not be read. |

### Error codes

| Code | Status | Means |
| --- | --- | --- |
| <a id="problem-invalid_token"></a>`invalid_token` | 401 | The access token is missing, expired or not valid. Take a new one at /oauth/token. |
| <a id="problem-invalid_client"></a>`invalid_client` | 401 | The client id or secret is wrong, or the client is suspended. |
| <a id="problem-insufficient_scope"></a>`insufficient_scope` | 403 | The token does not carry a scope this call needs. |
| <a id="problem-forbidden_ip"></a>`forbidden_ip` | 403 | Calls from this address are not allowed for this client. |
| <a id="problem-not_found"></a>`not_found` | 404 | Nothing exists at this address, or it is outside the companies the client may see. |
| <a id="problem-method_not_allowed"></a>`method_not_allowed` | 405 | This address does not take that method. |
| <a id="problem-invalid_request"></a>`invalid_request` | 400 | A query parameter or header is missing or malformed. |
| <a id="problem-validation_failed"></a>`validation_failed` | 422 | The body did not pass the same checks the screens apply. |
| <a id="problem-owned_by_hrms"></a>`owned_by_hrms` | 409 | This record or field is owned by the HRMS; only the HRMS writes it. |
| <a id="problem-owned_by_erp"></a>`owned_by_erp` | 409 | This record or field is owned by the ERP; the HRMS does not write it. |
| <a id="problem-precondition_failed"></a>`precondition_failed` | 412 | The record changed since you read it (If-Match did not match). Read it again and retry. |
| <a id="problem-conflict"></a>`conflict` | 409 | The request conflicts with the record's current state. |
| <a id="problem-idempotency_key_reused"></a>`idempotency_key_reused` | 422 | This Idempotency-Key was used before with a different request. |
| <a id="problem-idempotency_in_progress"></a>`idempotency_in_progress` | 409 | A request with this Idempotency-Key is still being handled. Retry shortly. |
| <a id="problem-rate_limited"></a>`rate_limited` | 429 | Too many requests. Wait for the number of seconds in Retry-After. |
| <a id="problem-internal_error"></a>`internal_error` | 500 | Something went wrong on our side. Retry with the same Idempotency-Key; if it persists, send the request id to HR. |

### Endpoints

| Method | Path | Scopes | What it does |
| --- | --- | --- | --- |
| POST | [`/oauth/token`](#post-oauth-token) | none (public) | Take an access token |
| GET | [`/events`](#get-events) | `events:read` | The event feed |
| GET | [`/event-types`](#get-event-types) | any token | The event catalogue |
| GET | [`/deletions`](#get-deletions) | `events:read` | What was deleted |
| GET | [`/webhook-subscriptions`](#get-webhook-subscriptions) | `events:read` | This client's webhook subscriptions |
| POST | [`/webhook-subscriptions`](#post-webhook-subscriptions) | `events:read` | Subscribe to webhooks |
| DELETE | [`/webhook-subscriptions/{id}`](#delete-webhook-subscriptions-id) | `events:read` | Unsubscribe |
| GET | [`/sync-issues`](#get-sync-issues) | any token | What could not be applied |
| GET | [`/employees`](#get-employees) | `employees:read` | List employees |
| GET | [`/employees/{id}`](#get-employees-id) | `employees:read` | Get an employee |
| GET | [`/employees/{id}/history`](#get-employees-id-history) | `employees:read` | An employee's dated history |
| POST | [`/employees`](#post-employees) | `employees:hire` | Hire someone |
| PATCH | [`/employees/{id}`](#patch-employees-id) | `employees:write` | Change fields the ERP owns |
| PUT | [`/employees/{id}/external-ids`](#put-employees-id-external-ids) | `employees:write` | Record your id for an employee |
| POST | [`/employees/{id}/actions`](#post-employees-id-actions) | `employees:write` | Transfer, promote, or decide a probation review |
| GET | [`/tasks`](#get-tasks) | `employees:read` | List onboarding tasks |
| POST | [`/tasks/{id}/complete`](#post-tasks-id-complete) | `employees:write` | Mark an onboarding task done |
| GET | [`/letters`](#get-letters) | `employees:read` | List issued letters |
| GET | [`/letters/{id}/pdf`](#get-letters-id-pdf) | `employees:read` | A letter as a PDF |
| POST | [`/employees/{id}/change-requests`](#post-employees-id-change-requests) | `employees:write` | Ask for a correction |
| GET | [`/change-requests`](#get-change-requests) | `employees:read` | List correction requests |
| GET | [`/companies`](#get-companies) | `org:read` | List companies |
| GET | [`/personnel-areas`](#get-personnel-areas) | `org:read` | List personnel areas |
| GET | [`/departments`](#get-departments) | `org:read` | List departments |
| GET | [`/jobs`](#get-jobs) | `org:read` | List jobs |
| GET | [`/positions`](#get-positions) | `org:read` | List positions |
| GET | [`/cost-centres`](#get-cost-centres) | `org:read` | List cost centres |
| PUT | [`/cost-centres/{code}`](#put-cost-centres-code) | `org:write` | Create or update a cost centre |
| GET | [`/gl-accounts`](#get-gl-accounts) | `gl:read` | List the chart of accounts |
| PUT | [`/gl-accounts/{code}`](#put-gl-accounts-code) | `gl:write` | Create or update an account |
| GET | [`/org-chart`](#get-org-chart) | `org:read` | The org structure as a tree |
| GET | [`/ownership`](#get-ownership) | any token | Who owns what |
| POST | [`/headcount-requests`](#post-headcount-requests) | `org:write` | Ask for a new position |
| GET | [`/headcount-requests`](#get-headcount-requests) | `org:read` | List headcount requests |
| POST | [`/imports`](#post-imports) | any token | Check rows for import (dry run) |
| GET | [`/imports/{id}`](#get-imports-id) | `org:read` | Read an import's status |
| GET | [`/imports/{id}/rows`](#get-imports-id-rows) | `org:read` | Read an import's rows |
| POST | [`/imports/{id}/confirm`](#post-imports-id-confirm) | any token | Write the rows that passed |
| GET | [`/holidays`](#get-holidays) | `time:read` | List public holidays |
| GET | [`/absences`](#get-absences) | `time:read` | List absences |
| POST | [`/absences`](#post-absences) | `time:write` | Record an absence |
| GET | [`/leave-requests`](#get-leave-requests) | `time:read` | List leave requests |
| GET | [`/leave-balances`](#get-leave-balances) | `time:read` | Leave balances for a year |
| GET | [`/payroll/periods`](#get-payroll-periods) | `payroll:read` | List payroll periods |
| GET | [`/payroll/runs`](#get-payroll-runs) | `payroll:read` | List payroll runs |
| GET | [`/payroll/runs/{id}/results`](#get-payroll-runs-id-results) | `payroll:read` + `pay:read` | The results of a run |
| GET | [`/payroll/results/{id}/payslip`](#get-payroll-results-id-payslip) | `payroll:read` + `pay:read` | A payslip as a PDF |
| GET | [`/gl-postings`](#get-gl-postings) | `gl:read` | List payroll journals |
| POST | [`/gl-postings/{id}/acknowledgement`](#post-gl-postings-id-acknowledgement) | `gl:write` | Acknowledge or reject a journal |
| GET | [`/payment-batches`](#get-payment-batches) | `payroll:read` | List payment batches |
| POST | [`/payment-batches/{id}/confirmations`](#post-payment-batches-id-confirmations) | `payroll:write` | Confirm salary payments |
| GET | [`/remittances`](#get-remittances) | `payroll:read` | List statutory remittances |
| POST | [`/remittances/{id}/payment`](#post-remittances-id-payment) | `payroll:write` | Record a remittance as paid |
| GET | [`/one-off-payments`](#get-one-off-payments) | `payroll:read` + `pay:read` | List one-off payments |
| POST | [`/one-off-payments`](#post-one-off-payments) | `payroll:write` | Send a one-off payment |
| GET | [`/recurring-payments`](#get-recurring-payments) | `payroll:read` + `pay:read` | List recurring payments |
| POST | [`/recurring-payments`](#post-recurring-payments) | `payroll:write` | Send a recurring payment |
| GET | [`/tax/register`](#get-tax-register) | `tax:read` | The TDS register |
| GET | [`/requisitions`](#get-requisitions) | `recruitment:read` | List requisitions |
| GET | [`/applications`](#get-applications) | `recruitment:read` | List applications |
| GET | [`/appraisals`](#get-appraisals) | `performance:read` | List appraisals |
| GET | [`/openapi.json`](#get-openapi-json) | none (public) | This API's OpenAPI 3.1 specification |

### Authentication endpoints

#### POST /oauth/token

<a id="post-oauth-token"></a>**Take an access token.** OAuth 2.0 client credentials. Send your client id and secret — as form fields, a JSON body, or HTTP Basic authentication — and get a bearer token valid for an hour. Ask for fewer scopes with `scope`; by default the token carries every scope the client holds.

No token needed. Answers 200.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `grant_type` | string | yes |  |
| `client_id` | string |  |  |
| `client_secret` | string |  |  |
| `scope` | string |  | Space-separated scopes, a subset of the client's. |

```http
POST /api/v1/oauth/token
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "cl_…",
  "client_secret": "hs_…",
  "scope": "employees:read events:read"
}
```

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "employees:read events:read"
}
```

#### GET /openapi.json

<a id="get-openapi-json"></a>**This API's OpenAPI 3.1 specification.**

No token needed. Answers 200.

### Events endpoints

#### GET /events

<a id="get-events"></a>**The event feed.** Every event this client may see, in order, after a sequence number — the same events webhooks carry, for a system that would rather ask than be told. Start with `after=0`, then pass the `next_after` you were given. Your own changes are left out unless `include_own=true`.

Needs `events:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `after` | integer |  | Default `0`. |
| `limit` | integer |  |  |
| `types` | string |  | Comma-separated event types. |
| `include_own` | `true` \\| `false` |  |  |

```http
GET /api/v1/events?after=0&types=employee.hired
```

```json
{
  "data": [
    {
      "specversion": "1.0",
      "id": "evt_812_employee_hired",
      "type": "employee.hired",
      "source": "urn:hrms",
      "subject": "employees/7",
      "time": "2026-09-27T09:12:44.103Z",
      "datacontenttype": "application/json",
      "sequence": "41",
      "data": {
        "id": 7,
        "employee_number": "EMP1007",
        "status": "Active"
      }
    }
  ],
  "next_after": 41
}
```

#### GET /event-types

<a id="get-event-types"></a>**The event catalogue.** Every event type, the scope needed to receive it, and what its data is.

Any valid token. Answers 200.

#### GET /deletions

<a id="get-deletions"></a>**What was deleted.** Records deleted since a moment, so a copy kept by polling `updated_since` can drop them too. Page with `cursor`.

Needs `events:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `since` | timestamp | yes |  |
| `limit` | integer |  |  |
| `cursor` | string |  |  |

```http
GET /api/v1/deletions?since=2026-09-01T00:00:00Z
```

#### GET /webhook-subscriptions

<a id="get-webhook-subscriptions"></a>**This client's webhook subscriptions.**

Needs `events:read`. Answers 200.

#### POST /webhook-subscriptions

<a id="post-webhook-subscriptions"></a>**Subscribe to webhooks.** Events are POSTed to `url` as CloudEvents, signed to the Standard Webhooks specification with the `secret` returned here — shown this once. Answer 2xx within ten seconds; anything else is retried with backoff and parked after ten attempts. Leave `event_types` out for every type the client's scopes allow.

Needs `events:read`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes |  |
| `event_types` | array of string, or null |  |  |
| `include_own` | boolean |  | Default `false`. |

```http
POST /api/v1/webhook-subscriptions
Content-Type: application/json

{
  "url": "https://erp.example.com/hrms/webhooks",
  "event_types": [
    "employee.hired",
    "gl.posting.created"
  ]
}
```

```json
{
  "id": 1,
  "url": "https://erp.example.com/hrms/webhooks",
  "event_types": [
    "employee.hired",
    "gl.posting.created"
  ],
  "include_own": false,
  "active": true,
  "created_at": "2026-09-27T09:00:00.000Z",
  "secret": "whsec_…"
}
```

#### DELETE /webhook-subscriptions/{id}

<a id="delete-webhook-subscriptions-id"></a>**Unsubscribe.**

Needs `events:read`. Answers 204.

| Path parameter | Meaning |
| --- | --- |
| `id` | The subscription's id. |

### Integration endpoints

#### GET /sync-issues

<a id="get-sync-issues"></a>**What could not be applied.** Items this client sent that could not be applied automatically, and what HR did about them.

Any valid token. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `state` | `open` \\| `resolved` \\| `discarded` |  |  |

#### GET /ownership

<a id="get-ownership"></a>**Who owns what.** The owner of each kind of record, and of any field HR has set separately. Only the owner writes it.

Any valid token. Answers 200.

### People endpoints

#### GET /employees

<a id="get-employees"></a>**List employees.** Employees as they stand on `as_of` (today by default), oldest first. With `updated_since`, only those with any change since then — the way to keep a copy in step. With `external_id`, the one employee carrying that id of yours.

Needs `employees:read`. More fields with `pay:read` or `bank:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `as_of` | string |  | A date, YYYY-MM-DD. |
| `updated_since` | timestamp |  | ISO 8601 timestamp. |
| `status` | `Active` \\| `On leave` \\| `Terminated` |  |  |
| `company` | string |  |  |
| `external_id` | string |  | Your own id for the employee, under this client's system key. |

```http
GET /api/v1/employees?limit=1&updated_since=2026-09-01T00:00:00Z
```

```json
{
  "data": [
    {
      "id": 3,
      "employee_number": "EMP1003",
      "status": "Active",
      "hire_date": "2024-03-01",
      "termination_date": null,
      "personal": {
        "first_name": "Arjun",
        "last_name": "Mehta",
        "date_of_birth": "1996-08-14",
        "gender": "Male"
      },
      "org_assignment": {
        "company": "CO01",
        "personnel_area": "PA01",
        "department": {
          "code": "OU0002",
          "name": "Application development"
        },
        "position": {
          "code": "PS0003",
          "title": "Software engineer"
        },
        "cost_centre": "CC-IT-01",
        "valid_from": "2024-03-01",
        "valid_to": null
      },
      "working_time": {
        "work_schedule": "WS01",
        "weekly_hours": 40
      },
      "work_email": "arjun.mehta@acme.example",
      "basic_pay": {
        "amount": {
          "amount": "65000.00",
          "currency": "INR"
        },
        "pay_scale_group": "L2",
        "valid_from": "2025-04-01",
        "valid_to": null
      },
      "external_ids": {
        "erp": "EMP-0042"
      },
      "updated_at": "2026-09-26T10:14:03.221Z"
    }
  ],
  "next_cursor": "Mw"
}
```

#### GET /employees/{id}

<a id="get-employees-id"></a>**Get an employee.** One employee as of `as_of`. The ETag changes whenever the record does; send it back in If-Match when you change the employee.

Needs `employees:read`. More fields with `pay:read` or `bank:read`. Returns an `ETag`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `as_of` | string |  | A date, YYYY-MM-DD. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

```http
GET /api/v1/employees/3
```

#### GET /employees/{id}/history

<a id="get-employees-id-history"></a>**An employee's dated history.** Every dated slice of one kind of record, newest first — what was true when. `basic_pay` needs pay:read and `bank_account` bank:read. `valid_to` null means open-ended.

Needs `employees:read`. More fields with `pay:read` or `bank:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `record` | `action` \\| `org_assignment` \\| `personal_data` \\| `working_time` \\| `basic_pay` \\| `bank_account` | yes |  |

```http
GET /api/v1/employees/3/history?record=org_assignment
```

#### POST /employees

<a id="post-employees"></a>**Hire someone.** The hire action, with exactly the checks HR's screen applies: the employee, their action, org assignment, personal data, working time and basic pay, and the position marked filled — all or nothing. Send an Idempotency-Key so a retry cannot hire twice.

Needs `employees:hire`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `effective_date` | string | yes | A date, YYYY-MM-DD. |
| `action_type` | string |  | Default `"Hire"`. |
| `reason` | string, or null |  |  |
| `company` | string | yes |  |
| `personnel_area` | string, or null |  |  |
| `department` | string | yes |  |
| `position` | string | yes |  |
| `cost_centre` | string, or null |  |  |
| `first_name` | string | yes |  |
| `last_name` | string | yes |  |
| `date_of_birth` | string, or null |  |  |
| `gender` | string, or null |  |  |
| `pay_scale_group` | string, or null |  |  |
| `basic_pay` | Money | yes |  |
| `work_schedule` | string |  | Default `"WS01"`. |
| `external_ids` | object |  |  |

```http
POST /api/v1/employees
Content-Type: application/json

{
  "effective_date": "2026-10-01",
  "company": "CO01",
  "personnel_area": "PA01",
  "department": "OU0002",
  "position": "PS0004",
  "cost_centre": "CC-IT-01",
  "first_name": "Meera",
  "last_name": "Pillai",
  "basic_pay": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "external_ids": {
    "erp": "EMP-0107"
  }
}
```

#### PATCH /employees/{id}

<a id="patch-employees-id"></a>**Change fields the ERP owns.** Changes an employee's fields from `valid_from`, through the same dated records the screens write. Only fields whose owner is the ERP may be sent (see Ownership); anything else is refused with `owned_by_hrms`. Send the ETag you read in If-Match: a stale write is refused with 412.

Needs `employees:write`. Returns an `ETag`; honours `If-Match`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `valid_from` | string | yes | The date the change applies from. Earlier records are kept. |
| `first_name` | string |  |  |
| `last_name` | string |  |  |
| `work_email` | string |  |  |
| `cost_centre` | string |  |  |

```http
PATCH /api/v1/employees/3
Content-Type: application/json

{
  "valid_from": "2026-10-01",
  "cost_centre": "CC-IT-02"
}
```

#### PUT /employees/{id}/external-ids

<a id="put-employees-id-external-ids"></a>**Record your id for an employee.** Stores your system's id for this employee, so you can find them by it (`GET /employees?external_id=`) and see it on every response. Each of your ids belongs to one employee. Send null to remove it.

Needs `employees:write`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `external_id` | string, or null | yes |  |

```http
PUT /api/v1/employees/3/external-ids
Content-Type: application/json

{
  "external_id": "EMP-0042"
}
```

#### POST /employees/{id}/actions

<a id="post-employees-id-actions"></a>**Transfer, promote, or decide a probation review.** The same guided actions the Career screen offers: moving someone to a new position (`transfer`), moving them up with new pay (`promotion`), or deciding a pending probation review (`confirmation`, with `outcome` confirm, extend or end). A transfer or promotion arrives as `employee.transferred` or `employee.promoted`; a confirmation as `employee.confirmed`, or as `employee.status_changed` if the outcome ends the employment. A promotion needs pay:read.

Needs `employees:write`. More fields with `pay:read` or `bank:read`. Send an `Idempotency-Key`. Returns an `ETag`; honours `If-Match`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

```http
POST /api/v1/employees/3/actions
Content-Type: application/json

{
  "action": "transfer",
  "effective_date": "2026-11-01",
  "company": "CO01",
  "department": "OU0003",
  "position": "PS0007"
}
```

#### GET /tasks

<a id="get-tasks"></a>**List onboarding tasks.** Tasks from onboarding checklists, oldest due first. Filter with `employee_id` and `status`.

Needs `employees:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `status` | `Pending` \\| `Done` |  |  |

#### POST /tasks/{id}/complete

<a id="post-tasks-id-complete"></a>**Mark an onboarding task done.** Marks one task done, as its assignee would. Once every task in the checklist is done, it finishes and `onboarding.completed` fires. Safe to call again on a task already done.

Needs `employees:write`. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The task's id. |

#### GET /letters

<a id="get-letters"></a>**List issued letters.** Letters issued from a template — appointment, experience, relieving, and so on — newest first. Filter with `employee_id`. The PDF is at `GET /letters/{id}/pdf`.

Needs `employees:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |

#### GET /letters/{id}/pdf

<a id="get-letters-id-pdf"></a>**A letter as a PDF.** One letter as the PDF issued, re-rendered from the text it was issued with — never from the template, which may have moved on since.

Needs `employees:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The letter's id. |

#### POST /employees/{id}/change-requests

<a id="post-employees-id-change-requests"></a>**Ask for a correction.** Files a correction to an employee's personal details, an address, a contact, or their bank account, on their behalf — from the ERP's own employee portal, say. It goes through the same approval as one made on My profile: HR checks it, and a bank change needs a second approver. Approved, it is written from its effective date and arrives as `employee.updated`; the outcome arrives as `change_request.decided`. A bank change needs bank:read.

Needs `employees:write`. More fields with `bank:read`. Send an `Idempotency-Key`. Answers 201.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `section` | `personal` \\| `address` \\| `contact` \\| `bank` | yes |  |
| `subtype` | string, or null |  | For an address: Permanent or Temporary. For a contact: Mobile phone or Email (personal). |
| `values` | object | yes | The section's fields, as the section lists them (see the ChangeRequest reference in API.md). |
| `effective_date` | string | yes | The day it applies from. A bank change: today or later. |
| `note` | string, or null |  |  |
| `evidence` | object, or null |  | Proof: a PDF, JPEG or PNG up to 4 MB. Required for a bank change. |

```http
POST /api/v1/employees/3/change-requests
Content-Type: application/json

{
  "section": "address",
  "subtype": "Permanent",
  "values": {
    "line": "22 New Street, Indiranagar",
    "city": "Bengaluru",
    "state": "Karnataka",
    "postal_code": "560038",
    "country": "India"
  },
  "effective_date": "2026-10-01",
  "note": "Moved house"
}
```

#### GET /change-requests

<a id="get-change-requests"></a>**List correction requests.** Correction requests, oldest first, whoever filed them. Filter with `status` and `employee_id`.

Needs `employees:read`. More fields with `bank:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` |  |  |
| `employee_id` | integer |  |  |

### Organisation endpoints

#### GET /companies

<a id="get-companies"></a>**List companies.**

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /personnel-areas

<a id="get-personnel-areas"></a>**List personnel areas.** Locations within a company.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /departments

<a id="get-departments"></a>**List departments.** Org units, with their parent, so the tree can be rebuilt.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /jobs

<a id="get-jobs"></a>**List jobs.**

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /positions

<a id="get-positions"></a>**List positions.** Every position with its reporting line, whether it is vacant, and who holds it today.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /cost-centres

<a id="get-cost-centres"></a>**List cost centres.** Cost centres as the ERP last sent them.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `updated_since` | timestamp |  |  |

#### PUT /cost-centres/{code}

<a id="put-cost-centres-code"></a>**Create or update a cost centre.** Creates the cost centre, or replaces it. Cost centres are owned by the ERP by default; if HR has made the HRMS their owner, this is refused with `owned_by_hrms`. Send the ETag in If-Match to update safely: a stale write is refused with 412.

Needs `org:write`. Returns an `ETag`; honours `If-Match`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `code` | The cost centre's code, which is also its id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `company` | string, or null |  |  |
| `is_active` | boolean |  | Default `true`. |

```http
PUT /api/v1/cost-centres/CC-IT-02
Content-Type: application/json

{
  "name": "Platform engineering",
  "company": "CO01",
  "is_active": true
}
```

#### GET /org-chart

<a id="get-org-chart"></a>**The org structure as a tree.** Departments nested under their parent, each with the positions that sit in it. A position names what it reports to, so the reporting line — which can cross departments — is reconstructable from the flat list even though the tree nests by department. For a company the client is not scoped to, nothing is returned.

Needs `org:read`. Answers 200.

#### POST /headcount-requests

<a id="post-headcount-requests"></a>**Ask for a new position.** Files a headcount request against a department and job that already exist, and starts its approval (manager, then HR, then a finance role by default). Approved, it opens a vacant position — the same one recruitment opens a requisition against — and arrives as `headcount_request.decided`; the new position also arrives as `position.changed`.

Needs `org:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `org_unit_code` | string | yes |  |
| `job_code` | string | yes |  |
| `title` | string | yes |  |
| `grade` | string, or null |  |  |
| `budget` | Money | yes |  |
| `reason` | string, or null |  |  |

```http
POST /api/v1/headcount-requests
Content-Type: application/json

{
  "org_unit_code": "OU0002",
  "job_code": "JB0001",
  "title": "Backend engineer",
  "grade": "L3",
  "budget": {
    "amount": "90000.00",
    "currency": "INR"
  },
  "reason": "Growing the platform team."
}
```

#### GET /headcount-requests

<a id="get-headcount-requests"></a>**List headcount requests.** Oldest first. Filter with `status`.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` |  |  |

#### POST /imports

<a id="post-imports"></a>**Check rows for import (dry run).** Validates rows for one of the import kinds without writing anything, exactly as uploading a spreadsheet does — the same row-by-row checks, including whether each is already on record. Read the report (`GET /imports/{id}`, `GET /imports/{id}/rows`), then `POST /imports/{id}/confirm` to write what passed. Needs org:write for positions, employees:write for employees and opening balances.

Any valid token. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `org_structure` \\| `employees` \\| `opening_balances` | yes |  |
| `rows` | array of object | yes |  |

```http
POST /api/v1/imports
Content-Type: application/json

{
  "kind": "employees",
  "rows": [
    {
      "employee_number": "EMP2050",
      "first_name": "Meera",
      "last_name": "Nair",
      "hire_date": "2023-05-02",
      "company_code": "CO01",
      "org_unit_code": "OU0002",
      "position_code": "PS0101",
      "basic_pay": "68000",
      "work_schedule_code": "WS01"
    }
  ]
}
```

#### GET /imports/{id}

<a id="get-imports-id"></a>**Read an import's status.** The counts so far: checked, written, already on record, and could not be read.

Needs `org:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

#### GET /imports/{id}/rows

<a id="get-imports-id-rows"></a>**Read an import's rows.** Every row with its outcome and, for one that failed, why. Filter with `outcome`.

Needs `org:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `outcome` | `ok` \\| `written` \\| `skipped` \\| `error` |  |  |

#### POST /imports/{id}/confirm

<a id="post-imports-id-confirm"></a>**Write the rows that passed.** Commits every row still marked `ok`, in the background — a batch at a time, so a large file does not depend on one request. Poll `GET /imports/{id}` for progress; a completed import arrives as `import.completed`.

Any valid token. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

### Payroll journal endpoints

#### GET /gl-accounts

<a id="get-gl-accounts"></a>**List the chart of accounts.** Accounts as the ERP last sent them.

Needs `gl:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### PUT /gl-accounts/{code}

<a id="put-gl-accounts-code"></a>**Create or update an account.** The chart of accounts is owned by the ERP by default. Same ownership and If-Match rules as cost centres.

Needs `gl:write`. Returns an `ETag`; honours `If-Match`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `code` | The account's code. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `kind` | `expense` \\| `liability` \\| `asset` | yes |  |
| `is_active` | boolean |  | Default `true`. |

```http
PUT /api/v1/gl-accounts/5010
Content-Type: application/json

{
  "name": "Salaries and wages",
  "kind": "expense"
}
```

#### GET /gl-postings

<a id="get-gl-postings"></a>**List payroll journals.** Each run's journal, balanced, by account and cost centre, with its acknowledgement state. Poll with `ack_state=pending` to find journals still to book, or listen for `gl.posting.created`.

Needs `gl:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `ack_state` | `pending` \\| `acknowledged` \\| `rejected` |  |  |

#### POST /gl-postings/{id}/acknowledgement

<a id="post-gl-postings-id-acknowledgement"></a>**Acknowledge or reject a journal.** Tells the HRMS the journal was booked, with your document number — or refused, with the reason. HR sees it on the posting screen: "Booked in the ERP as JV/2026/0912". Optionally send the totals you booked; the reconciliation report compares them with ours.

Needs `gl:write`. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The journal's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `acknowledged` \\| `rejected` | yes |  |
| `reference` | string, or null |  |  |
| `reason` | string, or null |  |  |
| `totals` | object, or null |  |  |

```http
POST /api/v1/gl-postings/12/acknowledgement
Content-Type: application/json

{
  "status": "acknowledged",
  "reference": "JV/2026/0912",
  "totals": {
    "debit": {
      "amount": "412500.00",
      "currency": "INR"
    },
    "credit": {
      "amount": "412500.00",
      "currency": "INR"
    }
  }
}
```

### Time endpoints

#### GET /holidays

<a id="get-holidays"></a>**List public holidays.**

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `year` | integer |  |  |

#### GET /absences

<a id="get-absences"></a>**List absences.** Recorded absences — approved leave and absences HR or the ERP entered. With `updated_since`, only those recorded since.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `from` | string |  | Absences ending on or after this date. |
| `to` | string |  | Absences starting on or before this date. |
| `updated_since` | timestamp |  |  |

#### POST /absences

<a id="post-absences"></a>**Record an absence.** Records an absence with the same checks HR's screen applies; working days are counted against the schedule and holidays. Absences are owned by the HRMS by default: HR must make the ERP their owner before it may send them. Send an Idempotency-Key.

Needs `time:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes | An absence type code, such as 0300 for unpaid leave. |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string | yes | A date, YYYY-MM-DD. |
| `remarks` | string, or null |  |  |

```http
POST /api/v1/absences
Content-Type: application/json

{
  "employee_id": 3,
  "absence_type": "0100",
  "start_date": "2026-10-05",
  "end_date": "2026-10-06",
  "remarks": "Sick, from the ERP's attendance"
}
```

#### GET /leave-requests

<a id="get-leave-requests"></a>**List leave requests.**

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` |  |  |
| `employee_id` | integer |  |  |

#### GET /leave-balances

<a id="get-leave-balances"></a>**Leave balances for a year.**

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | integer | yes |  |
| `employee_id` | integer |  |  |

```http
GET /api/v1/leave-balances?year=2026&employee_id=3
```

### Payroll endpoints

#### GET /payroll/periods

<a id="get-payroll-periods"></a>**List payroll periods.**

Needs `payroll:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Open` \\| `Locked` \\| `Posted` |  |  |

#### GET /payroll/runs

<a id="get-payroll-runs"></a>**List payroll runs.**

Needs `payroll:read`. More fields with `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `period_id` | integer |  |  |

#### GET /payroll/runs/{id}/results

<a id="get-payroll-runs-id-results"></a>**The results of a run.** Each person's gross, net and every line — what their payslip shows — with the year to date. Needs pay:read. Each payslip's PDF is at /payroll/results/{id}/payslip.

Needs `payroll:read` and `pay:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The run's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

#### GET /payroll/results/{id}/payslip

<a id="get-payroll-results-id-payslip"></a>**A payslip as a PDF.** One person's payslip as the PDF they would download, with the year to date — for the ERP's own portal to show. Not password-protected: show it only to that person. Needs pay:read.

Needs `payroll:read` and `pay:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The payroll result's id, from the run's results. |

### Payments endpoints

#### GET /payment-batches

<a id="get-payment-batches"></a>**List payment batches.** The salaries of each run for the ERP to pay. Amounts need pay:read and account numbers bank:read. Filter with `state=pending` for batches with anything still unconfirmed.

Needs `payroll:read`. More fields with `pay:read` or `bank:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `state` | `pending` \\| `complete` |  |  |

#### POST /payment-batches/{id}/confirmations

<a id="post-payment-batches-id-confirmations"></a>**Confirm salary payments.** Marks each person's salary paid (with the bank's reference) or failed (with the reason). Items for people not in the batch are not applied: they come back as `not_in_batch` and open a sync issue for HR. Confirming the same item twice changes nothing.

Needs `payroll:write`. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The payment batch's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `items` | array of object | yes |  |

```http
POST /api/v1/payment-batches/7/confirmations
Content-Type: application/json

{
  "items": [
    {
      "employee_id": 3,
      "status": "paid",
      "reference": "UTR2610050012",
      "paid_on": "2026-10-01"
    }
  ]
}
```

#### GET /remittances

<a id="get-remittances"></a>**List statutory remittances.** Provident fund and TDS owed to each authority from each run, with their due dates.

Needs `payroll:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Due` \\| `Remitted` |  |  |

#### POST /remittances/{id}/payment

<a id="post-remittances-id-payment"></a>**Record a remittance as paid.**

Needs `payroll:write`. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The remittance's id. |

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reference` | string | yes | The challan or bank reference. |
| `paid_on` | string, or null |  |  |

```http
POST /api/v1/remittances/4/payment
Content-Type: application/json

{
  "reference": "CIN 0510026120900012",
  "paid_on": "2026-10-07"
}
```

#### GET /one-off-payments

<a id="get-one-off-payments"></a>**List one-off payments.**

Needs `payroll:read` and `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |

#### POST /one-off-payments

<a id="post-one-off-payments"></a>**Send a one-off payment.** An earning or deduction that starts in the ERP — a sales incentive, a canteen recovery — paid once by the next run of its month, or by an off-cycle run. Send an Idempotency-Key: a retry must not pay twice.

Needs `payroll:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `payment_date` | string | yes | A date, YYYY-MM-DD. |

```http
POST /api/v1/one-off-payments
Content-Type: application/json

{
  "employee_id": 3,
  "wage_type": "BONUS",
  "amount": {
    "amount": "15000.00",
    "currency": "INR"
  },
  "payment_date": "2026-10-31"
}
```

#### GET /recurring-payments

<a id="get-recurring-payments"></a>**List recurring payments.**

Needs `payroll:read` and `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |

#### POST /recurring-payments

<a id="post-recurring-payments"></a>**Send a recurring payment.** An earning or deduction paid every month between two dates; `end_date` null for open-ended. Send an Idempotency-Key.

Needs `payroll:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string, or null |  |  |

```http
POST /api/v1/recurring-payments
Content-Type: application/json

{
  "employee_id": 3,
  "wage_type": "CANTEEN",
  "amount": {
    "amount": "1200.00",
    "currency": "INR"
  },
  "start_date": "2026-10-01",
  "end_date": null
}
```

### Tax endpoints

#### GET /tax/register

<a id="get-tax-register"></a>**The TDS register.** Tax deducted per employee and quarter, with the challan it was deposited under.

Needs `tax:read`. More fields with `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `financial_year` | string |  | Such as 2026-27. |

### Recruitment endpoints

#### GET /requisitions

<a id="get-requisitions"></a>**List requisitions.** Open and past hiring: each vacant position and the role it offers, as HR described it. Filter with `status` and `published`.

Needs `recruitment:read`. More fields with `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Open` \\| `On hold` \\| `Closed` |  |  |
| `published` | `true` \\| `false` |  | Only those on, or off, the careers page. |

#### GET /applications

<a id="get-applications"></a>**List applications.** Where each candidate stands against each requisition, with their interview rounds. Filter with `requisition_id` and `stage`. Candidates' personal details and interview notes stay in the HRMS; a hire arrives as the `candidate.hired` event and the new employee.

Needs `recruitment:read`. More fields with `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `requisition_id` | integer |  |  |
| `stage` | `Applied` \\| `Interviewing` \\| `Selected` \\| `Offered` \\| `Hired` |  |  |

### Performance endpoints

#### GET /appraisals

<a id="get-appraisals"></a>**List appraisals.** Each person's appraisal in a cycle, with the final rating once calibration has finalised it. Self and manager ratings are not exposed.

Needs `performance:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `cycle_id` | integer |  |  |

<!-- endpoint-reference:end -->
