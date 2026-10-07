# HRMS API

This is the guide for developers connecting another system to the HRMS — first of all the ERP. It explains how to connect, the conventions every endpoint follows, how to keep a copy of the HRMS's data in step, how the HRMS tells you what changed, and how to send back what your system did. The reference at the end lists every scope, event type, error code and endpoint; it is generated from the code, so it is always current.

- **Base URL:** `https://<hrms-host>/api/v1`. For the current deployment: `https://hrms-amogh24.vercel.app/api/v1`.
- **Interactive reference:** `https://<hrms-host>/developers` — every endpoint with its schemas, and a console to try calls.
- **OpenAPI 3.1 specification:** `https://<hrms-host>/api/v1/openapi.json` — generate a client from it in any language.
- **A working example:** `tools/mock-erp/` in the HRMS repository is a small ERP written against this guide alone. Its scenario (`scenario.ts`) runs every flow described here, and the HRMS test suite runs it on every change.

## The contract, in short

If you are here to build against the API and not to read it end to end, this is everything you need to start, and where the rest lives.

**The contract of record is the OpenAPI 3.1 document** at `GET /api/v1/openapi.json`. It carries every endpoint with its path and query parameters, the exact JSON it accepts, the exact JSON it answers with, which fields are mandatory, every error it can return, and the scope each one needs. Generate a client from it rather than hand-writing one. `/developers` is the same document rendered, with a console that makes real calls.

