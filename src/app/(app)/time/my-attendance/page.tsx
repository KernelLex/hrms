import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { PageHeader, Card, FigureRow, Figure, Table, Th, Tr, Td, Status, EmptyState, Notice } from "@/components/ui";
import { formatTimestamp, todayInIndia } from "@/lib/dates";
import { CalendarCheck } from "lucide-react";
import { RegulariseForm } from "./form";
import { CancelRegularisation } from "./cancel";

const TONE: Record<string, "done" | "waiting" | "problem" | "neutral"> = {
  Present: "done",
  Late: "waiting",
  HalfDay: "waiting",
  Absent: "problem",
};

/** Employee self-service: my roster, my attendance, and asking for a correction. */
export default async function MyAttendancePage() {
  const session = await requirePage(["self.attendance"]);

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My attendance" subtitle="Your roster, your punches and any correction you have asked for." />
        <Notice>This sign-in is not linked to an employee record, so there is no attendance to show.</Notice>
      </>
    );
  }

  const employeeId = session.employeeId;
  const today = todayInIndia();
  const weekAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [days, requests] = await Promise.all([
    rawClient().execute({
      sql: `SELECT a.date, a.shift_code, a.first_in, a.last_out, a.worked_minutes, a.late_minutes, a.overtime_minutes, a.status, s.name AS shift_name
            FROM pt_attendance_day a LEFT JOIN pt_shift s ON s.code = a.shift_code
            WHERE a.employee_id = ? AND a.date BETWEEN ? AND ? ORDER BY a.date DESC`,
      args: [employeeId, weekAgo, today],
    }),
    rawClient().execute({
      sql: `SELECT id, date, claimed_in, claimed_out, reason, status, decision_note FROM pt_regularisation
            WHERE employee_id = ? ORDER BY submitted_at DESC LIMIT 20`,
      args: [employeeId],
    }),
  ]);

  const workedHours = days.rows.reduce((s, r) => s + Number(r.worked_minutes), 0) / 60;
  const lateDays = days.rows.filter((r) => r.status === "Late").length;
  const absentDays = days.rows.filter((r) => r.status === "Absent").length;
  const pendingCount = requests.rows.filter((r) => r.status === "Pending").length;

  return (
    <>
      <PageHeader title="My attendance" subtitle="Your roster, your punches, and asking for a correction when one is missing or wrong." />

      <FigureRow>
        <Figure label="Worked, last 30 days" value={`${Math.round(workedHours)}h`} hint="from your punches" />
        <Figure label="Late" value={lateDays} hint="days past the grace period" />
        <Figure label="Absent" value={absentDays} hint="no punch at all" />
        <Figure label="Awaiting a decision" value={pendingCount} hint={pendingCount === 1 ? "request" : "requests"} />
      </FigureRow>

      <div className="mt-6">
        <RegulariseForm />
      </div>

      <div className="mt-6">
        <Card>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">My last 30 days</h2>
          </div>
          {days.rows.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="No rostered days yet">
              This fills in once you are on a roster and your shifts begin.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Shift</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th numeric>Worked</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {days.rows.map((r) => (
                  <Tr key={String(r.date)}>
                    <Td>
                      <span className="tabular">{String(r.date)}</span>
                    </Td>
                    <Td>{r.shift_name ? String(r.shift_name) : "—"}</Td>
                    <Td>{r.first_in ? formatTimestamp(String(r.first_in)) : <span className="text-decor">&mdash;</span>}</Td>
                    <Td>{r.last_out ? formatTimestamp(String(r.last_out)) : <span className="text-decor">&mdash;</span>}</Td>
                    <Td numeric>
                      <span className="tabular">{Math.round((Number(r.worked_minutes) / 60) * 10) / 10}h</span>
                    </Td>
                    <Td>
                      <Status tone={TONE[String(r.status)] ?? "neutral"}>{String(r.status)}</Status>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">My correction requests</h2>
          </div>
          {requests.rows.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="No requests yet">
              Ask above and it will appear here with its status.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Claimed</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {requests.rows.map((r) => (
                  <Tr key={Number(r.id)}>
                    <Td>
                      <span className="tabular">{String(r.date)}</span>
                    </Td>
                    <Td>
                      <span className="text-[13px] text-secondary">
                        {r.claimed_in ? formatTimestamp(String(r.claimed_in)) : "—"} to {r.claimed_out ? formatTimestamp(String(r.claimed_out)) : "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-secondary">&ldquo;{String(r.reason)}&rdquo;</span>
                    </Td>
                    <Td>
                      <Status
                        tone={r.status === "Approved" ? "done" : r.status === "Pending" ? "waiting" : r.status === "Rejected" ? "problem" : "neutral"}
                      >
                        {String(r.status)}
                      </Status>
                    </Td>
                    <Td className="text-right">{r.status === "Pending" ? <CancelRegularisation id={Number(r.id)} /> : null}</Td>
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
