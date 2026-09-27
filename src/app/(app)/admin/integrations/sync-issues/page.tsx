import { CircleCheck } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listSyncIssues } from "@/lib/repositories/integrations";
import { formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, EmptyState, Tab, Tabs, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import { IssueActions } from "../forms";

/** What another system sent that could not be applied automatically. */
export default async function SyncIssuesPage(props: { searchParams: Promise<{ state?: string }> }) {
  await requirePage(["integrations.manage"], "/admin");
  const requested = (await props.searchParams).state;
  const state = requested === "resolved" || requested === "discarded" ? requested : "open";
  const issues = await listSyncIssues(state);

  return (
    <>
      <Tabs>
        {(["open", "resolved", "discarded"] as const).map((s) => (
          <Tab key={s} href={`/admin/integrations/sync-issues${s === "open" ? "" : `?state=${s}`}`} active={s === state}>
            {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "Discarded"}
          </Tab>
        ))}
      </Tabs>
      <Card>
        <CardHeader
          title="Sync issues"
          description="Try again once the cause is fixed — a missing employee added, say — or discard what should never apply."
        />
        {issues.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title={state === "open" ? "Nothing waiting" : "None"}>
            {state === "open" ? "Everything the ERP sent has been applied." : "Issues move here once handled."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Issue</Th>
                <Th>From</Th>
                <Th>When</Th>
                {state === "open" ? (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <TwoLine value={i.reason} sub={[i.kind.replace(/_/g, " "), i.reference].filter(Boolean).join(", ")} />
                  </Td>
                  <Td>
                    <span className="text-secondary">{i.clientName ?? "Unknown"}</span>
                  </Td>
                  <Td>
                    <TwoLine
                      value={<span className="tabular font-normal text-secondary">{formatTimestamp(i.createdAt)}</span>}
                      sub={i.resolvedAt ? `${state === "resolved" ? "Resolved" : "Discarded"} by ${i.resolvedBy}` : undefined}
                    />
                  </Td>
                  {state === "open" ? (
                    <Td className="text-right">
                      <IssueActions id={i.id} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
