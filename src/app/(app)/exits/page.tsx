import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState, TwoLine } from "@/components/ui";
import { LogOut } from "lucide-react";
import { ExitAdminActions } from "./actions";

const STATUS_TONE = { Pending: "waiting", Approved: "action", Rejected: "problem", Withdrawn: "neutral", Settled: "done" } as const;

/** HR's exit board: every resignation, termination and retirement, with its clearance progress and settlement. */
export default async function ExitsPage() {
  await requirePage(["employee.edit"], "/exit");

  const exits = await rawClient().execute(
    `SELECT x.*, COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
            (SELECT COUNT(*) FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id WHERE c.employee_id = x.employee_id AND c.event = 'offboarding') AS clearance_total,
            (SELECT COUNT(*) FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id WHERE c.employee_id = x.employee_id AND c.event = 'offboarding' AND t.status = 'Done') AS clearance_done
     FROM pa_exit x
     JOIN pa_employee e ON e.id = x.employee_id
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
     ORDER BY CASE x.status WHEN 'Pending' THEN 0 WHEN 'Approved' THEN 1 WHEN 'Settled' THEN 2 ELSE 3 END, x.requested_at DESC`,
  );

  return (
    <>
      <PageHeader title="Exits" subtitle="Every resignation, termination and retirement, with clearance and the settlement." />
      <Card>
        {exits.rows.length === 0 ? (
          <EmptyState icon={<LogOut />} title="No exits yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Last day</Th>
                <Th>Clearance</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {exits.rows.map((x) => (
                <Tr key={Number(x.id)}>
                  <Td>
                    <TwoLine value={String(x.name)} sub={String(x.exit_type)} />
                  </Td>
                  <Td>
                    <span className="tabular text-secondary">
                      {formatDate(String(x.approved_last_day ?? x.requested_last_day))}
                      {!x.approved_last_day ? " (asked for)" : ""}
                    </span>
                  </Td>
                  <Td>{Number(x.clearance_total) > 0 ? `${Number(x.clearance_done)} of ${Number(x.clearance_total)}` : "—"}</Td>
                  <Td>
                    <Status tone={STATUS_TONE[String(x.status) as keyof typeof STATUS_TONE] ?? "neutral"}>{String(x.status)}</Status>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ExitAdminActions
                      id={Number(x.id)}
                      name={String(x.name)}
                      status={String(x.status)}
                      noticeWaived={Number(x.notice_waived) === 1}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
