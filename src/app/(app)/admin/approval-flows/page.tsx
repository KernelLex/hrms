import { rawClient } from "@/lib/db";
import { requirePage } from "@/lib/access";
import { activeFlow, flowSteps } from "@/lib/workflow/engine";
import { PROCESSES, PROCESS_CODES, describeStep } from "@/lib/workflow/processes";
import { listRoles, listUsers } from "@/lib/repositories/access";
import { formatTimestamp } from "@/lib/dates";
import { ButtonLink, Card, CardHeader } from "@/components/ui";

/**
 * Who approves what: each process's route, step by step. Leave is the first
 * process on the engine; corrections, claims and exits join it later.
 */
export default async function ApprovalFlowsPage() {
  await requirePage(["access.manage"], "/admin");
  const [roles, users] = await Promise.all([listRoles(), listUsers()]);
  const roleName = new Map(roles.map((r) => [r.code, r.name]));
  const userName = new Map(users.map((u) => [u.id, u.label]));

  const flows = await Promise.all(
    PROCESS_CODES.map(async (process) => {
      const flow = await activeFlow(process);
      const steps = flow ? await flowSteps(flow.id) : [];
      const meta = flow
        ? await rawClient().execute({ sql: "SELECT created_by, created_at FROM wf_flow WHERE id = ?", args: [flow.id] })
        : null;
      return { process, flow, steps, meta: meta?.rows[0] };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      {flows.map(({ process, flow, steps, meta }) => (
        <Card key={process}>
          <CardHeader
            title={PROCESSES[process].label}
            description={
              flow && meta
                ? `Version ${flow.version}, saved by ${String(meta.created_by)} on ${formatTimestamp(String(meta.created_at))}.`
                : "No flow yet."
            }
            actions={
              <ButtonLink href={`/admin/approval-flows/${process}`} size="sm">
                Change
              </ButtonLink>
            }
          />
          <ol className="px-6 pb-5">
            {steps.map((s, i) => (
              <li key={s.stepOrder} className="flex gap-3 border-b border-soft py-3 last:border-0">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-medium text-secondary">
                  {i + 1}
                </span>
                <span className="text-sm text-ink">
                  {describeStep(process, s, {
                    role: s.approverRole ? roleName.get(s.approverRole) : undefined,
                    person: s.approverUserId ? userName.get(s.approverUserId) : undefined,
                  })}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
