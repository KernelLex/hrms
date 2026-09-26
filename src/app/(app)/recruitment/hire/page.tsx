import Link from "next/link";
import { requirePage } from "@/lib/access";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  rcApplication,
  rcCandidate,
  rcRequisition,
  rcHireConversion,
  omPosition,
  omOrgUnit,
  omJob,
} from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR, toRupees } from "@/lib/money";
import {
  Card,
  CardHeader,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  EmptyState,
  Notice,
} from "@/components/ui";
import { UserCheck } from "lucide-react";
import { RecruitmentTabs } from "../tabs";
import { ConvertForm } from "./form";
import { formatDate } from "@/lib/dates";

/** RC-05 — hire conversion, the bridge into Core HR. */
export default async function HireConversionPage() {
  await requirePage(["recruitment.hire"], "/recruitment");

  const [offered, conversions, positions, units, jobs, employees] = await Promise.all([
    db
      .select({
        id: rcApplication.id,
        offeredSalaryPaise: rcApplication.offeredSalaryPaise,
        candidateName: rcCandidate.fullName,
        candidateCode: rcCandidate.code,
        candidateEmail: rcCandidate.email,
        requisitionCode: rcRequisition.code,
        positionCode: rcRequisition.positionCode,
        orgUnitCode: rcRequisition.orgUnitCode,
        jobCode: rcRequisition.jobCode,
      })
      .from(rcApplication)
      .innerJoin(rcCandidate, eq(rcCandidate.id, rcApplication.candidateId))
      .innerJoin(rcRequisition, eq(rcRequisition.id, rcApplication.requisitionId))
      .where(eq(rcApplication.stage, "Offered")),
    db
      .select({
        id: rcHireConversion.id,
        employeeId: rcHireConversion.employeeId,
        hireDate: rcHireConversion.hireDate,
        offeredSalaryPaise: rcHireConversion.offeredSalaryPaise,
        convertedBy: rcHireConversion.convertedBy,
        candidateName: rcCandidate.fullName,
        requisitionCode: rcRequisition.code,
      })
      .from(rcHireConversion)
      .innerJoin(rcApplication, eq(rcApplication.id, rcHireConversion.applicationId))
      .innerJoin(rcCandidate, eq(rcCandidate.id, rcApplication.candidateId))
      .innerJoin(rcRequisition, eq(rcRequisition.id, rcApplication.requisitionId))
      .orderBy(desc(rcHireConversion.convertedAt)),
    db.select().from(omPosition),
    db.select().from(omOrgUnit),
    db.select().from(omJob),
    listEmployees(),
  ]);

  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));
  const positionVacant = new Map(positions.map((p) => [p.code, p.isVacant]));
  const unitName = new Map(units.map((u) => [u.code, u.name]));
  const jobTitle = new Map(jobs.map((j) => [j.code, j.title]));
  const employeeNumber = new Map(employees.map((e) => [e.id, e.employee_number]));
  const employeeName = new Map(employees.map((e) => [e.id, fullName(e)]));

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        title="Hire conversion"
        subtitle="Turns an offered candidate into an employee using the same hire action Core HR uses — employee, org assignment, personal data, working time, basic pay and contact, all or nothing."
      />

      {offered.length === 0 ? (
        <Card>
          <EmptyState icon={<UserCheck />} title="Nobody is at the offer stage">
            Advance a candidate to offered on the pipeline tab, and they appear
            here ready to convert.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {offered.map((o) => {
            const vacant = positionVacant.get(o.positionCode) ?? false;
            return (
              <Card key={o.id}>
                <CardHeader
                  title={o.candidateName}
                  description={`${o.candidateCode}, offered against ${o.requisitionCode}`}
                />
                <div className="px-6 pb-5">
                  {!vacant ? (
                    <Notice problem>
                      {o.positionCode} has been filled since the offer was made.
                      Free it, or move this candidate to another requisition,
                      before converting.
                    </Notice>
                  ) : null}

                  <dl className="mb-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                    {[
                      ["Position", `${o.positionCode} — ${positionTitle.get(o.positionCode) ?? ""}`],
                      ["Department", unitName.get(o.orgUnitCode) ?? o.orgUnitCode],
                      ["Job", jobTitle.get(o.jobCode) ?? o.jobCode],
                      ["Email", o.candidateEmail],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[13px] text-muted">{label}</dt>
                        <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <ConvertForm
                    applicationId={o.id}
                    defaultSalary={
                      o.offeredSalaryPaise ? String(toRupees(o.offeredSalaryPaise)) : ""
                    }
                    disabled={!vacant}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {conversions.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Conversion history"
              description="Which candidate became which employee."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Employee</Th>
                  <Th>Requisition</Th>
                  <Th>Hire date</Th>
                  <Th numeric>Starting salary</Th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <span className="font-medium text-ink">{c.candidateName}</span>
                    </Td>
                    <Td>
                      <Link href={`/core-hr/${c.employeeId}`} className="hover:underline">
                        <TwoLine
                          value={employeeName.get(c.employeeId) ?? "—"}
                          sub={employeeNumber.get(c.employeeId)}
                        />
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-secondary">{c.requisitionCode}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(c.hireDate)}</span>
                    </Td>
                    <Td numeric>{formatINR(c.offeredSalaryPaise)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
