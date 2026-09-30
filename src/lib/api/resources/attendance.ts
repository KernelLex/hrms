import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { recordPunches, type PunchInput } from "@/lib/engines/attendance";
import { now } from "@/db/schema";
import { IsoDate, PageQuery, pageSchema } from "../format";
import { invalid } from "../problem";
import type { Endpoint } from "../router";
import { companyClause } from "./employees";
import { idPage, rows, s, visibleEmployees } from "./time";

/** Time: shifts, rosters, punches and the attendance days they add up to. */

const Roster = z.object({ id: z.number().int(), employee_id: z.number().int(), date: IsoDate, shift: z.string().nullable() }).meta({ id: "Roster" });
const AttendanceDay = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    date: IsoDate,
    shift: z.string().nullable(),
    first_in: z.string().nullable(),
    last_out: z.string().nullable(),
    worked_minutes: z.number().int(),
    late_minutes: z.number().int(),
    overtime_minutes: z.number().int(),
    status: z.enum(["Present", "Late", "HalfDay", "Absent"]),
  })
  .meta({ id: "AttendanceDay" });

export const attendanceEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/rosters",
    tag: "Time",
    summary: "List roster assignments",
    description: "One row per employee per rostered date. A null shift is a day off the roster names explicitly.",
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional(), from: IsoDate.optional(), to: IsoDate.optional() }),
    response: pageSchema(Roster),
    example: { query: "employee_id=3&from=2026-10-01&to=2026-10-31" },
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number; from?: string; to?: string };
      const v = visibleEmployees(ctx, "employee_id");
      const where = [v.sql];
      const args: InValue[] = [...v.args];
      if (q.employee_id) {
        where.push("employee_id = ?");
        args.push(q.employee_id);
      }
      if (q.from) {
        where.push("date >= ?");
        args.push(q.from);
      }
      if (q.to) {
        where.push("date <= ?");
        args.push(q.to);
      }
      return idPage(ctx, `SELECT * FROM pt_roster WHERE ${where.join(" AND ")}`, args, (r) => ({
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        date: String(r.date),
        shift: s(r.shift_code),
      }));
    },
  },
  {
    method: "GET",
    path: "/attendance-days",
    tag: "Time",
    summary: "List finalised attendance days",
    description: "What a day's punches, against the roster, added up to — written once the daily job (or 'run now') finalises it.",
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional(), from: IsoDate.optional(), to: IsoDate.optional() }),
    response: pageSchema(AttendanceDay),
    example: { query: "employee_id=3&from=2026-10-01&to=2026-10-31" },
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number; from?: string; to?: string };
      const v = visibleEmployees(ctx, "employee_id");
      const where = [v.sql];
      const args: InValue[] = [...v.args];
      if (q.employee_id) {
        where.push("employee_id = ?");
        args.push(q.employee_id);
      }
      if (q.from) {
        where.push("date >= ?");
        args.push(q.from);
      }
      if (q.to) {
        where.push("date <= ?");
        args.push(q.to);
      }
      return idPage(ctx, `SELECT * FROM pt_attendance_day WHERE ${where.join(" AND ")}`, args, (r) => ({
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        date: String(r.date),
        shift: s(r.shift_code),
        first_in: s(r.first_in),
        last_out: s(r.last_out),
        worked_minutes: Number(r.worked_minutes),
        late_minutes: Number(r.late_minutes),
        overtime_minutes: Number(r.overtime_minutes),
        status: String(r.status) as "Present" | "Late" | "HalfDay" | "Absent",
      }));
    },
  },
  {
    method: "POST",
    path: "/punches",
    tag: "Time",
    summary: "Record punches",
    description:
      "Batched punches from a device, or the generic endpoint any middleware in front of one calls. Each is unique on its device, time and employee, so a re-sent batch writes nothing twice. A punch with no `device` of its own uses the device this client is registered as; a client registered to no device must name one on every punch. Send an Idempotency-Key.",
    scopes: ["time:write"],
    body: z.object({
      punches: z
        .array(
          z.object({
            employee_id: z.number().int(),
            at: z.string().datetime({ offset: true }),
            direction: z.enum(["In", "Out"]),
            device: z.string().optional(),
          }),
        )
        .min(1)
        .max(500),
    }),
    response: z.object({ written: z.number().int(), skipped: z.number().int() }),
    status: 201,
    idempotent: true,
    example: { body: { punches: [{ employee_id: 3, at: "2026-10-05T09:02:00Z", direction: "In" }] } },
    handler: async (ctx) => {
      const b = ctx.body as { punches: { employee_id: number; at: string; direction: "In" | "Out"; device?: string }[] };
      const own = await rows("SELECT code FROM pt_device WHERE client_pk = ? AND is_active = 1 LIMIT 1", [ctx.client.pk]);
      const defaultDevice = own[0] ? String(own[0].code) : null;

      if (ctx.client.companies) {
        const c = companyClause(ctx, "company_code");
        const ids = [...new Set(b.punches.map((p) => p.employee_id))];
        const inside = await rows(
          `SELECT DISTINCT employee_id FROM pa_it0001_org_assignment WHERE employee_id IN (${ids.map(() => "?").join(", ")}) AND ${c.sql}`,
          [...ids, ...c.args],
        );
        if (inside.length < ids.length) throw invalid("One or more employees are outside the companies this client may see.");
      }

      const punches: PunchInput[] = [];
      for (const p of b.punches) {
        const deviceCode = p.device ?? defaultDevice;
        if (!deviceCode) throw invalid("No device is registered for this client; send `device` on every punch.");
        punches.push({ employeeId: p.employee_id, deviceCode, at: new Date(p.at).toISOString(), direction: p.direction, source: "Device" });
      }
      const result = await recordPunches(rawClient(), punches);
      return { status: 201, body: { written: result.written, skipped: result.skipped } };
    },
  },
  {
    method: "POST",
    path: "/timesheets",
    tag: "Time",
    summary: "Record timesheet hours",
    description: "Hours worked against the ERP's own projects, recorded the same way a person's own attendance entry would be — time evaluation and payroll read it the same. Send an Idempotency-Key.",
    scopes: ["time:write"],
    body: z.object({
      employee_id: z.number().int(),
      date: IsoDate,
      hours: z.number().positive().max(24),
      attendance_type: z.string().default("0810").meta({ description: "An attendance type code; defaults to on-duty / business travel." }),
      remarks: z.string().nullable().default(null),
    }),
    response: z.object({ id: z.number().int() }),
    status: 201,
    idempotent: true,
    example: { body: { employee_id: 3, date: "2026-10-05", hours: 6, remarks: "Client site visit" } },
    handler: async (ctx) => {
      const b = ctx.body as { employee_id: number; date: string; hours: number; attendance_type: string; remarks: string | null };
      if (ctx.client.companies) {
        const c = companyClause(ctx, "company_code");
        const inside = await rows(`SELECT 1 FROM pa_it0001_org_assignment WHERE employee_id = ? AND ${c.sql} LIMIT 1`, [b.employee_id, ...c.args]);
        if (inside.length === 0) throw invalid("That employee is outside the companies this client may see.");
      }
      const type = await rows("SELECT code FROM pt_attendance_type WHERE code = ? AND is_active = 1", [b.attendance_type]);
      if (type.length === 0) throw invalid(`There is no active attendance type ${b.attendance_type}.`);

      const inserted = await rows(
        `INSERT INTO pt_it2002_attendance (employee_id, attendance_type_code, date, hours, remarks, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [b.employee_id, b.attendance_type, b.date, Math.round(b.hours), b.remarks, `${ctx.client.name} (API)`, now()],
      );
      return { status: 201, body: { id: Number(inserted[0].id) }, headers: { Location: `/api/v1/timesheets/${inserted[0].id}` } };
    },
  },
];
