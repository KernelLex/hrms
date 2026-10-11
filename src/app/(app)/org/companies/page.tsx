import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omCompany, omOrgUnit } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveCompany, deleteCompany } from "@/app/actions/org";
import { Status } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "parent", label: "Part of" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "books", label: "Books" },
  { key: "status", label: "Status" },
];

export default async function CompaniesPage() {
  const [rows, groupNodes] = await Promise.all([
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
  ]);
  const nodeName = new Map(groupNodes.map((n) => [n.code, n.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Company code", required: true, placeholder: "CO01", uppercase: true },
    { kind: "text", name: "name", label: "Company name", required: true, placeholder: "Acme Manufacturing Pvt Ltd" },
    {
      kind: "select",
      name: "parentNodeCode",
      label: "Part of",
      options: groupNodes.map((n) => ({ value: n.code, label: `${n.code} — ${n.name}` })),
      emptyLabel: "Stands alone",
      hint: "The group this legal entity belongs to, for an organisation that owns several.",
    },
    { kind: "text", name: "address", label: "Address", full: true, placeholder: "Plot 12, Industrial Area" },
    { kind: "text", name: "city", label: "City", placeholder: "Bengaluru" },
    { kind: "text", name: "country", label: "Country", placeholder: "India" },
    { kind: "text", name: "currency", label: "Currency", required: true, placeholder: "INR", uppercase: true, hint: "The three-letter code this entity pays in." },
    { kind: "text", name: "fiscalYearStart", label: "Fiscal year starts", required: true, placeholder: "04-01", hint: "The first day of its financial year, as MM-DD." },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Companies"
      subtitle="The legal entities. Every org unit and position belongs to one, and several of them can sit under a single group."
      entity="company"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveCompany}
      deleteAction={deleteCompany}
      emptyHint="Add the first company to start building the org structure."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          parent: r.parentNodeCode ? (
            <span className="text-secondary">{nodeName.get(r.parentNodeCode) ?? r.parentNodeCode}</span>
          ) : (
            <span className="text-muted">Stands alone</span>
          ),
          city: r.city ?? <span className="text-decor">&mdash;</span>,
          country: r.country ?? <span className="text-decor">&mdash;</span>,
          books: (
            <span className="tabular text-secondary">
              {r.currency}, year from {r.fiscalYearStart}
            </span>
          ),
          status: (
            <Status tone={r.isActive ? "done" : "neutral"}>
              {r.isActive ? "Active" : "Inactive"}
            </Status>
          ),
        },
        values: {
          code: r.code,
          name: r.name,
          parentNodeCode: r.parentNodeCode ?? "",
          address: r.address ?? "",
          city: r.city ?? "",
          country: r.country ?? "",
          currency: r.currency,
          fiscalYearStart: r.fiscalYearStart,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
