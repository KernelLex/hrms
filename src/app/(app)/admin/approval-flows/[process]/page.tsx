import { notFound } from "next/navigation";
import { requirePage } from "@/lib/access";
import { activeFlow, flowSteps } from "@/lib/workflow/engine";
import { PROCESSES, isProcess } from "@/lib/workflow/processes";
import { listRoles, listUsers } from "@/lib/repositories/access";
import { FlowForm } from "./flow-form";

/** Changing one process's approval route. */
export default async function FlowPage(props: { params: Promise<{ process: string }> }) {
  await requirePage(["access.manage"], "/admin");
  const { process } = await props.params;
  if (!isProcess(process)) notFound();
  const flow = await activeFlow(process);
  const [steps, roles, users] = await Promise.all([
    flow ? flowSteps(flow.id) : Promise.resolve([]),
    listRoles(),
    listUsers(),
  ]);
  const facts = Object.values(PROCESSES[process].facts);

  return (
    <FlowForm
      process={process}
      factLabel={facts[0] ?? null}
      flagFact={Boolean(PROCESSES[process].flagFacts)}
      initial={steps.map((s) => ({
        approverType: s.approverType,
        approverRole: s.approverRole ?? "",
        approverUserId: s.approverUserId ? String(s.approverUserId) : "",
        conditionMin: s.conditionMin === null ? "" : String(s.conditionMin),
        escalateAfterDays: s.escalateAfterDays === null ? "" : String(s.escalateAfterDays),
      }))}
      roles={roles.map((r) => ({ code: r.code, name: r.name }))}
      users={users}
    />
  );
}
