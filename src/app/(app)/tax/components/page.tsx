import { requirePage } from "@/lib/access";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { txComponent, txCompanyComponent, txCityCategory, omCompany, COMPONENT_KINDS, CITY_CATEGORIES } from "@/db/schema";
import { formatINR, toRupees } from "@/lib/money";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveComponent, deleteComponent, saveCompanyComponent, saveCityCategory, deleteCityCategory } from "@/app/actions/tax";
import { Status, Badge, Card, CardHeader } from "@/components/ui";
import { TaxTabs } from "../tabs";
import { CompanyComponents } from "./company";

const KIND_LABELS: Record<string, string> = {
  section_10: "Exemption under section 10",
  chapter_via: "Deduction under Chapter VI-A",
  other_income: "Other income",
};

const COLUMNS: Column[] = [
  { key: "code", label: "Section" },
  { key: "name", label: "What it covers" },
  { key: "country", label: "Country" },
  { key: "kind", label: "Where it lands" },
  { key: "cap", label: "Cap", numeric: true },
  { key: "rules", label: "Rules" },
  { key: "status", label: "Status" },
];

const CITY_COLUMNS: Column[] = [
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "category", label: "For HRA" },
];

/**
 * TDS-06 — what may be declared, and where.
 *
 * The statutory list belongs to a country, so that is where a component is
 * defined; a company then says which of them it offers and may tighten a
 * cap. Nothing in the engine reads a component by name — each declares
 * where it lands in the computation, and the declared figures sum by that.
 */
export default async function TaxComponentsPage() {
  await requirePage(["tax.manage"], "/tax/declarations");

  const [components, companies, chosen, cities] = await Promise.all([
    db.select().from(txComponent).orderBy(asc(txComponent.country), asc(txComponent.sortOrder), asc(txComponent.code)),
    db.select().from(omCompany).where(eq(omCompany.isActive, true)).orderBy(asc(omCompany.code)),
    db.select().from(txCompanyComponent),
    db.select().from(txCityCategory).orderBy(asc(txCityCategory.country), asc(txCityCategory.city)),
  ]);

  const fields: FieldDef[] = [
    { kind: "text", name: "country", label: "Country", required: true, placeholder: "India", hint: "Whose tax law this belongs to." },
    { kind: "text", name: "code", label: "Section", required: true, placeholder: "80C", uppercase: true },
    { kind: "text", name: "name", label: "What it covers", required: true, full: true, placeholder: "LIC, PPF and ELSS" },
    {
      kind: "select",
      name: "kind",
      label: "Where it lands",
      required: true,
      options: COMPONENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
      hint: "What the computation does with it. Nothing is matched by name.",
    },
    { kind: "text", name: "cap", label: "Cap", placeholder: "150000", hint: "The statutory ceiling in rupees. Leave empty where the law sets none." },
    { kind: "text", name: "sortOrder", label: "Order", placeholder: "10", hint: "Where it appears on the declaration." },
    { kind: "checkbox", name: "requiresProof", label: "Needs proof before it reduces tax" },
    { kind: "checkbox", name: "isDerived", label: "Worked out, not typed in (HRA)" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  const cityFields: FieldDef[] = [
    { kind: "text", name: "country", label: "Country", required: true, placeholder: "India" },
    { kind: "text", name: "city", label: "City", required: true, placeholder: "Delhi", uppercase: true, hint: "Matched against the employee's address." },
    {
      kind: "select",
      name: "category",
      label: "For HRA",
      required: true,
      options: CITY_CATEGORIES.map((c) => ({ value: c, label: c === "METRO" ? "Metro — 50% of basic" : "Non-metro — 40% of basic" })),
    },
  ];

  return (
    <>
      <TaxTabs />
      <MasterScreen
        title="Declaration components"
        subtitle="What an employee may declare, and what the computation does with each one. Defined per country, because the statutory list is national; each company then chooses which of them it offers."
        entity="component"
        columns={COLUMNS}
        idField="code"
        fields={fields}
        saveAction={saveComponent}
        deleteAction={deleteComponent}
        wideDialog
        emptyHint="Add the sections your people may declare against."
        rows={components.map((c) => ({
          id: c.code,
          describe: `${c.code} — ${c.name}`,
          cells: {
            code: <span className="font-medium text-ink">{c.code}</span>,
            name: c.name,
            country: <span className="text-secondary">{c.country}</span>,
            kind: <span className="text-secondary">{KIND_LABELS[c.kind] ?? c.kind}</span>,
            cap: <span className="tabular text-secondary">{c.capPaise === null ? "—" : formatINR(c.capPaise)}</span>,
            rules: (
              <span className="flex flex-wrap gap-1">
                {c.requiresProof ? <Badge tone="neutral">Proof</Badge> : null}
                {c.isDerived ? <Badge tone="action">Computed</Badge> : null}
              </span>
            ),
            status: <Status tone={c.isActive ? "done" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Status>,
          },
          values: {
            country: c.country,
            code: c.code,
            name: c.name,
            kind: c.kind,
            cap: c.capPaise === null ? "" : String(toRupees(c.capPaise)),
            sortOrder: String(c.sortOrder),
            requiresProof: c.requiresProof,
            isDerived: c.isDerived,
            isActive: c.isActive,
          },
        }))}
      />

      <div className="mt-6">
        <Card>
          <CardHeader
            title="What each company offers"
            description="A company offers everything its country defines unless you say otherwise here, and may set a lower cap than the law — never a higher one."
          />
          <CompanyComponents
            companies={companies.map((c) => ({ code: c.code, name: c.name, country: c.country ?? "India" }))}
            components={components.map((c) => ({ country: c.country, code: c.code, name: c.name, capPaise: c.capPaise }))}
            chosen={chosen.map((c) => ({
              companyCode: c.companyCode,
              componentCode: c.componentCode,
              isEnabled: c.isEnabled,
              capOverridePaise: c.capOverridePaise,
            }))}
            save={saveCompanyComponent}
          />
        </Card>
      </div>

      <div className="mt-6">
        <MasterScreen
          title="Metro cities"
          subtitle="The HRA exemption is half of basic in a metro and two fifths everywhere else. These are the cities that count as metro — matched against the employee's own address, and overridable per person on their rent record."
          entity="city"
          columns={CITY_COLUMNS}
          idField="city"
          fields={cityFields}
          saveAction={saveCityCategory}
          deleteAction={deleteCityCategory}
          emptyHint="Name the cities the law treats as metro."
          rows={cities.map((c) => ({
            id: c.city,
            describe: `${c.city}, ${c.country}`,
            cells: {
              city: <span className="font-medium text-ink">{c.city}</span>,
              country: <span className="text-secondary">{c.country}</span>,
              category: (
                <Status tone={c.category === "METRO" ? "action" : "neutral"}>
                  {c.category === "METRO" ? "Metro — 50%" : "Non-metro — 40%"}
                </Status>
              ),
            },
            values: { country: c.country, city: c.city, category: c.category },
          }))}
        />
      </div>
    </>
  );
}
