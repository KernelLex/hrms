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
import { companyOf, componentsFor, hraExemptionFor, linesFor, rollUp } from "@/lib/services/tax-components";
import { Pagination, pageFrom } from "@/components/pagination";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "year", label: "Year" },
  { key: "regime", label: "Regime" },
  { key: "exempt", label: "Section 10", numeric: true },
  { key: "chapter", label: "Chapter VI-A", numeric: true },
  { key: "declared", label: "Declared" },
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

  // What may be declared is the company's catalogue. HR sees the catalogue of
  // the company the first listed employee belongs to; an employee sees their
  // own. Both read it the same way, so neither can drift from what is saved.
  const forCompany = isHr
    ? (await companyOf(rows[0]?.employeeId ?? -1, todayInIndia())) ?? (employees[0] ? await companyOf(employees[0].id, todayInIndia()) : null)
    : session.employeeId
      ? await companyOf(session.employeeId, todayInIndia())
      : null;
  const components = await componentsFor(forCompany);
  const linesByDeclaration = new Map<number, Awaited<ReturnType<typeof linesFor>>>(
    await Promise.all(rows.map(async (r) => [r.id, await linesFor(r.id)] as const)),
  );

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
  const hraPaise = !isHr && session.employeeId ? await hraExemptionFor(session.employeeId, currentYear, todayInIndia()) : 0;
  const currentRollUp = rollUp(currentDeclaration ? (linesByDeclaration.get(currentDeclaration.id) ?? await linesFor(currentDeclaration.id)) : [], components);
  const comparison = basicPaise
    ? await compareRegimes({
        grossSalaryPaise: basicPaise * 12 * 2, // a rough projection: basic is roughly half of gross under a typical structure
        financialYear: currentYear,
        chapterViaPaise: currentRollUp.chapterViaPaise,
        section10ExemptPaise: currentRollUp.section10ExemptPaise,
        otherIncomePaise: currentRollUp.otherIncomePaise,
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
    ...components
      .filter((c) => !c.isDerived)
      .map(
        (c): FieldDef => ({
          kind: "text",
          name: `component.${c.code}`,
          label: `${c.code} — ${c.name}`,
          placeholder: "0",
          hint: c.capPaise === null ? undefined : `Capped at ${formatINR(c.capPaise)}.`,
        }),
      ),
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
        rows={rows.map((r) => {
          const lines = linesByDeclaration.get(r.id) ?? [];
          const totals = rollUp(lines, components);
          return {
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.financialYear}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            year: <span className="tabular">{r.financialYear}</span>,
            regime: <span className="text-secondary">{r.regime}</span>,
            // Under the new regime these are stored but not applied.
            exempt:
              r.regime === "Old"
                ? totals.section10ExemptPaise > 0
                  ? formatINR(totals.section10ExemptPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            chapter:
              r.regime === "Old"
                ? totals.chapterViaPaise > 0
                  ? formatINR(totals.chapterViaPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            declared: (
              <span className="text-secondary">
                {lines.filter((l) => l.declaredPaise > 0).length === 0
                  ? dash
                  : lines
                      .filter((l) => l.declaredPaise > 0)
                      .map((l) => l.componentCode)
                      .join(", ")}
              </span>
            ),
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
            ...Object.fromEntries(
              lines.map((l) => [`component.${l.componentCode}`, l.declaredPaise ? String(toRupees(l.declaredPaise)) : ""]),
            ),
            status: r.status,
          },
          };
        })}
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
                ? {
                    monthlyRent: String(toRupees(Number(rent.monthly_rent_paise))),
                    landlordName: String(rent.landlord_name),
                    landlordPan: rent.landlord_pan ? String(rent.landlord_pan) : "",
                    isMetro: Number(rent.is_metro) === 1,
                    accommodationType: String(rent.accommodation_type ?? "Rented"),
                  }
                : undefined
            }
            exemption={hraPaise > 0 ? formatINR(hraPaise) : null}
          />
          <ProofForm
            financialYear={currentYear}
            sections={components.filter((c) => c.requiresProof).map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
          />
        </div>
      ) : null}
    </>
  );
}
