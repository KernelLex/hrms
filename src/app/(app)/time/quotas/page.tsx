import { requirePage } from "@/lib/access";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptAbsenceQuota, ptQuotaType } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatDays } from "@/lib/engines/quota";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  FigureRow,
  Figure,
  EmptyState,
} from "@/components/ui";
import { CalendarDays } from "lucide-react";
import { TimeTabs } from "../tabs";
import { GenerateQuotaForm } from "./form";

/** TM-03 — leave entitlement and balances. */
export default async function QuotasPage(props: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requirePage(["time.manage"], "/time/my-leave");

  const params = await props.searchParams;
  const year = Number(params.year) || new Date().getUTCFullYear();

  const [quotas, types, employees] = await Promise.all([
    db
      .select({
        id: ptAbsenceQuota.id,
        employeeId: ptAbsenceQuota.employeeId,
        quotaTypeCode: ptAbsenceQuota.quotaTypeCode,
        quotaTypeName: ptQuotaType.name,
        year: ptAbsenceQuota.year,
        entitled: ptAbsenceQuota.entitledHalfDays,
        used: ptAbsenceQuota.usedHalfDays,
      })
      .from(ptAbsenceQuota)
      .innerJoin(ptQuotaType, eq(ptQuotaType.code, ptAbsenceQuota.quotaTypeCode))
      .where(eq(ptAbsenceQuota.year, year))
      .orderBy(asc(ptAbsenceQuota.employeeId), asc(ptAbsenceQuota.quotaTypeCode)),
    db.select().from(ptQuotaType).orderBy(asc(ptQuotaType.code)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const annual = quotas.filter((q) => q.quotaTypeCode === "ANNUAL");
  const totalEntitled = annual.reduce((s, q) => s + q.entitled, 0);
  const totalUsed = annual.reduce((s, q) => s + q.used, 0);
  const fullyUsed = annual.filter((q) => q.entitled > 0 && q.used >= q.entitled).length;

  return (
    <>
      <TimeTabs />
      <PageHeader
        title="Quotas"
        subtitle={`Leave entitlement and what is left of it, for ${year}. Balances move when a manager approves a request, not when one is submitted.`}
      />

      <FigureRow>
        <Figure label="Annual leave granted" value={formatDays(totalEntitled)} hint="days across all employees" />
        <Figure label="Taken" value={formatDays(totalUsed)} hint="days approved so far" />
        <Figure label="Remaining" value={formatDays(totalEntitled - totalUsed)} hint="days still available" />
        <Figure
          label="Fully used"
          value={fullyUsed}
          hint={`of ${annual.length} employees`}
        />
      </FigureRow>

      <div className="mt-6">
        <GenerateQuotaForm
          year={year}
          types={types.map((t) => ({
            value: t.code,
            label: t.name,
            defaultDays: t.defaultEntitlementDays,
          }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          {quotas.length === 0 ? (
            <EmptyState icon={<CalendarDays />} title={`No quotas for ${year}`}>
              Generate entitlement above to give employees leave for this year.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Quota</Th>
                  <Th numeric>Entitled</Th>
                  <Th numeric>Used</Th>
                  <Th numeric>Balance</Th>
                  <Th>Consumed</Th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((q) => {
                  const balance = q.entitled - q.used;
                  const pct = q.entitled > 0 ? Math.round((q.used / q.entitled) * 100) : 0;
                  return (
                    <Tr key={q.id}>
                      <Td>
                        <TwoLine
                          value={name.get(q.employeeId) ?? "—"}
                          sub={numberOf.get(q.employeeId)}
                        />
                      </Td>
                      <Td>
                        <span className="text-secondary">{q.quotaTypeName}</span>
                      </Td>
                      <Td numeric>{formatDays(q.entitled)}</Td>
                      <Td numeric>{formatDays(q.used)}</Td>
                      <Td numeric>
                        <span className="font-medium text-ink">{formatDays(balance)}</span>
                      </Td>
                      <Td>
                        {/* §8.10 Meters: an 8px pill, soft track, ink fill. */}
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-soft">
                            <div
                              className="h-full rounded-full bg-ink"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="tabular text-xs text-muted">{pct}%</span>
                        </div>
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
