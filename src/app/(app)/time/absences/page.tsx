import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptAbsence, ptAbsenceType } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveAbsence, deleteAbsence } from "@/app/actions/time";
import { Status, TwoLine } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "type", label: "Absence type" },
  { key: "range", label: "Dates" },
  { key: "days", label: "Working days", numeric: true },
  { key: "paid", label: "Pay" },
  { key: "remarks", label: "Remarks" },
];

/** TM-01 — absence records (IT2001). */
export default async function AbsencesPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/time/my-leave");

  const [rows, types, employees] = await Promise.all([
    db
      .select({
        id: ptAbsence.id,
        employeeId: ptAbsence.employeeId,
        typeCode: ptAbsence.absenceTypeCode,
        typeName: ptAbsenceType.name,
        isPaid: ptAbsenceType.isPaid,
        startDate: ptAbsence.startDate,
        endDate: ptAbsence.endDate,
        payrollDays: ptAbsence.payrollDays,
        isHalfDay: ptAbsence.isHalfDay,
        remarks: ptAbsence.remarks,
        sourceRequestId: ptAbsence.sourceRequestId,
      })
      .from(ptAbsence)
      .innerJoin(ptAbsenceType, eq(ptAbsenceType.code, ptAbsence.absenceTypeCode))
      .orderBy(desc(ptAbsence.startDate)),
    db.select().from(ptAbsenceType).orderBy(asc(ptAbsenceType.code)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));
  const dash = <span className="text-decor">&mdash;</span>;

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
      name: "absenceTypeCode",
      label: "Absence type",
      required: true,
      options: types.map((t) => ({
        value: t.code,
        label: `${t.code} — ${t.name}${t.isPaid ? "" : " (unpaid)"}`,
      })),
    },
    { kind: "date", name: "startDate", label: "Start date", required: true },
    {
      kind: "date",
      name: "endDate",
      label: "End date",
      required: true,
      hint: "Working days are counted, so weekends and holidays do not cost leave.",
    },
    { kind: "text", name: "remarks", label: "Remarks", full: true, placeholder: "Fever" },
  ];

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Absences"
        subtitle="Every absence on record. Approved leave requests land here automatically; these are the ones HR enters directly."
        entity="absence"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveAbsence}
        deleteAction={deleteAbsence}
        wideDialog
        emptyHint="Record an absence, or approve a leave request to create one."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.typeName} from ${r.startDate}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            type: <span className="text-secondary">{r.typeName}</span>,
            range: (
              <span className="tabular text-secondary">
                {r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`}
              </span>
            ),
            days: r.isHalfDay ? "0.5" : String(r.payrollDays),
            // Unpaid is not a problem, it is a fact that changes pay.
            paid: (
              <Status tone={r.isPaid ? "done" : "waiting"}>
                {r.isPaid ? "Paid" : "Unpaid"}
              </Status>
            ),
            remarks: r.remarks ? (
              <span className="text-secondary">{r.remarks}</span>
            ) : (
              dash
            ),
          },
          values: {
            employeeId: String(r.employeeId),
            absenceTypeCode: r.typeCode,
            startDate: r.startDate,
            endDate: r.endDate,
            remarks: r.remarks ?? "",
          },
        }))}
      />
    </>
  );
}
