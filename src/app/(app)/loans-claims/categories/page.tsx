import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyClaimCategory, pyClaimCategoryLimit } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { RateSection } from "@/components/rate-section";
import { saveClaimCategory, deleteClaimCategory, saveClaimCategoryLimit, deleteClaimCategoryLimit } from "@/app/actions/loans-claims";
import { formatINR } from "@/lib/money";
import { Status } from "@/components/ui";
import { LoansClaimsTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Category" },
  { key: "taxable", label: "Taxable" },
  { key: "limit", label: "Default annual limit", numeric: true },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Category code", required: true, placeholder: "FUEL", uppercase: true },
  { kind: "text", name: "name", label: "Category name", required: true },
  { kind: "text", name: "defaultAnnualLimit", label: "Default annual limit", required: true, hint: "In rupees." },
  { kind: "checkbox", name: "isTaxable", label: "Taxable" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** What a claim can be for, its annual limit, and whether it is taxable. */
export default async function ClaimCategoriesPage() {
  await requirePage(["payroll.setup"], "/loans-claims/my-claims");

  const [categories, limits] = await Promise.all([
    db.select().from(pyClaimCategory).orderBy(asc(pyClaimCategory.code)),
    db.select().from(pyClaimCategoryLimit).orderBy(asc(pyClaimCategoryLimit.categoryCode)),
  ]);
  const categoryName = new Map(categories.map((c) => [c.code, c.name]));

  return (
    <>
      <LoansClaimsTabs />
      <MasterScreen
        title="Claim categories"
        subtitle="What a claim can be for, each with its own annual limit and whether it is taxable."
        entity="claim category"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveClaimCategory}
        deleteAction={deleteClaimCategory}
        emptyHint="Add a category, such as fuel or phone."
        rows={categories.map((c) => ({
          id: c.code,
          describe: `${c.code} — ${c.name}`,
          cells: {
            code: <span className="font-medium text-ink">{c.code}</span>,
            name: c.name,
            taxable: <Status tone={c.isTaxable ? "neutral" : "done"}>{c.isTaxable ? "Taxable" : "Exempt"}</Status>,
            limit: formatINR(c.defaultAnnualLimitPaise),
            status: <Status tone={c.isActive ? "done" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Status>,
          },
          values: {
            code: c.code,
            name: c.name,
            defaultAnnualLimit: String(c.defaultAnnualLimitPaise / 100),
            isTaxable: c.isTaxable,
            isActive: c.isActive,
          },
        }))}
      />

      <RateSection
        title="Limits by grade"
        description="Overrides a category's default limit for one grade — the most specific limit wins, the same rule a leave policy follows."
        entity="grade limit"
        idField="id"
        saveAction={saveClaimCategoryLimit}
        deleteAction={deleteClaimCategoryLimit}
        emptyHint="Add one only where a grade's limit should differ from the category's default."
        columns={[
          { key: "category", label: "Category" },
          { key: "grade", label: "Grade" },
          { key: "limit", label: "Annual limit", numeric: true },
        ]}
        rows={limits.map((l) => ({
          id: String(l.id),
          describe: `${categoryName.get(l.categoryCode) ?? l.categoryCode}, grade ${l.grade}`,
          cells: {
            category: <span className="font-medium text-ink">{categoryName.get(l.categoryCode) ?? l.categoryCode}</span>,
            grade: l.grade,
            limit: formatINR(l.annualLimitPaise),
          },
          values: { categoryCode: l.categoryCode, grade: l.grade, annualLimit: String(l.annualLimitPaise / 100) },
        }))}
        fields={[
          { kind: "select", name: "categoryCode", label: "Category", required: true, options: categories.map((c) => ({ value: c.code, label: c.name })) },
          { kind: "text", name: "grade", label: "Grade", required: true, placeholder: "M1" },
          { kind: "text", name: "annualLimit", label: "Annual limit", required: true, hint: "In rupees." },
        ]}
      />
    </>
  );
}