**In this guide:** [every endpoint in one table](#endpoints), then one entry each with its parameters, its request body field by field (type, mandatory, notes), what it answers with field by field, and an example of both in JSON. [Scopes](#scopes), [event types](#event-types) and [error codes](#error-codes) are tables of their own. All of it is generated from the code, so it cannot drift from what the API does.

**Five things are true of every call**, so no endpoint repeats them:

| | |
| --- | --- |
| **Authentication** | `Authorization: Bearer <token>`, from `POST /oauth/token` with your client id and secret. One hour. [Section 3](#3-authentication) |
| **Money** | An object, never a number: `{ "amount": "72000.00", "currency": "INR" }`. [Section 4](#4-conventions) |
| **Paging** | `{ "data": [...], "next_cursor": "Mw" }`; pass `cursor=` until it is null. `limit` 50 by default, 200 at most |
| **Writing twice** | Send `Idempotency-Key: <uuid>` on a POST. A retry with the same key returns the first answer and changes nothing |
| **Failing** | Always `application/problem+json` with a `code`, the same shape every time. [Section 9](#9-errors-retries-and-limits) |

A whole exchange, end to end:

```sh
# 1. A token, good for an hour.
curl -X POST https://<hrms-host>/api/v1/oauth/token \
  -d grant_type=client_credentials -d client_id=cl_4f2a9c7e1b3d -d client_secret=hs_…
# → {"access_token":"eyJhbGciOi…","token_type":"Bearer","expires_in":3600,"scope":"employees:read …"}

# 2. A call with it.
curl "https://<hrms-host>/api/v1/employees?limit=1" -H "Authorization: Bearer eyJhbGciOi…"
# → {"data":[{"id":3,"employee_number":"EMP1003","status":"Active", …}],"next_cursor":"Mw"}

# 3. A write, safe to retry.
curl -X POST https://<hrms-host>/api/v1/absences \
  -H "Authorization: Bearer eyJhbGciOi…" -H "Idempotency-Key: 7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  -H "Content-Type: application/json" \
  -d '{"employee_id":3,"absence_type":"EL","start_date":"2026-11-02","end_date":"2026-11-04"}'

# 4. What a refusal looks like.
# → 422 {"type":"…#validation_failed","title":"…","status":422,"code":"validation_failed",
#        "detail":"start_date is after end_date","request_id":"5a09ae50-…"}
```

**The first thing to agree with us** is who owns which records — [section 1](#1-how-the-two-systems-divide-the-work) — because that decides which of these endpoints you read and which you write.

---

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
| `time:read` | Read holidays, absences, leave requests, leave balances, rosters and attendance days |
| `time:write` | Record absences and leave requests, and send device punches and timesheets |
| `payroll:read` | Read payroll periods, runs, payment batches, statutory remittances and salary structures |
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
| `remittance.paid` | `payroll:read` | A statutory remittance — PF, ESI, TDS, professional tax or LWF — was marked remitted. `data` is the remittance. |
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
| `leave_balance.changed` | `time:read` | A leave balance moved — accrual, use, a carry-forward, a lapse, an encashment or a manual adjustment. `data` is the balance and what last moved it. |
| `leave.encashed` | `time:read` | Leave was encashed at the policy's daily rate, queued as a one-off payment. `data` is the payment; the amount needs pay:read. |
| `attendance.day_finalised` | `time:read` | A rostered day's punches were turned into worked minutes, a late mark, and overtime if any. `data` is the attendance day. |
| `regularisation.decided` | `time:read` | An attendance correction was approved or rejected. `data` says which; an approval also arrives as attendance.day_finalised. |
| `loan.approved` | `payroll:read` | A loan was approved and its EMI schedule generated. `data` is the loan from GET /loans, with its schedule — book the receivable from it. Amounts need pay:read. |
| `loan.closed` | `payroll:read` | A loan recovered its last instalment, was prepaid in full, or was closed by hand. `data` is the loan; amounts need pay:read. |
| `claim.approved` | `payroll:read` | A reimbursement claim was approved, on screen or sent in already approved by the ERP. `data` is the claim; the amount needs pay:read. |
| `claim.paid` | `payroll:read` | An approved claim was queued to be paid, on the wage type its category's taxability picked — CLAIM if taxable, REIMB if not. `data` is the payment; the amount needs pay:read. |
| `employee.resigned` | `employees:read` | An exit was approved and the last day fixed. `data` is the employee. |
| `employee.exited` | `employees:read` | An employee's last day arrived: sign-in was disabled, their position freed, and their settlement paid. `data` is the employee — close their accounts, recover assets and stop access. |
| `settlement.paid` | `payroll:read` | A full and final settlement was paid in one off-cycle run. `data` is the settlement with every component; amounts need pay:read. |

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
| GET | [`/imports/{id}/rows`](#get-imports-id-rows) | any token | Read an import's rows |
| POST | [`/imports/{id}/confirm`](#post-imports-id-confirm) | any token | Write the rows that passed |
| GET | [`/holidays`](#get-holidays) | `time:read` | List public holidays |
| GET | [`/absences`](#get-absences) | `time:read` | List absences |
| POST | [`/absences`](#post-absences) | `time:write` | Record an absence |
| GET | [`/leave-requests`](#get-leave-requests) | `time:read` | List leave requests |
| GET | [`/leave-balances`](#get-leave-balances) | `time:read` | Leave balances for a year |
| GET | [`/leave-ledger`](#get-leave-ledger) | `time:read` | Leave ledger entries |
| GET | [`/leave-policies`](#get-leave-policies) | `time:read` | List leave policies |
| GET | [`/holiday-calendars`](#get-holiday-calendars) | `time:read` | List holiday calendars |
| POST | [`/leave-requests`](#post-leave-requests) | `time:write` | Submit a leave request |
| GET | [`/rosters`](#get-rosters) | `time:read` | List roster assignments |
| GET | [`/attendance-days`](#get-attendance-days) | `time:read` | List finalised attendance days |
| POST | [`/punches`](#post-punches) | `time:write` | Record punches |
| POST | [`/timesheets`](#post-timesheets) | `time:write` | Record timesheet hours |
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
| GET | [`/salary-structures`](#get-salary-structures) | `payroll:read` | List salary structures |
| GET | [`/loans`](#get-loans) | `payroll:read` + `pay:read` | List loans |
| POST | [`/claims`](#post-claims) | `payroll:write` | Send a claim already approved in the ERP |
| GET | [`/exits`](#get-exits) | `employees:read` | List exits |
| GET | [`/settlements`](#get-settlements) | `payroll:read` + `pay:read` | List settlements |
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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `access_token` | string | yes |  |
| `token_type` | string | yes |  |
| `expires_in` | integer | yes |  |
| `scope` | string | yes |  |

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

```json
{}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `specversion` | string | yes |  |
| `id` | string | yes |  |
| `type` | string | yes |  |
| `source` | string | yes |  |
| `subject` | string | yes |  |
| `time` | string | yes |  |
| `datacontenttype` | string | yes |  |
| `sequence` | string | yes | Increases with every event: the order to apply them in. |
| `originclient` | string |  | The client whose change caused this, when a client did. |
| `data` | object | yes |  |

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes |  |
| `scope` | string | yes |  |
| `description` | string | yes |  |

```json
{
  "data": [
    {
      "type": "<type>",
      "scope": "<scope>",
      "description": "<description>"
    }
  ]
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `resource` | string | yes |  |
| `id` | string | yes |  |
| `employee_id` | integer, or null | yes |  |
| `deleted_at` | string | yes |  |

```json
{
  "data": [
    {
      "resource": "<resource>",
      "id": "<id>",
      "employee_id": 3,
      "deleted_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /webhook-subscriptions

<a id="get-webhook-subscriptions"></a>**This client's webhook subscriptions.**

Needs `events:read`. Answers 200.

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `url` | string | yes |  |
| `event_types` | array of string, or null | yes |  |
| `include_own` | boolean | yes |  |
| `active` | boolean | yes |  |
| `created_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "url": "<url>",
      "event_types": [
        "<event_types>"
      ],
      "include_own": true,
      "active": true,
      "created_at": "2026-10-01T09:30:00.000Z"
    }
  ]
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `url` | string | yes |  |
| `event_types` | array of string, or null | yes |  |
| `include_own` | boolean | yes |  |
| `active` | boolean | yes |  |
| `created_at` | string | yes |  |
| `secret` | string | yes |  |

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `kind` | string | yes |  |
| `reference` | string, or null | yes |  |
| `reason` | string | yes |  |
| `state` | string | yes |  |
| `created_at` | string | yes |  |
| `resolved_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "kind": "<kind>",
      "reference": "<reference>",
      "reason": "<reason>",
      "state": "<state>",
      "created_at": "2026-10-01T09:30:00.000Z",
      "resolved_at": "2026-10-01T09:30:00.000Z"
    }
  ]
}
```

#### GET /ownership

<a id="get-ownership"></a>**Who owns what.** The owner of each kind of record, and of any field HR has set separately. Only the owner writes it.

Any valid token. Answers 200.

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `record_type` | string | yes |  |
| `field` | string, or null | yes |  |
| `owner` | `hrms` \\| `erp` | yes |  |

```json
{
  "data": [
    {
      "record_type": "<record_type>",
      "field": "<field>",
      "owner": "hrms"
    }
  ]
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_number` | string | yes |  |
| `status` | string | yes | Active, On leave or Terminated. |
| `hire_date` | string | yes | A date, YYYY-MM-DD. |
| `termination_date` | string, or null | yes |  |
| `personal` | object, or null | yes |  |
| `org_assignment` | object, or null | yes |  |
| `working_time` | object, or null | yes |  |
| `work_email` | string, or null | yes |  |
| `basic_pay` | object, or null |  | Present only with the pay:read scope. |
| `bank_account` | object, or null |  | Present only with the bank:read scope. |
| `external_ids` | object | yes | Other systems' ids for this employee: {"erp": "EMP-0042"}. |
| `updated_at` | string, or null | yes | When anything about this employee last changed. |

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_number` | string | yes |  |
| `status` | string | yes | Active, On leave or Terminated. |
| `hire_date` | string | yes | A date, YYYY-MM-DD. |
| `termination_date` | string, or null | yes |  |
| `personal` | object, or null | yes |  |
| `org_assignment` | object, or null | yes |  |
| `working_time` | object, or null | yes |  |
| `work_email` | string, or null | yes |  |
| `basic_pay` | object, or null |  | Present only with the pay:read scope. |
| `bank_account` | object, or null |  | Present only with the bank:read scope. |
| `external_ids` | object | yes | Other systems' ids for this employee: {"erp": "EMP-0042"}. |
| `updated_at` | string, or null | yes | When anything about this employee last changed. |

```json
{
  "id": 3,
  "employee_number": "<employee_number>",
  "status": "<status>",
  "hire_date": "2026-10-01",
  "termination_date": "2026-10-01",
  "personal": {
    "first_name": "<first_name>",
    "last_name": "<last_name>",
    "date_of_birth": "2026-10-01",
    "gender": "<gender>"
  },
  "org_assignment": {
    "company": "<company>",
    "personnel_area": "<personnel_area>",
    "department": {
      "code": "<code>",
      "name": "<name>"
    },
    "position": {
      "code": "<code>",
      "title": "<title>"
    },
    "cost_centre": "<cost_centre>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "working_time": {
    "work_schedule": "<work_schedule>",
    "weekly_hours": 1
  },
  "work_email": "meera.pillai@example.com",
  "basic_pay": {
    "amount": {
      "amount": "58000.00",
      "currency": "INR"
    },
    "pay_scale_group": "<pay_scale_group>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "bank_account": {
    "bank_name": "<bank_name>",
    "account_number": "<account_number>",
    "ifsc": "<ifsc>",
    "holder_name": "<holder_name>"
  },
  "external_ids": {},
  "updated_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /employees/{id}/history

<a id="get-employees-id-history"></a>**An employee's dated history.** Every dated slice of one kind of record, newest first — what was true when. `basic_pay`, `ctc` and `statutory_details` need pay:read, `bank_account` needs bank:read. `valid_to` null means open-ended.

Needs `employees:read`. More fields with `pay:read` or `bank:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The employee's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `record` | `action` \\| `org_assignment` \\| `personal_data` \\| `working_time` \\| `basic_pay` \\| `bank_account` \\| `ctc` \\| `statutory_details` | yes |  |

```http
GET /api/v1/employees/3/history?record=org_assignment
```

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `valid_from` | string | yes | A date, YYYY-MM-DD. |
| `valid_to` | string, or null | yes |  |
| `values` | object | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "valid_from": "<valid_from>",
      "valid_to": "<valid_to>",
      "values": {}
    }
  ]
}
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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_number` | string | yes |  |
| `status` | string | yes | Active, On leave or Terminated. |
| `hire_date` | string | yes | A date, YYYY-MM-DD. |
| `termination_date` | string, or null | yes |  |
| `personal` | object, or null | yes |  |
| `org_assignment` | object, or null | yes |  |
| `working_time` | object, or null | yes |  |
| `work_email` | string, or null | yes |  |
| `basic_pay` | object, or null |  | Present only with the pay:read scope. |
| `bank_account` | object, or null |  | Present only with the bank:read scope. |
| `external_ids` | object | yes | Other systems' ids for this employee: {"erp": "EMP-0042"}. |
| `updated_at` | string, or null | yes | When anything about this employee last changed. |

```json
{
  "id": 3,
  "employee_number": "<employee_number>",
  "status": "<status>",
  "hire_date": "2026-10-01",
  "termination_date": "2026-10-01",
  "personal": {
    "first_name": "<first_name>",
    "last_name": "<last_name>",
    "date_of_birth": "2026-10-01",
    "gender": "<gender>"
  },
  "org_assignment": {
    "company": "<company>",
    "personnel_area": "<personnel_area>",
    "department": {
      "code": "<code>",
      "name": "<name>"
    },
    "position": {
      "code": "<code>",
      "title": "<title>"
    },
    "cost_centre": "<cost_centre>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "working_time": {
    "work_schedule": "<work_schedule>",
    "weekly_hours": 1
  },
  "work_email": "meera.pillai@example.com",
  "basic_pay": {
    "amount": {
      "amount": "58000.00",
      "currency": "INR"
    },
    "pay_scale_group": "<pay_scale_group>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "bank_account": {
    "bank_name": "<bank_name>",
    "account_number": "<account_number>",
    "ifsc": "<ifsc>",
    "holder_name": "<holder_name>"
  },
  "external_ids": {},
  "updated_at": "2026-10-01T09:30:00.000Z"
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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_number` | string | yes |  |
| `status` | string | yes | Active, On leave or Terminated. |
| `hire_date` | string | yes | A date, YYYY-MM-DD. |
| `termination_date` | string, or null | yes |  |
| `personal` | object, or null | yes |  |
| `org_assignment` | object, or null | yes |  |
| `working_time` | object, or null | yes |  |
| `work_email` | string, or null | yes |  |
| `basic_pay` | object, or null |  | Present only with the pay:read scope. |
| `bank_account` | object, or null |  | Present only with the bank:read scope. |
| `external_ids` | object | yes | Other systems' ids for this employee: {"erp": "EMP-0042"}. |
| `updated_at` | string, or null | yes | When anything about this employee last changed. |

```json
{
  "id": 3,
  "employee_number": "<employee_number>",
  "status": "<status>",
  "hire_date": "2026-10-01",
  "termination_date": "2026-10-01",
  "personal": {
    "first_name": "<first_name>",
    "last_name": "<last_name>",
    "date_of_birth": "2026-10-01",
    "gender": "<gender>"
  },
  "org_assignment": {
    "company": "<company>",
    "personnel_area": "<personnel_area>",
    "department": {
      "code": "<code>",
      "name": "<name>"
    },
    "position": {
      "code": "<code>",
      "title": "<title>"
    },
    "cost_centre": "<cost_centre>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "working_time": {
    "work_schedule": "<work_schedule>",
    "weekly_hours": 1
  },
  "work_email": "meera.pillai@example.com",
  "basic_pay": {
    "amount": {
      "amount": "58000.00",
      "currency": "INR"
    },
    "pay_scale_group": "<pay_scale_group>",
    "valid_from": "<valid_from>",
    "valid_to": "<valid_to>"
  },
  "bank_account": {
    "bank_name": "<bank_name>",
    "account_number": "<account_number>",
    "ifsc": "<ifsc>",
    "holder_name": "<holder_name>"
  },
  "external_ids": {},
  "updated_at": "2026-10-01T09:30:00.000Z"
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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `external_ids` | object | yes |  |

```json
{
  "external_ids": {}
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

```json
{}
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `task` | string | yes |  |
| `owner_type` | string | yes |  |
| `due_date` | string | yes | A date, YYYY-MM-DD. |
| `status` | `Pending` \\| `Done` | yes |  |
| `done_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "task": "<task>",
      "owner_type": "<owner_type>",
      "due_date": "2026-10-01",
      "status": "Pending",
      "done_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### POST /tasks/{id}/complete

<a id="post-tasks-id-complete"></a>**Mark an onboarding task done.** Marks one task done, as its assignee would. Once every task in the checklist is done, it finishes and `onboarding.completed` fires. Safe to call again on a task already done.

Needs `employees:write`. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The task's id. |

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `task` | string | yes |  |
| `owner_type` | string | yes |  |
| `due_date` | string | yes | A date, YYYY-MM-DD. |
| `status` | `Pending` \\| `Done` | yes |  |
| `done_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "task": "<task>",
  "owner_type": "<owner_type>",
  "due_date": "2026-10-01",
  "status": "Pending",
  "done_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /letters

<a id="get-letters"></a>**List issued letters.** Letters issued from a template — appointment, experience, relieving, and so on — newest first. Filter with `employee_id`. The PDF is at `GET /letters/{id}/pdf`.

Needs `employees:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `kind` | string | yes |  |
| `issue_date` | string | yes | A date, YYYY-MM-DD. |
| `issued_by` | string | yes |  |
| `issued_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "kind": "<kind>",
      "issue_date": "2026-10-01",
      "issued_by": "<issued_by>",
      "issued_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /letters/{id}/pdf

<a id="get-letters-id-pdf"></a>**A letter as a PDF.** One letter as the PDF issued, re-rendered from the text it was issued with — never from the template, which may have moved on since.

Needs `employees:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The letter's id. |

Answers with `application/pdf` — the file itself, not JSON.

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `section` | `personal` \\| `address` \\| `contact` \\| `bank` | yes |  |
| `subtype` | string, or null | yes | The address type or contact kind, where the section has several. |
| `proposed` | object | yes | The values asked for. An account number shows only its last four digits without bank:read. |
| `effective_date` | string | yes | A date, YYYY-MM-DD. |
| `note` | string, or null | yes |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` | yes |  |
| `channel` | `self` \\| `api` | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |
| `decision_note` | string, or null | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "section": "personal",
  "subtype": "<subtype>",
  "proposed": {},
  "effective_date": "2026-10-01",
  "note": "<note>",
  "status": "Pending",
  "channel": "self",
  "requested_at": "2026-10-01T09:30:00.000Z",
  "decided_at": "2026-10-01T09:30:00.000Z",
  "decision_note": "<decision_note>"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `section` | `personal` \\| `address` \\| `contact` \\| `bank` | yes |  |
| `subtype` | string, or null | yes | The address type or contact kind, where the section has several. |
| `proposed` | object | yes | The values asked for. An account number shows only its last four digits without bank:read. |
| `effective_date` | string | yes | A date, YYYY-MM-DD. |
| `note` | string, or null | yes |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` | yes |  |
| `channel` | `self` \\| `api` | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |
| `decision_note` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "section": "personal",
      "subtype": "<subtype>",
      "proposed": {},
      "effective_date": "2026-10-01",
      "note": "<note>",
      "status": "Pending",
      "channel": "self",
      "requested_at": "2026-10-01T09:30:00.000Z",
      "decided_at": "2026-10-01T09:30:00.000Z",
      "decision_note": "<decision_note>"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /exits

<a id="get-exits"></a>**List exits.** Every resignation, termination and retirement, approved or not. `employee.resigned` fires once approved, `employee.exited` on the last day.

Needs `employees:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Withdrawn` \\| `Settled` |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `exit_type` | `Resignation` \\| `Termination` \\| `Retirement` | yes |  |
| `reason` | string, or null | yes |  |
| `requested_last_day` | string | yes | A date, YYYY-MM-DD. |
| `notice_days` | integer | yes |  |
| `approved_last_day` | string, or null | yes |  |
| `notice_waived` | boolean | yes |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Withdrawn` \\| `Settled` | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |
| `exited_at` | string, or null | yes | Set once the termination has run and sign-in is disabled — the moment employee.exited fires. |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "exit_type": "Resignation",
      "reason": "<reason>",
      "requested_last_day": "<requested_last_day>",
      "notice_days": 1,
      "approved_last_day": "<approved_last_day>",
      "notice_waived": true,
      "status": "Pending",
      "requested_at": "2026-10-01T09:30:00.000Z",
      "decided_at": "2026-10-01T09:30:00.000Z",
      "exited_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

### Organisation endpoints

#### GET /companies

<a id="get-companies"></a>**List companies.**

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `city` | string, or null | yes |  |
| `country` | string, or null | yes |  |
| `is_active` | boolean | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "city": "<city>",
      "country": "<country>",
      "is_active": true
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /personnel-areas

<a id="get-personnel-areas"></a>**List personnel areas.** Locations within a company.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `company` | string | yes |  |
| `name` | string | yes |  |
| `location` | string, or null | yes |  |
| `is_active` | boolean | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "company": "<company>",
      "name": "<name>",
      "location": "<location>",
      "is_active": true
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /departments

<a id="get-departments"></a>**List departments.** Org units, with their parent, so the tree can be rebuilt.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `parent` | string, or null | yes |  |
| `company` | string, or null | yes |  |
| `personnel_area` | string, or null | yes |  |
| `valid_from` | string | yes | A date, YYYY-MM-DD. |
| `valid_to` | string, or null | yes |  |
| `is_active` | boolean | yes |  |
| `external_ids` | object | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "parent": "<parent>",
      "company": "<company>",
      "personnel_area": "<personnel_area>",
      "valid_from": "<valid_from>",
      "valid_to": "<valid_to>",
      "is_active": true,
      "external_ids": {}
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /jobs

<a id="get-jobs"></a>**List jobs.**

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `title` | string | yes |  |
| `job_group` | string, or null | yes |  |
| `is_active` | boolean | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "title": "<title>",
      "job_group": "<job_group>",
      "is_active": true
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /positions

<a id="get-positions"></a>**List positions.** Every position with its reporting line, whether it is vacant, and who holds it today.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `title` | string | yes |  |
| `department` | string | yes |  |
| `job` | string | yes |  |
| `reports_to` | string, or null | yes |  |
| `is_manager` | boolean | yes |  |
| `is_vacant` | boolean | yes |  |
| `holder_employee_id` | integer, or null | yes |  |
| `valid_from` | string | yes | A date, YYYY-MM-DD. |
| `valid_to` | string, or null | yes |  |
| `is_active` | boolean | yes |  |
| `external_ids` | object | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "title": "<title>",
      "department": "<department>",
      "job": "<job>",
      "reports_to": "<reports_to>",
      "is_manager": true,
      "is_vacant": true,
      "holder_employee_id": 3,
      "valid_from": "<valid_from>",
      "valid_to": "<valid_to>",
      "is_active": true,
      "external_ids": {}
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /cost-centres

<a id="get-cost-centres"></a>**List cost centres.** Cost centres as the ERP last sent them.

Needs `org:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `updated_since` | timestamp |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `company` | string, or null | yes |  |
| `is_active` | boolean | yes |  |
| `updated_at` | string | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "company": "<company>",
      "is_active": true,
      "updated_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `company` | string, or null | yes |  |
| `is_active` | boolean | yes |  |
| `updated_at` | string | yes |  |

```json
{
  "code": "<code>",
  "name": "<name>",
  "company": "<company>",
  "is_active": true,
  "updated_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /org-chart

<a id="get-org-chart"></a>**The org structure as a tree.** Departments nested under their parent, each with the positions that sit in it. A position names what it reports to, so the reporting line — which can cross departments — is reconstructable from the flat list even though the tree nests by department. For a company the client is not scoped to, nothing is returned.

Needs `org:read`. Answers 200.

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `company` | string | yes |  |
| `positions` | array of OrgChartPosition | yes |  |
| `children` | array of OrgChartUnit | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "company": "<company>",
      "positions": [
        {
          "code": "<code>",
          "title": "<title>",
          "reports_to": "<reports_to>",
          "is_manager": true,
          "is_vacant": true,
          "holder_employee_id": 3
        }
      ],
      "children": [
        {
          "code": "<code>",
          "name": "<name>",
          "company": "<company>",
          "positions": [
            {
              "code": null,
              "title": null,
              "reports_to": null,
              "is_manager": null,
              "is_vacant": null,
              "holder_employee_id": null
            }
          ],
          "children": [
            {
              "code": null,
              "name": null,
              "company": null,
              "positions": null,
              "children": null
            }
          ]
        }
      ]
    }
  ]
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `org_unit_code` | string | yes |  |
| `job_code` | string | yes |  |
| `title` | string | yes |  |
| `grade` | string, or null | yes |  |
| `budget` | Money | yes |  |
| `reason` | string, or null | yes |  |
| `requested_by_name` | string | yes |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` | yes |  |
| `position_code` | string, or null | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "org_unit_code": "<org_unit_code>",
  "job_code": "<job_code>",
  "title": "<title>",
  "grade": "<grade>",
  "budget": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "reason": "<reason>",
  "requested_by_name": "<requested_by_name>",
  "status": "Pending",
  "position_code": "<position_code>",
  "requested_at": "2026-10-01T09:30:00.000Z",
  "decided_at": "2026-10-01T09:30:00.000Z"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `org_unit_code` | string | yes |  |
| `job_code` | string | yes |  |
| `title` | string | yes |  |
| `grade` | string, or null | yes |  |
| `budget` | Money | yes |  |
| `reason` | string, or null | yes |  |
| `requested_by_name` | string | yes |  |
| `status` | `Pending` \\| `Approved` \\| `Rejected` \\| `Cancelled` | yes |  |
| `position_code` | string, or null | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "org_unit_code": "<org_unit_code>",
      "job_code": "<job_code>",
      "title": "<title>",
      "grade": "<grade>",
      "budget": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "reason": "<reason>",
      "requested_by_name": "<requested_by_name>",
      "status": "Pending",
      "position_code": "<position_code>",
      "requested_at": "2026-10-01T09:30:00.000Z",
      "decided_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `kind` | `org_structure` \\| `employees` \\| `opening_balances` | yes |  |
| `file_name` | string, or null | yes |  |
| `status` | `Validating` \\| `Validated` \\| `Importing` \\| `Completed` \\| `Failed` | yes |  |
| `total_rows` | integer | yes |  |
| `ok_rows` | integer | yes |  |
| `error_rows` | integer | yes |  |
| `skipped_rows` | integer | yes |  |
| `written_rows` | integer | yes |  |
| `uploaded_by` | string | yes |  |
| `uploaded_at` | string | yes |  |
| `confirmed_at` | string, or null | yes |  |
| `finished_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "kind": "org_structure",
  "file_name": "<file_name>",
  "status": "Validating",
  "total_rows": 1,
  "ok_rows": 1,
  "error_rows": 1,
  "skipped_rows": 1,
  "written_rows": 1,
  "uploaded_by": "<uploaded_by>",
  "uploaded_at": "2026-10-01T09:30:00.000Z",
  "confirmed_at": "2026-10-01T09:30:00.000Z",
  "finished_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /imports/{id}

<a id="get-imports-id"></a>**Read an import's status.** The counts so far: checked, written, already on record, and could not be read.

Needs `org:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `kind` | `org_structure` \\| `employees` \\| `opening_balances` | yes |  |
| `file_name` | string, or null | yes |  |
| `status` | `Validating` \\| `Validated` \\| `Importing` \\| `Completed` \\| `Failed` | yes |  |
| `total_rows` | integer | yes |  |
| `ok_rows` | integer | yes |  |
| `error_rows` | integer | yes |  |
| `skipped_rows` | integer | yes |  |
| `written_rows` | integer | yes |  |
| `uploaded_by` | string | yes |  |
| `uploaded_at` | string | yes |  |
| `confirmed_at` | string, or null | yes |  |
| `finished_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "kind": "org_structure",
  "file_name": "<file_name>",
  "status": "Validating",
  "total_rows": 1,
  "ok_rows": 1,
  "error_rows": 1,
  "skipped_rows": 1,
  "written_rows": 1,
  "uploaded_by": "<uploaded_by>",
  "uploaded_at": "2026-10-01T09:30:00.000Z",
  "confirmed_at": "2026-10-01T09:30:00.000Z",
  "finished_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /imports/{id}/rows

<a id="get-imports-id-rows"></a>**Read an import's rows.** Every row with its outcome and, for one that failed, why. Filter with `outcome`. A row's own data — an imported employee's pay, say — needs the scope that kind of import needs to write, not just org:read: the same boundary /employees and /payroll keep.

Any valid token. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `outcome` | `ok` \\| `written` \\| `skipped` \\| `error` |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `row_number` | integer | yes |  |
| `key` | string, or null | yes |  |
| `outcome` | `ok` \\| `written` \\| `skipped` \\| `error` | yes |  |
| `messages` | array of string | yes |  |
| `data` | object | yes |  |

```json
{
  "data": [
    {
      "row_number": 1,
      "key": "<key>",
      "outcome": "ok",
      "messages": [
        "<messages>"
      ],
      "data": {}
    }
  ]
}
```

#### POST /imports/{id}/confirm

<a id="post-imports-id-confirm"></a>**Write the rows that passed.** Commits every row still marked `ok`, in the background — a batch at a time, so a large file does not depend on one request. Poll `GET /imports/{id}` for progress; a completed import arrives as `import.completed`.

Any valid token. Send an `Idempotency-Key`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The import's id. |

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `kind` | `org_structure` \\| `employees` \\| `opening_balances` | yes |  |
| `file_name` | string, or null | yes |  |
| `status` | `Validating` \\| `Validated` \\| `Importing` \\| `Completed` \\| `Failed` | yes |  |
| `total_rows` | integer | yes |  |
| `ok_rows` | integer | yes |  |
| `error_rows` | integer | yes |  |
| `skipped_rows` | integer | yes |  |
| `written_rows` | integer | yes |  |
| `uploaded_by` | string | yes |  |
| `uploaded_at` | string | yes |  |
| `confirmed_at` | string, or null | yes |  |
| `finished_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "kind": "org_structure",
  "file_name": "<file_name>",
  "status": "Validating",
  "total_rows": 1,
  "ok_rows": 1,
  "error_rows": 1,
  "skipped_rows": 1,
  "written_rows": 1,
  "uploaded_by": "<uploaded_by>",
  "uploaded_at": "2026-10-01T09:30:00.000Z",
  "confirmed_at": "2026-10-01T09:30:00.000Z",
  "finished_at": "2026-10-01T09:30:00.000Z"
}
```

### Payroll journal endpoints

#### GET /gl-accounts

<a id="get-gl-accounts"></a>**List the chart of accounts.** Accounts as the ERP last sent them.

Needs `gl:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `kind` | `expense` \\| `liability` \\| `asset` | yes |  |
| `is_active` | boolean | yes |  |
| `updated_at` | string | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "kind": "expense",
      "is_active": true,
      "updated_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `kind` | `expense` \\| `liability` \\| `asset` | yes |  |
| `is_active` | boolean | yes |  |
| `updated_at` | string | yes |  |

```json
{
  "code": "<code>",
  "name": "<name>",
  "kind": "expense",
  "is_active": true,
  "updated_at": "2026-10-01T09:30:00.000Z"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `run_id` | integer | yes |  |
| `posting_date` | string | yes | A date, YYYY-MM-DD. |
| `posted_at` | string | yes |  |
| `total_debit` | Money | yes |  |
| `total_credit` | Money | yes |  |
| `lines` | array of object | yes |  |
| `acknowledgement` | Acknowledgement | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "run_id": 3,
      "posting_date": "2026-10-01",
      "posted_at": "2026-10-01T09:30:00.000Z",
      "total_debit": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "total_credit": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "lines": [
        {
          "gl_account": "<gl_account>",
          "description": "<description>",
          "cost_centre": "<cost_centre>",
          "debit": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "credit": {
            "amount": "58000.00",
            "currency": "INR"
          }
        }
      ],
      "acknowledgement": {
        "state": "pending",
        "reference": "<reference>",
        "reason": "<reason>",
        "updated_at": "2026-10-01T09:30:00.000Z"
      }
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `state` | `pending` \\| `acknowledged` \\| `rejected` | yes |  |
| `reference` | string, or null | yes |  |
| `reason` | string, or null | yes |  |
| `updated_at` | string, or null | yes |  |

```json
{
  "state": "pending",
  "reference": "<reference>",
  "reason": "<reason>",
  "updated_at": "2026-10-01T09:30:00.000Z"
}
```

### Time endpoints

#### GET /holidays

<a id="get-holidays"></a>**List public holidays.** Filter with `calendar` for one holiday calendar's own list — see /holiday-calendars for the codes.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `year` | integer |  |  |
| `calendar` | string |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `date` | string | yes | A date, YYYY-MM-DD. |
| `name` | string | yes |  |
| `calendar` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "date": "<date>",
      "name": "<name>",
      "calendar": "<calendar>"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string | yes | A date, YYYY-MM-DD. |
| `working_days` | number | yes |  |
| `calendar_days` | number | yes |  |
| `half_day` | boolean | yes |  |
| `remarks` | string, or null | yes |  |
| `from_leave_request_id` | integer, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "absence_type": "<absence_type>",
      "start_date": "2026-10-01",
      "end_date": "2026-10-01",
      "working_days": 1,
      "calendar_days": 1,
      "half_day": true,
      "remarks": "<remarks>",
      "from_leave_request_id": 3,
      "created_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string | yes | A date, YYYY-MM-DD. |
| `working_days` | number | yes |  |
| `calendar_days` | number | yes |  |
| `half_day` | boolean | yes |  |
| `remarks` | string, or null | yes |  |
| `from_leave_request_id` | integer, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "absence_type": "<absence_type>",
  "start_date": "2026-10-01",
  "end_date": "2026-10-01",
  "working_days": 1,
  "calendar_days": 1,
  "half_day": true,
  "remarks": "<remarks>",
  "from_leave_request_id": 3,
  "created_at": "2026-10-01T09:30:00.000Z"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes |  |
| `from_date` | string | yes | A date, YYYY-MM-DD. |
| `to_date` | string | yes | A date, YYYY-MM-DD. |
| `working_days` | number | yes |  |
| `half_day` | boolean | yes |  |
| `reason` | string, or null | yes |  |
| `status` | string | yes | Pending, Approved, Rejected or Cancelled. |
| `submitted_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "absence_type": "<absence_type>",
      "from_date": "2026-10-01",
      "to_date": "2026-10-01",
      "working_days": 1,
      "half_day": true,
      "reason": "<reason>",
      "status": "<status>",
      "submitted_at": "2026-10-01T09:30:00.000Z",
      "decided_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /leave-balances

<a id="get-leave-balances"></a>**Leave balances for a year.** With `as_of`, each row also carries `forecast_days`: the balance projected to that date — the same forecast My leave shows, current balance plus whatever monthly accrual falls before then.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | integer | yes |  |
| `employee_id` | integer |  |  |
| `as_of` | string |  | A date, YYYY-MM-DD. |

```http
GET /api/v1/leave-balances?year=2026&employee_id=3
```

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `quota_type` | string | yes |  |
| `year` | integer | yes |  |
| `entitled_days` | number | yes |  |
| `used_days` | number | yes |  |
| `remaining_days` | number | yes |  |
| `forecast_days` | number |  | Present only with `as_of`: the balance projected to that date. |

```json
{
  "data": [
    {
      "employee_id": 3,
      "quota_type": "<quota_type>",
      "year": 1,
      "entitled_days": 1,
      "used_days": 1,
      "remaining_days": 1,
      "forecast_days": 1
    }
  ]
}
```

#### GET /leave-ledger

<a id="get-leave-ledger"></a>**Leave ledger entries.** Every credit and debit behind a balance — accrual, use, a carry-forward, a lapse, an encashment or a manual adjustment. `employee_id` is required; filter further with `quota_type` and `year`.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer | yes |  |
| `quota_type` | string |  |  |
| `year` | integer |  |  |

```http
GET /api/v1/leave-ledger?employee_id=3&year=2026
```

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `quota_type` | string | yes |  |
| `year` | integer | yes |  |
| `entry_type` | `Accrual` \\| `Use` \\| `Restore` \\| `CarryForward` \\| `Lapse` \\| `Encashment` \\| `Adjustment` | yes |  |
| `days` | number | yes | Signed: positive credits, negative debits. |
| `note` | string, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "quota_type": "<quota_type>",
      "year": 1,
      "entry_type": "Accrual",
      "days": 1,
      "note": "<note>",
      "created_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /leave-policies

<a id="get-leave-policies"></a>**List leave policies.**

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `quota_type` | string | yes |  |
| `applies_to_grade` | string, or null | yes |  |
| `applies_to_area` | string, or null | yes |  |
| `entitlement_days_per_year` | number | yes |  |
| `accrual_frequency` | `Monthly` \\| `Yearly` | yes |  |
| `pro_rata_for_joiners` | boolean | yes |  |
| `carry_forward_cap_days` | number | yes |  |
| `lapse_on` | string | yes | MM-DD. |
| `encashable_days_per_year` | number | yes |  |
| `sandwich_rule` | boolean | yes |  |
| `is_active` | boolean | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "quota_type": "<quota_type>",
      "applies_to_grade": "<applies_to_grade>",
      "applies_to_area": "<applies_to_area>",
      "entitlement_days_per_year": 1,
      "accrual_frequency": "Monthly",
      "pro_rata_for_joiners": true,
      "carry_forward_cap_days": 1,
      "lapse_on": "<lapse_on>",
      "encashable_days_per_year": 1,
      "sandwich_rule": true,
      "is_active": true
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /holiday-calendars

<a id="get-holiday-calendars"></a>**List holiday calendars.** The named holiday lists personnel areas sit on — see /holidays?calendar= for one calendar's own dates.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `is_active` | boolean | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "is_active": true
    }
  ],
  "next_cursor": "1042"
}
```

#### POST /leave-requests

<a id="post-leave-requests"></a>**Submit a leave request.** Applies for leave exactly as My leave does: working days and the sandwich rule computed from the employee's own calendar, then routed to whoever their flow assigns. The employee needs their own sign-in for this — one behind `self.leave` or `time.manage` — so the request has a real requester to exclude from approving it. Send an Idempotency-Key.

Needs `time:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes | An absence type code, such as 0200 for annual leave. |
| `from_date` | string | yes | A date, YYYY-MM-DD. |
| `to_date` | string | yes | A date, YYYY-MM-DD. |
| `half_day` | boolean |  | Default `false`. |
| `reason` | string, or null |  |  |

```http
POST /api/v1/leave-requests
Content-Type: application/json

{
  "employee_id": 3,
  "absence_type": "0200",
  "from_date": "2026-11-10",
  "to_date": "2026-11-12",
  "reason": "Family event"
}
```

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `absence_type` | string | yes |  |
| `from_date` | string | yes | A date, YYYY-MM-DD. |
| `to_date` | string | yes | A date, YYYY-MM-DD. |
| `working_days` | number | yes |  |
| `half_day` | boolean | yes |  |
| `reason` | string, or null | yes |  |
| `status` | string | yes | Pending, Approved, Rejected or Cancelled. |
| `submitted_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "absence_type": "<absence_type>",
  "from_date": "2026-10-01",
  "to_date": "2026-10-01",
  "working_days": 1,
  "half_day": true,
  "reason": "<reason>",
  "status": "<status>",
  "submitted_at": "2026-10-01T09:30:00.000Z",
  "decided_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /rosters

<a id="get-rosters"></a>**List roster assignments.** One row per employee per rostered date. A null shift is a day off the roster names explicitly.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `from` | string |  | A date, YYYY-MM-DD. |
| `to` | string |  | A date, YYYY-MM-DD. |

```http
GET /api/v1/rosters?employee_id=3&from=2026-10-01&to=2026-10-31
```

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `date` | string | yes | A date, YYYY-MM-DD. |
| `shift` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "date": "<date>",
      "shift": "<shift>"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /attendance-days

<a id="get-attendance-days"></a>**List finalised attendance days.** What a day's punches, against the roster, added up to — written once the daily job (or 'run now') finalises it.

Needs `time:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `from` | string |  | A date, YYYY-MM-DD. |
| `to` | string |  | A date, YYYY-MM-DD. |

```http
GET /api/v1/attendance-days?employee_id=3&from=2026-10-01&to=2026-10-31
```

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `date` | string | yes | A date, YYYY-MM-DD. |
| `shift` | string, or null | yes |  |
| `first_in` | string, or null | yes |  |
| `last_out` | string, or null | yes |  |
| `worked_minutes` | integer | yes |  |
| `late_minutes` | integer | yes |  |
| `overtime_minutes` | integer | yes |  |
| `status` | `Present` \\| `Late` \\| `HalfDay` \\| `Absent` | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "date": "<date>",
      "shift": "<shift>",
      "first_in": "<first_in>",
      "last_out": "<last_out>",
      "worked_minutes": 1,
      "late_minutes": 1,
      "overtime_minutes": 1,
      "status": "Present"
    }
  ],
  "next_cursor": "1042"
}
```

#### POST /punches

<a id="post-punches"></a>**Record punches.** Batched punches from a device, or the generic endpoint any middleware in front of one calls. Each is unique on its device, time and employee, so a re-sent batch writes nothing twice. A punch with no `device` of its own uses the device this client is registered as; a client registered to no device must name one on every punch. Send an Idempotency-Key.

Needs `time:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `punches` | array of object | yes |  |

```http
POST /api/v1/punches
Content-Type: application/json

{
  "punches": [
    {
      "employee_id": 3,
      "at": "2026-10-05T09:02:00Z",
      "direction": "In"
    }
  ]
}
```

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `written` | integer | yes |  |
| `skipped` | integer | yes |  |

```json
{
  "written": 1,
  "skipped": 1
}
```

#### POST /timesheets

<a id="post-timesheets"></a>**Record timesheet hours.** Hours worked against the ERP's own projects, recorded the same way a person's own attendance entry would be — time evaluation and payroll read it the same. Send an Idempotency-Key.

Needs `time:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `date` | string | yes | A date, YYYY-MM-DD. |
| `hours` | number | yes |  |
| `attendance_type` | string |  | An attendance type code; defaults to on-duty / business travel. Default `"0810"`. |
| `remarks` | string, or null |  |  |

```http
POST /api/v1/timesheets
Content-Type: application/json

{
  "employee_id": 3,
  "date": "2026-10-05",
  "hours": 6,
  "remarks": "Client site visit"
}
```

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |

```json
{
  "id": 3
}
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `personnel_area` | string | yes |  |
| `year` | integer | yes |  |
| `month` | integer | yes |  |
| `pay_date` | string, or null | yes |  |
| `status` | string | yes |  |
| `posted_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "personnel_area": "<personnel_area>",
      "year": 1,
      "month": 1,
      "pay_date": "2026-10-01",
      "status": "<status>",
      "posted_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /payroll/runs

<a id="get-payroll-runs"></a>**List payroll runs.**

Needs `payroll:read`. More fields with `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `period_id` | integer |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `period_id` | integer | yes |  |
| `run_type` | string | yes | Regular or Off-cycle. |
| `status` | string | yes |  |
| `reason` | string, or null | yes |  |
| `pay_date` | string, or null | yes |  |
| `employee_count` | integer | yes |  |
| `error_count` | integer | yes |  |
| `gross_total` | Money |  | With pay:read. |
| `net_total` | Money |  | With pay:read. |
| `completed_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "period_id": 3,
      "run_type": "<run_type>",
      "status": "<status>",
      "reason": "<reason>",
      "pay_date": "2026-10-01",
      "employee_count": 1,
      "error_count": 1,
      "gross_total": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "net_total": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "completed_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `run_id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `status` | string | yes |  |
| `gross` | Money | yes |  |
| `net` | Money | yes |  |
| `lines` | array of object | yes |  |
| `published_at` | string, or null | yes | When the employee could first see it; null until its month is posted. |
| `year_to_date` | object | yes | The financial year so far, up to and including this payslip, summed from the stored lines. |

```json
{
  "data": [
    {
      "id": 3,
      "run_id": 3,
      "employee_id": 3,
      "status": "<status>",
      "gross": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "net": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "lines": [
        {
          "wage_type": "<wage_type>",
          "name": "<name>",
          "kind": "<kind>",
          "amount": {
            "amount": "58000.00",
            "currency": "INR"
          }
        }
      ],
      "published_at": "2026-10-01T09:30:00.000Z",
      "year_to_date": {
        "financial_year": "<financial_year>",
        "gross": {
          "amount": "58000.00",
          "currency": "INR"
        },
        "deductions": {
          "amount": "58000.00",
          "currency": "INR"
        },
        "net": {
          "amount": "58000.00",
          "currency": "INR"
        },
        "lines": [
          {
            "wage_type": "<wage_type>",
            "amount": {
              "amount": null,
              "currency": null
            }
          }
        ]
      }
    }
  ],
  "next_cursor": "1042"
}
```

#### GET /payroll/results/{id}/payslip

<a id="get-payroll-results-id-payslip"></a>**A payslip as a PDF.** One person's payslip as the PDF they would download, with the year to date — for the ERP's own portal to show. Not password-protected: show it only to that person. Needs pay:read.

Needs `payroll:read` and `pay:read`. Answers 200.

| Path parameter | Meaning |
| --- | --- |
| `id` | The payroll result's id, from the run's results. |

Answers with `application/pdf` — the file itself, not JSON.

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `run_id` | integer | yes |  |
| `payment_date` | string | yes | A date, YYYY-MM-DD. |
| `format` | string | yes |  |
| `line_count` | integer | yes |  |
| `total` | Money |  | With pay:read. |
| `paid` | integer | yes |  |
| `failed` | integer | yes |  |
| `pending` | integer | yes |  |
| `lines` | array of object | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "run_id": 3,
      "payment_date": "2026-10-01",
      "format": "<format>",
      "line_count": 1,
      "total": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "paid": 1,
      "failed": 1,
      "pending": 1,
      "lines": [
        {
          "employee_id": 3,
          "employee_name": "<employee_name>",
          "bank_name": "<bank_name>",
          "account_number": "<account_number>",
          "ifsc": "<ifsc>",
          "amount": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "payment_status": "pending",
          "bank_reference": "<bank_reference>",
          "failure_reason": "<failure_reason>"
        }
      ]
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `outcomes` | array of object | yes |  |
| `paid` | integer | yes |  |
| `failed` | integer | yes |  |
| `pending` | integer | yes |  |

```json
{
  "outcomes": [
    {
      "employee_id": 3,
      "outcome": "applied",
      "issue_id": 3
    }
  ],
  "paid": 1,
  "failed": 1,
  "pending": 1
}
```

#### GET /remittances

<a id="get-remittances"></a>**List statutory remittances.** Provident fund, ESI, TDS, professional tax and the labour welfare fund owed to each authority from each run, with their due dates.

Needs `payroll:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `status` | `Due` \\| `Remitted` |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `run_id` | integer | yes |  |
| `authority` | string | yes |  |
| `amount` | Money | yes |  |
| `due_date` | string | yes | A date, YYYY-MM-DD. |
| `status` | string | yes | Due or Remitted. |
| `remitted_at` | string, or null | yes |  |
| `reference` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "run_id": 3,
      "authority": "<authority>",
      "amount": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "due_date": "2026-10-01",
      "status": "<status>",
      "remitted_at": "2026-10-01T09:30:00.000Z",
      "reference": "<reference>"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `run_id` | integer | yes |  |
| `authority` | string | yes |  |
| `amount` | Money | yes |  |
| `due_date` | string | yes | A date, YYYY-MM-DD. |
| `status` | string | yes | Due or Remitted. |
| `remitted_at` | string, or null | yes |  |
| `reference` | string, or null | yes |  |

```json
{
  "id": 3,
  "run_id": 3,
  "authority": "<authority>",
  "amount": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "due_date": "2026-10-01",
  "status": "<status>",
  "remitted_at": "2026-10-01T09:30:00.000Z",
  "reference": "<reference>"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `payment_date` | string | yes | A date, YYYY-MM-DD. |
| `paid_by_run_id` | integer, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "wage_type": "<wage_type>",
      "amount": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "payment_date": "2026-10-01",
      "paid_by_run_id": 3,
      "created_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `payment_date` | string | yes | A date, YYYY-MM-DD. |
| `paid_by_run_id` | integer, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "wage_type": "<wage_type>",
  "amount": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "payment_date": "2026-10-01",
  "paid_by_run_id": 3,
  "created_at": "2026-10-01T09:30:00.000Z"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "wage_type": "<wage_type>",
      "amount": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "start_date": "2026-10-01",
      "end_date": "2026-10-01",
      "created_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `wage_type` | string | yes |  |
| `amount` | Money | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `end_date` | string, or null | yes |  |
| `created_at` | string | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "wage_type": "<wage_type>",
  "amount": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "start_date": "2026-10-01",
  "end_date": "2026-10-01",
  "created_at": "2026-10-01T09:30:00.000Z"
}
```

#### GET /salary-structures

<a id="get-salary-structures"></a>**List salary structures.** How an annual CTC splits into basic, allowances and employer contributions each month — read an employee's own with /employees/{id}/history?record=ctc.

Needs `payroll:read`. Answers 200.

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |
| `name` | string | yes |  |
| `is_active` | boolean | yes |  |
| `components` | array of object | yes |  |

```json
{
  "data": [
    {
      "code": "<code>",
      "name": "<name>",
      "is_active": true,
      "components": [
        {
          "wage_type": "<wage_type>",
          "component_type": "<component_type>",
          "percent": 1,
          "fixed_amount": {
            "amount": null,
            "currency": null
          }
        }
      ]
    }
  ]
}
```

#### GET /loans

<a id="get-loans"></a>**List loans.** Each employee loan with its EMI schedule, generated the moment it is approved — book the receivable from it, or from the loan.approved event, and watch loan.closed for when it is recovered in full. `perquisite_value` on each instalment is the concessional-loan taxable value rule 3(7)(i) adds for that month.

Needs `payroll:read` and `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |
| `status` | `Pending` \\| `Active` \\| `Closed` \\| `Rejected` |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `loan_type` | string | yes |  |
| `principal` | Money | yes |  |
| `annual_rate_percent` | number | yes |  |
| `tenure_months` | integer | yes |  |
| `emi` | Money | yes |  |
| `start_date` | string | yes | A date, YYYY-MM-DD. |
| `status` | `Pending` \\| `Active` \\| `Closed` \\| `Rejected` | yes |  |
| `reason` | string, or null | yes |  |
| `requested_at` | string | yes |  |
| `decided_at` | string, or null | yes |  |
| `schedule` | array of LoanScheduleLine | yes | Generated once, the moment the loan is approved. Empty for a loan still pending or rejected. |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "loan_type": "<loan_type>",
      "principal": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "annual_rate_percent": 1,
      "tenure_months": 1,
      "emi": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "start_date": "2026-10-01",
      "status": "Pending",
      "reason": "<reason>",
      "requested_at": "2026-10-01T09:30:00.000Z",
      "decided_at": "2026-10-01T09:30:00.000Z",
      "schedule": [
        {
          "installment_no": 1,
          "due_date": "2026-10-01",
          "opening_balance": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "principal": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "interest": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "closing_balance": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "perquisite_value": {
            "amount": "58000.00",
            "currency": "INR"
          },
          "paid": true
        }
      ]
    }
  ],
  "next_cursor": "1042"
}
```

#### POST /claims

<a id="post-claims"></a>**Send a claim already approved in the ERP.** A reimbursement claim the ERP's own approval process already decided, to be paid through payroll instead of retyped on screen. Still checked against the category's limit — an HRMS payroll and tax policy the ERP's process has no reason to know — and refused over it. Written in as Approved straight away and queued for payment; there is no HRMS-side decision to wait on. Send an Idempotency-Key.

Needs `payroll:write`. Send an `Idempotency-Key`. Answers 201.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `employee_id` | integer | yes |  |
| `category` | string | yes |  |
| `claim_date` | string | yes | A date, YYYY-MM-DD. |
| `lines` | array of object | yes |  |

```http
POST /api/v1/claims
Content-Type: application/json

{
  "employee_id": 3,
  "category": "FUEL",
  "claim_date": "2026-10-01",
  "lines": [
    {
      "date": "2026-09-28",
      "description": "Client-site mileage",
      "amount": {
        "amount": "2000.00",
        "currency": "INR"
      }
    }
  ]
}
```

| Response field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `category` | string | yes |  |
| `claim_date` | string | yes | A date, YYYY-MM-DD. |
| `total_amount` | Money | yes |  |
| `status` | string | yes | Always Approved: a claim sent here skips the HRMS's own approval, since the ERP's process already decided it. |
| `wage_type` | string | yes | CLAIM or REIMB, by the category's own taxability — what it is queued to be paid on. |
| `decided_at` | string, or null | yes |  |
| `lines` | array of ClaimLine | yes |  |

```json
{
  "id": 3,
  "employee_id": 3,
  "category": "<category>",
  "claim_date": "2026-10-01",
  "total_amount": {
    "amount": "58000.00",
    "currency": "INR"
  },
  "status": "<status>",
  "wage_type": "<wage_type>",
  "decided_at": "2026-10-01T09:30:00.000Z",
  "lines": [
    {
      "date": "<date>",
      "description": "<description>",
      "amount": {
        "amount": "58000.00",
        "currency": "INR"
      }
    }
  ]
}
```

#### GET /settlements

<a id="get-settlements"></a>**List settlements.** Each full and final settlement, with every component and its basis. Needs pay:read for the amounts.

Needs `payroll:read` and `pay:read`. Answers 200.

| Query parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer |  | Up to 200; 50 by default. |
| `cursor` | string |  | The `next_cursor` from the previous page. |
| `fields` | string |  | Comma-separated top-level fields to return, such as `id,employee_number,personal`. |
| `employee_id` | integer |  |  |

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `exit_id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `status` | `Draft` \\| `Paid` | yes |  |
| `run_id` | integer, or null | yes |  |
| `computed_at` | string | yes |  |
| `paid_at` | string, or null | yes |  |
| `lines` | array of SettlementLine | yes | Salary to the last day, leave encashment, notice pay, gratuity, loan recovery and any pending claim — whatever applied. A negative amount recovers rather than pays. |

```json
{
  "data": [
    {
      "id": 3,
      "exit_id": 3,
      "employee_id": 3,
      "status": "Draft",
      "run_id": 3,
      "computed_at": "2026-10-01T09:30:00.000Z",
      "paid_at": "2026-10-01T09:30:00.000Z",
      "lines": [
        {
          "component": "<component>",
          "basis": "<basis>",
          "amount": {
            "amount": "58000.00",
            "currency": "INR"
          }
        }
      ]
    }
  ],
  "next_cursor": "1042"
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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `financial_year` | string | yes |  |
| `quarter` | integer | yes |  |
| `gross_paid` | Money |  | With pay:read. |
| `tds_deducted` | Money | yes |  |
| `challan_bsr` | string, or null | yes |  |
| `deposit_date` | string, or null | yes |  |
| `receipt_24q` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "employee_id": 3,
      "financial_year": "<financial_year>",
      "quarter": 1,
      "gross_paid": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "tds_deducted": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "challan_bsr": "<challan_bsr>",
      "deposit_date": "2026-10-01",
      "receipt_24q": "<receipt_24q>"
    }
  ],
  "next_cursor": "1042"
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `code` | string | yes |  |
| `title` | string | yes | The role as candidates see it. |
| `position` | string | yes |  |
| `department` | string | yes |  |
| `company` | string, or null | yes |  |
| `job` | string | yes |  |
| `description` | string, or null | yes |  |
| `qualifications` | string, or null | yes | One per line. |
| `skills` | string, or null | yes | One per line. |
| `experience_years` | object | yes |  |
| `employment_type` | `Full-time` \\| `Part-time` \\| `Contract` \\| `Internship` | yes |  |
| `work_mode` | `On site` \\| `Hybrid` \\| `Remote` | yes |  |
| `location` | string, or null | yes |  |
| `budget` | object |  | The monthly salary budgeted. With pay:read. |
| `hiring_manager_employee_id` | integer, or null | yes |  |
| `openings` | integer | yes |  |
| `priority` | string | yes |  |
| `posted_date` | string, or null | yes |  |
| `target_close_date` | string, or null | yes |  |
| `status` | `Open` \\| `On hold` \\| `Closed` | yes |  |
| `is_published` | boolean | yes | On the public careers page. |

```json
{
  "data": [
    {
      "id": 3,
      "code": "<code>",
      "title": "<title>",
      "position": "<position>",
      "department": "<department>",
      "company": "<company>",
      "job": "<job>",
      "description": "<description>",
      "qualifications": "<qualifications>",
      "skills": "<skills>",
      "experience_years": {
        "min": 1,
        "max": 1
      },
      "employment_type": "Full-time",
      "work_mode": "On site",
      "location": "<location>",
      "budget": {
        "min": {
          "amount": "58000.00",
          "currency": "INR"
        },
        "max": {
          "amount": "58000.00",
          "currency": "INR"
        }
      },
      "hiring_manager_employee_id": 3,
      "openings": 1,
      "priority": "<priority>",
      "posted_date": "2026-10-01",
      "target_close_date": "2026-10-01",
      "status": "Open",
      "is_published": true
    }
  ],
  "next_cursor": "1042"
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `requisition_id` | integer | yes |  |
| `candidate_id` | integer | yes |  |
| `stage` | `Applied` \\| `Interviewing` \\| `Selected` \\| `Offered` \\| `Hired` | yes | Applied, then Interviewing, Selected (approved), Offered and Hired. A rejected application keeps the stage it reached. |
| `outcome` | `open` \\| `rejected` \\| `hired` | yes |  |
| `channel` | `Careers page` \\| `Added by HR` | yes |  |
| `applied_date` | string | yes | A date, YYYY-MM-DD. |
| `rejected_at` | string, or null | yes |  |
| `selected_at` | string, or null | yes |  |
| `offered_at` | string, or null | yes |  |
| `offered_salary` | Money, or null |  | Monthly. With pay:read. |
| `employee_id` | integer, or null | yes | Once hired. |
| `interviews` | array of InterviewRound | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "requisition_id": 3,
      "candidate_id": 3,
      "stage": "Applied",
      "outcome": "open",
      "channel": "Careers page",
      "applied_date": "2026-10-01",
      "rejected_at": "2026-10-01T09:30:00.000Z",
      "selected_at": "2026-10-01T09:30:00.000Z",
      "offered_at": "2026-10-01T09:30:00.000Z",
      "offered_salary": {
        "amount": "58000.00",
        "currency": "INR"
      },
      "employee_id": 3,
      "interviews": [
        {
          "id": 3,
          "round": "<round>",
          "interviewer_employee_id": 3,
          "scheduled_date": "2026-10-01",
          "scheduled_time": "<scheduled_time>",
          "status": "Scheduled",
          "rating": 1,
          "recommendation": "Advance"
        }
      ]
    }
  ],
  "next_cursor": "1042"
}
```

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

| Field, per item | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes |  |
| `cycle_id` | integer | yes |  |
| `employee_id` | integer | yes |  |
| `status` | string | yes |  |
| `final_rating` | integer, or null | yes | The calibrated rating, once calibration is finalised. |
| `finalised_at` | string, or null | yes |  |

```json
{
  "data": [
    {
      "id": 3,
      "cycle_id": 3,
      "employee_id": 3,
      "status": "<status>",
      "final_rating": 1,
      "finalised_at": "2026-10-01T09:30:00.000Z"
    }
  ],
  "next_cursor": "1042"
}
```

<!-- endpoint-reference:end -->
