import { redirect } from "next/navigation";
import { asc, desc, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptAttendance, ptAttendanceType } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveAttendance, deleteAttendance } from "@/app/actions/time";
import { TwoLine } from "@/components/ui";
import { TimeTabs } from "../tabs";
import { formatDate } from "@/lib/dates";
import { Pagination, pageFrom } from "@/components/pagination";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "type", label: "Type" },
  { key: "date", label: "Date" },
  { key: "hours", label: "Hours", numeric: true },
  { key: "remarks", label: "Remarks" },
];

/** TM-01 — attendance records (IT2002), including overtime. */
export default async function AttendancesPage(props: { searchParams: Promise<{ page?: string }> }) {
  const { page, limit, offset } = pageFrom((await props.searchParams).page);
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/time/my-leave");

  const [{ n: total }] = await db.select({ n: count() }).from(ptAttendance);
  const [rows, types, employees] = await Promise.all([
    db
      .select({
        id: ptAttendance.id,
        employeeId: ptAttendance.employeeId,
        typeCode: ptAttendance.attendanceTypeCode,
        typeName: ptAttendanceType.name,
        date: ptAttendance.date,
        hours: ptAttendance.hours,
        remarks: ptAttendance.remarks,
      })
      .from(ptAttendance)
      .innerJoin(ptAttendanceType, eq(ptAttendanceType.code, ptAttendance.attendanceTypeCode))
      .orderBy(desc(ptAttendance.date))
      .limit(limit)
      .offset(offset),
    db.select().from(ptAttendanceType).orderBy(asc(ptAttendanceType.code)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "employeeId",
      label: "Employee",
      required: true,
      options: employees.map((e) => ({
        value: String(e.id),
        label: `${e.employee_number} — ${fullName(e)}`,
      })),
    },
    {
      kind: "select",
      name: "attendanceTypeCode",
      label: "Type",
      required: true,
      options: types.map((t) => ({ value: t.code, label: `${t.code} — ${t.name}` })),
    },
    { kind: "date", name: "date", label: "Date", required: true },
    { kind: "text", name: "hours", label: "Hours", required: true, placeholder: "2" },
    {
      kind: "text",
      name: "remarks",
      label: "Remarks",
      full: true,
      placeholder: "Month-end close",
    },
  ];

  return (
    <>
      <TimeTabs />
      <MasterScreen
        total={total}
        footer={<Pagination page={page} total={total} path="/time/attendances" noun="records" />}
        title="Attendance"
        subtitle="Overtime, business travel and training. Overtime hours feed time evaluation."
        entity="attendance record"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveAttendance}
        deleteAction={deleteAttendance}
        wideDialog
        emptyHint="Record overtime or on-duty time against an employee."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.typeName} on ${formatDate(r.date)}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            type: <span className="text-secondary">{r.typeName}</span>,
            date: <span className="tabular text-secondary">{formatDate(r.date)}</span>,
            hours: String(r.hours),
            remarks: r.remarks ? (
              <span className="text-secondary">{r.remarks}</span>
            ) : (
              <span className="text-decor">&mdash;</span>
            ),
          },
          values: {
            employeeId: String(r.employeeId),
            attendanceTypeCode: r.typeCode,
            date: r.date,
            hours: String(r.hours),
            remarks: r.remarks ?? "",
          },
        }))}
      />
    </>
  );
}
