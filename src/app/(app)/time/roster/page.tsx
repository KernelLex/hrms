import { asc, eq } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db, rawClient } from "@/lib/db";
import { ptRosterPattern } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { todayInIndia } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { CalendarRange } from "lucide-react";
import { TimeTabs } from "../tabs";
import { AssignRosterForm } from "./form";

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** TM-10 — the roster: assign a pattern to a team, see the week ahead. */
export default async function RosterPage(props: { searchParams: Promise<{ from?: string }> }) {
  await requirePage(["time.manage"], "/time/my-attendance");
  const params = await props.searchParams;
  const from = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : todayInIndia();
  const to = addDays(from, 6);

  const [patterns, employees, rosterRows] = await Promise.all([
    db.select().from(ptRosterPattern).where(eq(ptRosterPattern.isActive, true)).orderBy(asc(ptRosterPattern.code)),
    listEmployees(),
    rawClient().execute({
      sql: `SELECT r.employee_id, r.date, r.shift_code, s.name AS shift_name, s.start_time, s.end_time
            FROM pt_roster r LEFT JOIN pt_shift s ON s.code = r.shift_code
            WHERE r.date BETWEEN ? AND ?
            ORDER BY r.employee_id, r.date`,
      args: [from, to],
    }),
  ]);

  const nameOf = new Map(employees.map((e) => [e.id, fullName(e)]));
  const byEmployee = new Map<number, Map<string, { name: string; hours: string } | null>>();
  for (const r of rosterRows.rows) {
    const employeeId = Number(r.employee_id);
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Map());
    byEmployee.get(employeeId)!.set(
      String(r.date),
      r.shift_code ? { name: String(r.shift_name), hours: `${r.start_time}–${r.end_time}` } : null,
    );
  }
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  return (
    <>
      <TimeTabs />
      <PageHeader title="Roster" subtitle="A pattern generates a shift for every day of its cycle; edit a single day by exception from the board." />

      <div className="mt-2">
        <AssignRosterForm
          patterns={patterns.map((p) => ({ value: p.code, label: `${p.name} (${p.cycleLengthDays}-day cycle)` }))}
          employees={employees.map((e) => ({ value: String(e.id), label: `${fullName(e)} (${e.employee_number})` }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="The week ahead" description={`${from} to ${to}`} />
          {byEmployee.size === 0 ? (
            <EmptyState icon={<CalendarRange />} title="Nobody is rostered this week">
              Assign a pattern above to fill it in.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  {dates.map((d) => (
                    <Th key={d}>{d.slice(5)}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...byEmployee.entries()].map(([employeeId, days]) => (
                  <Tr key={employeeId}>
                    <Td>{nameOf.get(employeeId) ?? "—"}</Td>
                    {dates.map((d) => {
                      const shift = days.get(d);
                      return (
                        <Td key={d}>
                          {shift === undefined ? (
                            <span className="text-decor">&mdash;</span>
                          ) : shift === null ? (
                            <span className="text-[13px] text-muted">Off</span>
                          ) : (
                            <span className="text-[13px] text-ink" title={shift.hours}>
                              {shift.name}
                            </span>
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
