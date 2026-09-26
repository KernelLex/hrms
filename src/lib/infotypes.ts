import type { FieldDef } from "@/components/master-screen";

/**
 * The eight infotypes CH-02 maintains.
 *
 * `sliced` infotypes hold exactly one valid record at a time and are written
 * through the time-slice engine, which delimits whatever they supersede.
 * `repeating` infotypes hold several at once — an employee has one salary but
 * two phone numbers — so they are edited in place.
 */
export type InfotypeKind = "sliced" | "repeating";

export type InfotypeMeta = {
  code: string;
  name: string;
  kind: InfotypeKind;
  description: string;
};

export const INFOTYPES: InfotypeMeta[] = [
  {
    code: "0002",
    name: "Personal data",
    kind: "sliced",
    description: "Name, date of birth, gender and marital status.",
  },
  {
    code: "0001",
    name: "Org assignment",
    kind: "sliced",
    description: "Company, area, department, position and cost centre.",
  },
  {
    code: "0006",
    name: "Addresses",
    kind: "repeating",
    description: "Permanent and temporary addresses.",
  },
  {
    code: "0007",
    name: "Working time",
    kind: "sliced",
    description: "Work schedule, weekly hours and employment percentage.",
  },
  {
    code: "0008",
    name: "Basic pay",
    kind: "sliced",
    description: "Pay scale and salary. Payroll reads the record valid in the period.",
  },
  {
    code: "0009",
    name: "Bank details",
    kind: "sliced",
    description: "Where the salary is paid. Payroll fails without this.",
  },
  {
    code: "0021",
    name: "Family members",
    kind: "repeating",
    description: "Dependants and nominees.",
  },
  {
    code: "0105",
    name: "Communication",
    kind: "repeating",
    description: "Email, phone and system user id.",
  },
];

export function infotypeByCode(code: string): InfotypeMeta | undefined {
  return INFOTYPES.find((i) => i.code === code);
}

export type Options = { value: string; label: string }[];

/** The form fields for one infotype, given the reference data it points at. */
export function infotypeFields(
  code: string,
  refs: {
    companies: Options;
    areas: Options;
    subAreas: Options;
    units: Options;
    positions: Options;
    schedules: Options;
  },
): FieldDef[] {
  switch (code) {
    case "0002":
      return [
        { kind: "text", name: "firstName", label: "First name", required: true },
        { kind: "text", name: "lastName", label: "Last name", required: true },
        { kind: "date", name: "dateOfBirth", label: "Date of birth" },
        {
          kind: "select",
          name: "gender",
          label: "Gender",
          options: ["Female", "Male", "Other"].map((g) => ({ value: g, label: g })),
          emptyLabel: "Prefer not to say",
        },
        {
          kind: "select",
          name: "maritalStatus",
          label: "Marital status",
          options: ["Single", "Married", "Divorced", "Widowed"].map((g) => ({
            value: g,
            label: g,
          })),
          emptyLabel: "Not recorded",
        },
        { kind: "text", name: "nationality", label: "Nationality", placeholder: "Indian" },
      ];
    case "0001":
      return [
        { kind: "select", name: "companyCode", label: "Company", required: true, options: refs.companies },
        { kind: "select", name: "areaCode", label: "Personnel area", options: refs.areas, emptyLabel: "None" },
        { kind: "select", name: "subAreaCode", label: "Sub-area", options: refs.subAreas, emptyLabel: "None" },
        { kind: "select", name: "orgUnitCode", label: "Department", required: true, options: refs.units },
        { kind: "select", name: "positionCode", label: "Position", required: true, options: refs.positions },
        { kind: "text", name: "costCenter", label: "Cost centre", placeholder: "CC-IT-01" },
      ];
    case "0006":
      return [
        {
          kind: "select",
          name: "addressType",
          label: "Address type",
          required: true,
          options: ["Permanent", "Temporary"].map((g) => ({ value: g, label: g })),
        },
        { kind: "text", name: "line", label: "Address", required: true, full: true },
        { kind: "text", name: "city", label: "City" },
        { kind: "text", name: "state", label: "State" },
        { kind: "text", name: "postalCode", label: "Postal code" },
        { kind: "text", name: "country", label: "Country" },
      ];
    case "0007":
      return [
        {
          kind: "select",
          name: "workScheduleCode",
          label: "Work schedule",
          required: true,
          options: refs.schedules,
        },
        { kind: "text", name: "weeklyHours", label: "Weekly hours", required: true },
        { kind: "text", name: "employmentPercent", label: "Employment %", required: true },
      ];
    case "0008":
      return [
        {
          kind: "select",
          name: "payScaleType",
          label: "Pay scale type",
          options: ["Monthly salaried", "Hourly"].map((g) => ({ value: g, label: g })),
          emptyLabel: "None",
        },
        {
          kind: "select",
          name: "payScaleArea",
          label: "Pay scale area",
          options: ["Bengaluru", "Mumbai", "Delhi"].map((g) => ({ value: g, label: g })),
          emptyLabel: "None",
        },
        {
          kind: "select",
          name: "payScaleGroup",
          label: "Pay scale group",
          options: ["L1", "L2", "L3", "M1", "M2"].map((g) => ({ value: g, label: g })),
          emptyLabel: "None",
        },
        { kind: "text", name: "amount", label: "Basic salary", required: true, hint: "Per month, in rupees." },
        {
          kind: "select",
          name: "currency",
          label: "Currency",
          required: true,
          options: [{ value: "INR", label: "INR" }],
        },
      ];
    case "0009":
      return [
        { kind: "text", name: "bankName", label: "Bank name", required: true },
        { kind: "text", name: "accountNumber", label: "Account number", required: true },
        { kind: "text", name: "ifsc", label: "IFSC code" },
        { kind: "text", name: "holderName", label: "Account holder" },
      ];
    case "0021":
      return [
        {
          kind: "select",
          name: "relationship",
          label: "Relationship",
          required: true,
          options: ["Spouse", "Child", "Father", "Mother", "Sibling"].map((g) => ({
            value: g,
            label: g,
          })),
        },
        { kind: "text", name: "name", label: "Name", required: true },
        { kind: "date", name: "dateOfBirth", label: "Date of birth" },
      ];
    case "0105":
      return [
        {
          kind: "select",
          name: "commType",
          label: "Type",
          required: true,
          options: [
            "Email (official)",
            "Email (personal)",
            "Mobile phone",
            "System user id",
          ].map((g) => ({ value: g, label: g })),
        },
        { kind: "text", name: "value", label: "Value", required: true, full: true },
      ];
    default:
      return [];
  }
}
