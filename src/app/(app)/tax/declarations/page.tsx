import { can, requirePage } from "@/lib/access";
import { asc, count, desc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { tdsEmployeeDeclaration, tdsTaxSlab } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR, toRupees } from "@/lib/money";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveDeclaration, deleteDeclaration } from "@/app/actions/tax";
import { compareRegimes, financialYearOf } from "@/lib/engines/tax";
import { todayInIndia } from "@/lib/dates";
import { Status, TwoLine, Notice, Card, CardHeader, Table, Th, Tr, Td } from "@/components/ui";
import { TaxTabs } from "../tabs";
import { RentForm, ProofForm } from "./extras";
import { Pagination, pageFrom } from "@/components/pagination";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "year", label: "Year" },
  { key: "regime", label: "Regime" },
  { key: "s80c", label: "80C", numeric: true },
  { key: "s80d", label: "80D", numeric: true },
  { key: "hra", label: "HRA exemption", numeric: true },
  { key: "status", label: "Status" },
];

/** TDS-02 — investment declarations, which Form 16 Part B computes from. */
export default async function DeclarationsPage(props: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requirePage(["self.tax", "tax.manage"]);
  const isHr = can(session, "tax.manage");
  const { page, limit, offset } = pageFrom((await props.searchParams).page);

  // An employee's request reads only their own declarations, not everyone's
  // filtered afterwards.
  const mine = isHr ? undefined : eq(tdsEmployeeDeclaration.employeeId, session.employeeId ?? -1);
  const [rows, [{ n: total }], employees, slabs] = await Promise.all([
    db
      .select()
      .from(tdsEmployeeDeclaration)
      .where(mine)
      .orderBy(desc(tdsEmployeeDeclaration.financialYear), asc(tdsEmployeeDeclaration.employeeId))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(tdsEmployeeDeclaration).where(mine),
    listEmployees(),
    db.selectDistinct({ fy: tdsTaxSlab.financialYear }).from(tdsTaxSlab),
  ]);

  const currentYear = financialYearOf(todayInIndia());
  const [currentDeclaration, basicPayRow, rentRow] = !isHr && session.employeeId
    ? await Promise.all([
        db.query.tdsEmployeeDeclaration.findFirst({ where: (d, { and, eq }) => and(eq(d.employeeId, session.employeeId!), eq(d.financialYear, currentYear)) }),
        rawClient().execute({
          sql: "SELECT amount_paise FROM pa_it0008_basic_pay WHERE employee_id = ? AND valid_from <= date('now') AND valid_to >= date('now') LIMIT 1",
          args: [session.employeeId],
        }),
        rawClient().execute({ sql: "SELECT * FROM tds_rent WHERE employee_id = ? AND financial_year = ?", args: [session.employeeId, currentYear] }),
      ])
    : [undefined, undefined, undefined];
  const basicPaise = basicPayRow?.rows[0] ? Number(basicPayRow.rows[0].amount_paise) : 0;
  const rent = rentRow?.rows[0];
  const comparison = basicPaise
    ? await compareRegimes({
        grossSalaryPaise: basicPaise * 12 * 2, // a rough projection: basic is roughly half of gross under a typical structure
        financialYear: currentYear,
        chapterViaPaise: (currentDeclaration?.section80CPaise ?? 0) + (currentDeclaration?.section80DPaise ?? 0),
        section10ExemptPaise: currentDeclaration?.hraExemptionPaise ?? 0,
        otherIncomePaise: currentDeclaration?.otherIncomePaise ?? 0,
      })
    : null;

  const years = [...new Set(slabs.map((s) => s.fy))].sort().reverse();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));
  const dash = <span className="text-decor">&mdash;</span>;

  const fields: FieldDef[] = [
    ...(isHr
      ? ([
          {
            kind: "select",
            name: "employeeId",
            label: "Employee",
            required: true,
            options: employees.map((e) => ({
              value: String(e.id),
              label: `${e.employee_number} — ${fullName(e)}`,
            })),
          },
        ] as FieldDef[])
      : []),
    {
      kind: "select",
      name: "financialYear",
      label: "Financial year",
      required: true,
      options: years.map((y) => ({ value: y, label: y })),
    },
    {
      kind: "select",
      name: "regime",
      label: "Tax regime",
      required: true,
      options: [
        { value: "New", label: "New — larger standard deduction, no exemptions" },
        { value: "Old", label: "Old — exemptions and Chapter VI-A allowed" },
      ],
      hint: "Under the new regime the amounts below are stored but not applied.",
    },
    { kind: "text", name: "section80C", label: "Section 80C", placeholder: "150000", hint: "PF, LIC, ELSS. Capped at ₹1,50,000." },
    { kind: "text", name: "section80D", label: "Section 80D", placeholder: "25000", hint: "Medical insurance. Capped at ₹25,000." },
    { kind: "text", name: "hraExemption", label: "HRA exemption", placeholder: "144000" },
    { kind: "text", name: "otherIncome", label: "Other income", placeholder: "0" },
    ...(isHr
      ? ([
          {
            kind: "select",
            name: "status",
            label: "Status",
            required: true,
            options: ["Declared", "Verified", "Pending"].map((s) => ({ value: s, label: s })),
          },
        ] as FieldDef[])
      : []),
  ];

  return (
    <>
      {isHr ? <TaxTabs /> : null}
      {!isHr ? (
        <div className="mb-6">
          <Notice>
            What you declare here changes the tax deducted from your salary each
            month, and the computation on your Form 16. A verified declaration
            can only be changed by HR.
          </Notice>
        </div>
      ) : null}
      <MasterScreen
        total={total}
        footer={<Pagination page={page} total={total} path="/tax/declarations" noun="declarations" />}
        title={isHr ? "Tax declarations" : "My tax declaration"}
        subtitle={
          isHr
            ? "What each employee has declared. Payroll reads this when it computes monthly TDS, and Form 16 Part B computes from it."
            : "Your investments and exemptions for the year."
        }
        entity="declaration"
        columns={isHr ? COLUMNS : COLUMNS.filter((c) => c.key !== "employee")}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveDeclaration}
        deleteAction={deleteDeclaration}
        wideDialog
        emptyHint={
          isHr
            ? "Record what an employee has declared for the year."
            : "Declare your investments so the right tax is deducted."
        }
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.financialYear}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            year: <span className="tabular">{r.financialYear}</span>,
            regime: <span className="text-secondary">{r.regime}</span>,
            // Under the new regime these are stored but not applied.
            s80c:
              r.regime === "Old"
                ? r.section80CPaise > 0
                  ? formatINR(r.section80CPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            s80d:
              r.regime === "Old"
                ? r.section80DPaise > 0
                  ? formatINR(r.section80DPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            hra:
              r.regime === "Old"
                ? r.hraExemptionPaise > 0
                  ? formatINR(r.hraExemptionPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            status: (
              <Status
                tone={
                  r.status === "Verified" ? "done" : r.status === "Declared" ? "action" : "waiting"
                }
              >
                {r.status}
              </Status>
            ),
          },
          values: {
            employeeId: String(r.employeeId),
            financialYear: r.financialYear,
            regime: r.regime,
            section80C: r.section80CPaise ? String(toRupees(r.section80CPaise)) : "",
            section80D: r.section80DPaise ? String(toRupees(r.section80DPaise)) : "",
            hraExemption: r.hraExemptionPaise ? String(toRupees(r.hraExemptionPaise)) : "",
            otherIncome: r.otherIncomePaise ? String(toRupees(r.otherIncomePaise)) : "",
            status: r.status,
          },
        }))}
      />

      {!isHr && comparison ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Old regime versus new" description={`Projected for ${currentYear}, from your current basic pay — what payroll's own monthly TDS computes from, under each regime.`} />
            <Table>
              <thead>
                <tr>
                  <Th>Regime</Th>
                  <Th numeric>Taxable income</Th>
                  <Th numeric>Total tax</Th>
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td>Old {comparison.betterRegime === "Old" ? <Status tone="done">Lower</Status> : null}</Td>
                  <Td numeric>{formatINR(comparison.old.taxableIncomePaise)}</Td>
                  <Td numeric>{formatINR(comparison.old.totalTaxPaise)}</Td>
                </Tr>
                <Tr>
                  <Td>New {comparison.betterRegime === "New" ? <Status tone="done">Lower</Status> : null}</Td>
                  <Td numeric>{formatINR(comparison.new.taxableIncomePaise)}</Td>
                  <Td numeric>{formatINR(comparison.new.totalTaxPaise)}</Td>
                </Tr>
              </tbody>
            </Table>
            <div className="px-6 pb-5 text-[13px] text-secondary">The {comparison.betterRegime.toLowerCase()} regime saves {formatINR(comparison.savingsPaise)} here.</div>
          </Card>
        </div>
      ) : null}

      {!isHr ? (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <RentForm
            financialYear={currentYear}
            rent={
              rent
                ? { monthlyRent: String(toRupees(Number(rent.monthly_rent_paise))), landlordName: String(rent.landlord_name), landlordPan: rent.landlord_pan ? String(rent.landlord_pan) : "", isMetro: Number(rent.is_metro) === 1 }
                : undefined
            }
          />
          <ProofForm financialYear={currentYear} />
        </div>
      ) : null}
    </>
  );
}
