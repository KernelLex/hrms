/**
 * What an employee may ask to change about their own record, section by
 * section, with the names people read. A plain module: the profile's forms,
 * the approvals inbox, the service and the API all use it.
 *
 * Work details — job, department, pay, working time, the official email —
 * are HR's to change and are not here.
 */

export const GENDERS = ["Female", "Male", "Other"] as const;
export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"] as const;
export const ADDRESS_TYPES = ["Permanent", "Temporary"] as const;
export const CONTACT_TYPES = ["Mobile phone", "Email (personal)"] as const;

export const SECTIONS = {
  personal: {
    label: "Personal details",
    noun: "personal details",
    fields: {
      first_name: "First name",
      last_name: "Last name",
      date_of_birth: "Date of birth",
      gender: "Gender",
      marital_status: "Marital status",
      nationality: "Nationality",
    },
  },
  address: {
    label: "Address",
    noun: "address",
    fields: { line: "Address", city: "City", state: "State", postal_code: "PIN code", country: "Country" },
  },
  contact: {
    label: "Contact",
    noun: "contact details",
    fields: { value: "Value" },
  },
  bank: {
    label: "Bank account",
    noun: "bank account",
    fields: { bank_name: "Bank", account_number: "Account number", ifsc: "IFSC", holder_name: "Account holder" },
  },
} as const;

export type Section = keyof typeof SECTIONS;
export const SECTION_CODES = Object.keys(SECTIONS) as Section[];

export const isSection = (v: unknown): v is Section => typeof v === "string" && v in SECTIONS;

/** "Mobile phone", "Permanent address", "Bank account". */
export function describeChange(section: Section, subtype: string | null): string {
  if (section === "address") return `${subtype ?? "Permanent"} address`;
  if (section === "contact") return subtype ?? "Contact";
  return SECTIONS[section].label;
}

/** "••••4321", for anyone who may not see account numbers. */
export const maskedAccount = (account: string) => `••••${account.slice(-4)}`;
