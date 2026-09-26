import { redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getProfile } from "@/lib/repositories/profile";
import { fullName } from "@/lib/repositories/employees";
import { documentsFor } from "@/lib/storage";
import { formatINR } from "@/lib/money";
import { formatDate, formatTimestamp, todayInIndia } from "@/lib/dates";
import {
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  KeyValueRow,
  Notice,
  PageHeader,
  Badge,
  RowLink,
} from "@/components/ui";
import { DocumentList } from "@/components/documents";

/**
 * Employee self-service: what the company holds about you, as it stands
 * today, your documents, and who has looked at your records.
 *
 * Read-only. Corrections go through HR, who own the dated history; an
 * employee editing their own bank account unchecked is how payroll fraud
 * starts.
 */

function yearsOfService(hireDate: string, today: string): string {
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let years = ty - hy;
  if (tm < hm || (tm === hm && td < hd)) years -= 1;
  if (years < 1) return "less than a year";
  return years === 1 ? "1 year" : `${years} years`;
}

export default async function MyProfilePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My profile" subtitle="What the company holds about you." />
        <Notice>
          This sign-in is not linked to an employee record, so there is no profile to show.
        </Notice>
      </>
    );
  }

  const today = todayInIndia();
  const [profile, documents] = await Promise.all([
    getProfile(session.employeeId, today),
    documentsFor("employee", [session.employeeId]),
  ]);
  if (!profile) redirect("/");

  const e = profile.employee;
  const status = e.employment_status;

  return (
    <>
      <PageHeader
        title={fullName(e)}
        subtitle={[e.employee_number, e.position_title, e.org_unit_name].filter(Boolean).join(", ") + "."}
        badge={
          <Badge tone={status === "Active" ? "done" : status === "On leave" ? "waiting" : "neutral"} dot>
            {status}
          </Badge>
        }
      />

      <Notice>
        To correct anything here, ask HR. Records are dated, so a change is added from the day it
        applies and the history stays intact.
      </Notice>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Job" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Position">{e.position_title}</KeyValueRow>
                <KeyValueRow label="Department">{e.org_unit_name}</KeyValueRow>
                <KeyValueRow label="Reports to">{profile.managerName}</KeyValueRow>
                <KeyValueRow label="Joined">
                  {`${formatDate(e.hire_date)}, ${yearsOfService(e.hire_date, today)} ago`}
                </KeyValueRow>
                <KeyValueRow label="Work schedule">
                  {profile.schedule
                    ? `${profile.schedule.name}, ${profile.schedule.weeklyHours} hours a week`
                    : null}
                </KeyValueRow>
                <KeyValueRow label="Cost centre">{e.cost_center}</KeyValueRow>
              </KeyValue>
            </div>
          </Card>

          <Card>
            <CardHeader title="Personal details" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Date of birth">
                  {profile.personal?.dateOfBirth ? formatDate(profile.personal.dateOfBirth) : null}
                </KeyValueRow>
                <KeyValueRow label="Gender">{profile.personal?.gender}</KeyValueRow>
                <KeyValueRow label="Marital status">{profile.personal?.maritalStatus}</KeyValueRow>
                <KeyValueRow label="Nationality">{profile.personal?.nationality}</KeyValueRow>
                {profile.contacts.map((c) => (
                  <KeyValueRow key={`${c.type}-${c.value}`} label={c.type}>
                    {c.value}
                  </KeyValueRow>
                ))}
                {profile.addresses.map((a) => (
                  <KeyValueRow key={`${a.type}-${a.line}`} label={`${a.type} address`}>
                    {[a.line, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}
                  </KeyValueRow>
                ))}
              </KeyValue>
            </div>
          </Card>

          <Card>
            <CardHeader title="Documents" description="Filed by HR. Each download is recorded." />
            <DocumentList employeeId={session.employeeId} documents={documents} canManage={false} />
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Pay" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Monthly basic pay">
                  {e.amount_paise !== null ? formatINR(e.amount_paise) : null}
                </KeyValueRow>
                <KeyValueRow label="Pay group">{e.pay_scale_group}</KeyValueRow>
                <KeyValueRow label="Bank">{profile.bank?.bankName}</KeyValueRow>
                <KeyValueRow label="Account">
                  {profile.bank ? <span className="tabular">{profile.bank.accountEnding}</span> : null}
                </KeyValueRow>
                <KeyValueRow label="IFSC">{profile.bank?.ifsc}</KeyValueRow>
              </KeyValue>
            </div>
          </Card>

          <Card>
            <CardHeader title="Notifications" />
            <div className="pb-3">
              <RowLink href="/inbox/preferences">
                <div className="text-sm font-medium text-ink">Choose what you hear about</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Leave decisions, payslips and reviews, in your inbox or by email.
                </div>
              </RowLink>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Who has viewed your records"
              description="HR opening your pay, bank, tax or documents. The last 20 times."
            />
            {profile.viewedBy.length === 0 ? (
              <EmptyState icon={<Eye />} title="Nobody yet">
                When someone opens your records, it shows here with the time.
              </EmptyState>
            ) : (
              <ul className="px-6 pb-4">
                {profile.viewedBy.map((v, i) => (
                  <li key={i} className="border-b border-soft py-3 last:border-0">
                    <div className="text-sm text-ink">
                      <span className="font-medium">{v.name}</span>
                      <span className="text-secondary"> opened {v.resource.toLowerCase()}</span>
                    </div>
                    <div className="tabular mt-0.5 text-xs text-muted">{formatTimestamp(v.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
