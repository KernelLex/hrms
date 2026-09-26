import { inArray } from "drizzle-orm";
import { Eye } from "lucide-react";
import { db } from "@/lib/db";
import { secAppUser } from "@/db/schema";
import { accessLogFor } from "@/lib/access-log";
import { formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, EmptyState, Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/**
 * Who has read this person's records, and when — the other half of the audit
 * trail. Writes were always attributable through created_by and the history
 * tables; this makes reads of pay, bank, tax and documents attributable too.
 *
 * HR-only, like the rest of the employee record (the layout checks).
 */
export default async function AccessLogPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const entries = await accessLogFor(Number(id), 100);

  const userIds = [...new Set(entries.map((e) => e.userId))];
  const users = userIds.length
    ? await db
        .select({ id: secAppUser.id, name: secAppUser.displayName, employeeId: secAppUser.employeeId })
        .from(secAppUser)
        .where(inArray(secAppUser.id, userIds))
    : [];
  const userOf = new Map(users.map((u) => [u.id, u]));

  return (
    <Card>
      <CardHeader
        title="Access log"
        description="Who opened this person's pay, bank, tax and personal records. The last 100 reads."
      />
      {entries.length === 0 ? (
        <EmptyState icon={<Eye />} title="Nobody has opened these records yet">
          Each time someone views a payslip, Form 16, document or record tab for this
          person, it is listed here.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>What</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const user = userOf.get(e.userId);
              const self = user?.employeeId === Number(id);
              return (
                <Tr key={e.id}>
                  <Td>
                    <span className="tabular text-secondary">{formatTimestamp(e.at)}</span>
                  </Td>
                  <Td>
                    <TwoLine value={user?.name ?? e.username} sub={self ? "Themselves" : e.username} />
                  </Td>
                  <Td>
                    <span className="text-secondary">
                      {e.resource}
                      {e.resourceId && !/^\d+$/.test(e.resourceId) ? `, ${e.resourceId}` : ""}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
