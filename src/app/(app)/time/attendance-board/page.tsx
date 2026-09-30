import { rawClient } from "@/lib/db";
import { requirePage } from "@/lib/access";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { todayInIndia, formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, Status, FigureRow, Figure, EmptyState } from "@/components/ui";
import { ClipboardList } from "lucide-react";
import { TimeTabs } from "../tabs";
import { RunNowButton } from "./run-now";

const TONE: Record<string, "done" | "waiting" | "problem" | "neutral"> = {
  Present: "done",
  Late: "waiting",
  HalfDay: "waiting",
  Absent: "problem",
};

/** TM-11 — in, late, absent, for whoever a roster expected today. */
export default async function AttendanceBoardPage(props: { searchParams: Promise<{ date?: string }> }) {
  await requirePage(["time.manage"], "/time/my-attendance");
  const params = await props.searchParams;
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayInIndia();

  const [rows, employees] = await Promise.all([
    rawClient().execute({
      sql: `SELECT a.employee_id, a.shift_code, a.first_in, a.last_out, a.worked_minutes, a.late_minutes, a.overtime_minutes, a.status, s.name AS shift_name
            FROM pt_attendance_day a LEFT JOIN pt_shift s ON s.code = a.shift_code
            WHERE a.date = ? ORDER BY a.status DESC, a.employee_id`,
      args: [date],
    }),
    listEmployees(),
  ]);
  const nameOf = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const present = rows.rows.filter((r) => r.status === "Present" || r.status === "Late" || r.status === "HalfDay").length;
  const late = rows.rows.filter((r) => r.status === "Late").length;
  const absent = rows.rows.filter((r) => r.status === "Absent").length;

  return (
    <>
      <TimeTabs />
      <PageHeader title="Today's board" subtitle={`Who a roster expected on ${date}, and what their punches show. Finalised by the daily job; run it now for a day already past.`} />

      <FigureRow>
        <Figure label="Rostered" value={rows.rows.length} hint="people expected" />
        <Figure label="In" value={present} hint="present, late or half day" />
        <Figure label="Late" value={late} hint="past the shift's grace period" />
        <Figure label="Absent" value={absent} hint="no punch at all" />
      </FigureRow>

      <div className="mt-6">
        <Card>
          <CardHeader title={date} description="" />
          <div className="px-6 pb-4">
            <RunNowButton date={date} />
          </div>
          {rows.rows.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title="Nobody was rostered a shift">
              Assign a roster pattern to a team on the Roster tab.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Shift</Th>
                  <Th>First in</Th>
                  <Th>Last out</Th>
                  <Th numeric>Worked</Th>
                  <Th numeric>Late</Th>
                  <Th numeric>OT</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.rows.map((r) => {
                  const employeeId = Number(r.employee_id);
                  return (
                    <Tr key={employeeId}>
                      <Td>
                        <div className="font-medium text-ink">{nameOf.get(employeeId) ?? "—"}</div>
                        <div className="text-[13px] text-muted">{numberOf.get(employeeId)}</div>
                      </Td>
                      <Td>{r.shift_name ? String(r.shift_name) : "—"}</Td>
                      <Td>{r.first_in ? formatTimestamp(String(r.first_in)) : <span className="text-decor">&mdash;</span>}</Td>
                      <Td>{r.last_out ? formatTimestamp(String(r.last_out)) : <span className="text-decor">&mdash;</span>}</Td>
                      <Td numeric>
                        <span className="tabular">{Math.round((Number(r.worked_minutes) / 60) * 10) / 10}h</span>
                      </Td>
                      <Td numeric>
                        <span className="tabular text-secondary">{Number(r.late_minutes) > 0 ? `${r.late_minutes}m` : "—"}</span>
                      </Td>
                      <Td numeric>
                        <span className="tabular text-secondary">{Number(r.overtime_minutes) > 0 ? `${Math.round((Number(r.overtime_minutes) / 60) * 10) / 10}h` : "—"}</span>
                      </Td>
                      <Td>
                        <Status tone={TONE[String(r.status)] ?? "neutral"}>{String(r.status)}</Status>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
