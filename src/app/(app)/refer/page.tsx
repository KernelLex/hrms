import { requirePage } from "@/lib/access";
import { publishedRoles, referralsByEmployee } from "@/lib/repositories/recruitment";
import { REFERRAL_LABEL } from "@/lib/recruitment-values";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Card, CardHeader, EmptyState, PageHeader, Status, Table, Th, Td, Tr } from "@/components/ui";
import { ReferForm } from "./form";

const TONE: Record<string, "waiting" | "done" | "neutral"> = { Pending: "waiting", Paid: "done", Forfeited: "neutral" };

/** Refer someone you know for an open role, and earn a bonus once they are hired and stay. */
export default async function ReferPage() {
  const session = await requirePage(["self.profile"], "/");
  const [roles, referrals] = await Promise.all([publishedRoles(), session.employeeId ? referralsByEmployee(session.employeeId) : Promise.resolve([])]);

  return (
    <>
      <PageHeader title="Refer someone" subtitle="Know someone right for one of our open roles? Refer them, and earn a bonus once they are hired and still with us after the qualifying period." />

      <Card>
        <CardHeader title="Referral details" />
        <div className="px-6 pb-6">
          <ReferForm roles={roles.map((r) => ({ id: r.id, label: r.title }))} />
        </div>
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Your referrals" />
          {referrals.length === 0 ? (
            <EmptyState title="No referrals yet">Refer someone above, and they will appear here.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Role</Th>
                  <Th>Referred</Th>
                  <Th>Status</Th>
                  <Th numeric>Bonus</Th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((f) => (
                  <Tr key={f.id}>
                    <Td>
                      <span className="font-medium text-ink">{f.candidateName}</span>
                    </Td>
                    <Td>
                      <span className="text-secondary">{f.roleTitle ?? "—"}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(f.createdAt.slice(0, 10))}</span>
                    </Td>
                    <Td>
                      <Status tone={TONE[f.status] ?? "neutral"}>{REFERRAL_LABEL[f.status] ?? f.status}</Status>
                    </Td>
                    <Td numeric>{formatINR(f.bonusPaise)}</Td>
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
