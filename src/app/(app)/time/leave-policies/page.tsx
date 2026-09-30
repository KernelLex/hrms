import { asc } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptLeavePolicy, ptQuotaType, omPersonnelArea } from "@/db/schema";
import { unitsToDays, formatDays } from "@/lib/engines/quota";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveLeavePolicy, deleteLeavePolicy } from "@/app/actions/time";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "quotaType", label: "Quota type" },
  { key: "scope", label: "Applies to" },
  { key: "entitlement", label: "Entitlement", numeric: true },
  { key: "accrual", label: "Accrual" },
  { key: "carryForward", label: "Carries fwd", numeric: true },
  { key: "encashable", label: "Encashable", numeric: true },
  { key: "status", label: "Status" },
];

/** TM-06 — what a quota type actually grants, to whom, and how. */
export default async function LeavePoliciesPage() {
  await requirePage(["time.manage"], "/time/my-leave");

  const [policies, quotaTypes, areas] = await Promise.all([
    db.select().from(ptLeavePolicy).orderBy(asc(ptLeavePolicy.code)),
    db.select().from(ptQuotaType).orderBy(asc(ptQuotaType.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.name)),
  ]);
  const quotaTypeName = new Map(quotaTypes.map((t) => [t.code, t.name]));
  const areaName = new Map(areas.map((a) => [a.code, a.name]));

  const FIELDS: FieldDef[] = [
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "ANNUAL-L4", uppercase: true },
    { kind: "text", name: "name", label: "Name", required: true, placeholder: "Annual leave, L4 and above" },
    {
      kind: "select",
      name: "quotaTypeCode",
      label: "Quota type",
      required: true,
      options: quotaTypes.map((t) => ({ value: t.code, label: t.name })),
    },
    { kind: "text", name: "appliesToGrade", label: "Grade", hint: "Leave blank for every grade." },
    {
      kind: "select",
      name: "appliesToAreaCode",
      label: "Personnel area",
      emptyLabel: "Every area",
      options: areas.map((a) => ({ value: a.code, label: a.name })),
      hint: "Leave unset for every area.",
    },
    { kind: "text", name: "entitlementDays", label: "Entitlement (days/year)", required: true, placeholder: "18" },
    {
      kind: "select",
      name: "accrualFrequency",
      label: "Accrual",
      required: true,
      options: [
        { value: "Yearly", label: "Yearly, all at once" },
        { value: "Monthly", label: "Monthly, a twelfth at a time" },
      ],
    },
    { kind: "checkbox", name: "proRataForJoiners", label: "Pro-rate a joiner's first year" },
    { kind: "text", name: "carryForwardCapDays", label: "Carry-forward cap (days)", placeholder: "5" },
    { kind: "text", name: "lapseOn", label: "Lapses on (MM-DD)", required: true, placeholder: "03-31" },
    { kind: "text", name: "encashableDays", label: "Encashable (days/year)", placeholder: "5" },
    { kind: "checkbox", name: "sandwichRule", label: "Sandwich rule: charge the gap either side too" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Leave policies"
        subtitle="What a quota type actually grants: how much, to whom, how it accrues, and what happens to what is left over. The most specific policy matching an employee's grade and area wins."
        entity="leave policy"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveLeavePolicy}
        deleteAction={deleteLeavePolicy}
        wideDialog
        emptyHint="Add a policy so the monthly accrual job and year-end close have something to grant against."
        rows={policies.map((p) => ({
          id: p.code,
          describe: `${p.code} — ${p.name}`,
          cells: {
            code: <span className="font-medium text-ink">{p.code}</span>,
            name: p.name,
            quotaType: quotaTypeName.get(p.quotaTypeCode) ?? p.quotaTypeCode,
            scope: [p.appliesToGrade, p.appliesToAreaCode ? areaName.get(p.appliesToAreaCode) ?? p.appliesToAreaCode : null]
              .filter(Boolean)
              .join(" · ") || "Everyone",
            entitlement: <span className="tabular">{formatDays(p.entitlementHalfDaysPerYear)}</span>,
            accrual: p.accrualFrequency,
            carryForward: <span className="tabular text-secondary">{formatDays(p.carryForwardCapHalfDays)}</span>,
            encashable: <span className="tabular text-secondary">{formatDays(p.encashableHalfDaysPerYear)}</span>,
            status: <Status tone={p.isActive ? "done" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Status>,
          },
          values: {
            code: p.code,
            name: p.name,
            quotaTypeCode: p.quotaTypeCode,
            appliesToGrade: p.appliesToGrade ?? "",
            appliesToAreaCode: p.appliesToAreaCode ?? "",
            entitlementDays: String(unitsToDays(p.entitlementHalfDaysPerYear)),
            accrualFrequency: p.accrualFrequency,
            proRataForJoiners: p.proRataForJoiners,
            carryForwardCapDays: String(unitsToDays(p.carryForwardCapHalfDays)),
            lapseOn: p.lapseOn,
            encashableDays: String(unitsToDays(p.encashableHalfDaysPerYear)),
            sandwichRule: p.sandwichRule,
            isActive: p.isActive,
          },
        }))}
      />
    </>
  );
}
