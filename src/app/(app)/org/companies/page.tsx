import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omCompany } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveCompany, deleteCompany } from "@/app/actions/org";
import { Status } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Company code", required: true, placeholder: "CO01", uppercase: true },
  { kind: "text", name: "name", label: "Company name", required: true, placeholder: "Acme Manufacturing Pvt Ltd" },
  { kind: "text", name: "address", label: "Address", full: true, placeholder: "Plot 12, Industrial Area" },
  { kind: "text", name: "city", label: "City", placeholder: "Bengaluru" },
  { kind: "text", name: "country", label: "Country", placeholder: "India" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

export default async function CompaniesPage() {
  const rows = await db.select().from(omCompany).orderBy(asc(omCompany.code));

  return (
    <MasterScreen
      title="Companies"
      subtitle="The root of the enterprise structure. Every department and position belongs to one."
      entity="company"
      columns={COLUMNS}
      idField="code"
      fields={FIELDS}
      saveAction={saveCompany}
      deleteAction={deleteCompany}
      emptyHint="Add the first company to start building the org structure."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          city: r.city ?? <span className="text-decor">&mdash;</span>,
          country: r.country ?? <span className="text-decor">&mdash;</span>,
          status: (
            <Status tone={r.isActive ? "done" : "neutral"}>
              {r.isActive ? "Active" : "Inactive"}
            </Status>
          ),
        },
        values: {
          code: r.code,
          name: r.name,
          address: r.address ?? "",
          city: r.city ?? "",
          country: r.country ?? "",
          isActive: r.isActive,
        },
      }))}
    />
  );
}
