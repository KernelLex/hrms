import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptWorkScheduleRule, omPosition, omOrgUnit } from "@/db/schema";
import { readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import { getEmployee } from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import { Card, CardHeader, KeyValue, KeyValueRow, Notice } from "@/components/ui";
import { Field, DateInput } from "@/components/inputs";
import { Clock } from "lucide-react";

/**
 * CH-03 — display HR master data as it stood on a date.
 *
 * Read-only by design. This is the payoff for storing dated records instead of
 * overwriting them: pick any past date and the answer is what was actually
 * true then, not what is true now.
 */
export default async function AsOfPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { id } = await props.params;
  const { date } = await props.searchParams;
  const employeeId = Number(id);

  const asOf =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10);

  const employee = await getEmployee(employeeId, asOf);
  if (!employee) notFound();

  const [personal, org, pay, bank, time, schedules, positions, units] = await Promise.all([
    readAsOf<Record<string, string>>(SLICED_TABLES.personalData, employeeId, asOf),
    readAsOf<Record<string, string>>(SLICED_TABLES.orgAssignment, employeeId, asOf),
    readAsOf<Record<string, number | string>>(SLICED_TABLES.basicPay, employeeId, asOf),
    readAsOf<Record<string, string>>(SLICED_TABLES.bankDetails, employeeId, asOf),
    readAsOf<Record<string, string | number>>(
      SLICED_TABLES.plannedWorkingTime,
      employeeId,
      asOf,
    ),
    db.select().from(ptWorkScheduleRule).orderBy(asc(ptWorkScheduleRule.code)),
    db.select().from(omPosition),
    db.select().from(omOrgUnit),
  ]);

  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));
  const unitName = new Map(units.map((u) => [u.code, u.name]));
  const scheduleName = new Map(schedules.map((s) => [s.code, s.name]));

  const beforeHire = asOf < employee.hire_date;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="View as of a date"
          description="Every record is dated, so the whole employee can be rewound."
        />
        <div className="px-6 pb-5">
          <form className="flex flex-wrap items-end gap-3">
            <Field label="Date" htmlFor="date" className="w-48">
              <DateInput id="date" name="date" defaultValue={asOf} />
            </Field>
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-ink-hover"
            >
              Show
            </button>
          </form>
        </div>
      </Card>

      {beforeHire ? (
        <Notice icon={<Clock />}>
          {asOf} is before this employee joined on {employee.hire_date}, so there is
          nothing to show.
        </Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Personal data" description={`IT0002 as of ${asOf}`} />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Name">
                  {personal ? `${personal.first_name} ${personal.last_name}` : null}
                </KeyValueRow>
                <KeyValueRow label="Date of birth">
                  {personal?.date_of_birth ? (
                    <span className="tabular">{personal.date_of_birth}</span>
                  ) : null}
                </KeyValueRow>
                <KeyValueRow label="Gender">{personal?.gender}</KeyValueRow>
                <KeyValueRow label="Marital status">{personal?.marital_status}</KeyValueRow>
                <KeyValueRow label="Nationality">{personal?.nationality}</KeyValueRow>
              </KeyValue>
            </div>
          </Card>

          <Card>
            <CardHeader title="Org assignment" description={`IT0001 as of ${asOf}`} />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Position">
                  {org ? `${org.position_code} — ${positionTitle.get(org.position_code) ?? ""}` : null}
                </KeyValueRow>
                <KeyValueRow label="Department">
                  {org ? unitName.get(org.org_unit_code) ?? org.org_unit_code : null}
                </KeyValueRow>
                <KeyValueRow label="Company">{org?.company_code}</KeyValueRow>
                <KeyValueRow label="Cost centre">{org?.cost_center}</KeyValueRow>
              </KeyValue>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Basic pay"
              description={`IT0008 as of ${asOf}`}
            />
            <div className="px-6 pb-5">
              <div className="text-[13px] text-muted">Monthly basic</div>
              <div className="tabular mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                {pay ? formatINR(Number(pay.amount_paise)) : "—"}
              </div>
              {pay ? (
                <p className="mt-1 text-[13px] text-muted">
                  Pay scale {String(pay.pay_scale_group ?? "—")}, valid from{" "}
                  {String(pay.valid_from)}
                  {String(pay.valid_to) === "9999-12-31"
                    ? ""
                    : ` to ${String(pay.valid_to)}`}
                  .
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Working time and bank" description={`IT0007 and IT0009 as of ${asOf}`} />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Work schedule">
                  {time ? scheduleName.get(String(time.work_schedule_code)) ?? String(time.work_schedule_code) : null}
                </KeyValueRow>
                <KeyValueRow label="Weekly hours">
                  {time ? <span className="tabular">{String(time.weekly_hours)}</span> : null}
                </KeyValueRow>
                <KeyValueRow label="Bank">{bank?.bank_name}</KeyValueRow>
                <KeyValueRow label="Account">
                  {bank?.account_number ? (
                    <span className="tabular">{bank.account_number}</span>
                  ) : null}
                </KeyValueRow>
              </KeyValue>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
