import type { Permission } from "@/lib/permissions";

/**
 * The processes that go through approval, and what a flow for each may say.
 * Leave and corrections so far; headcount requests, claims and exits join in
 * later phases by adding an entry here and a completion handler.
 *
 * Plain module: the flows screen, the inbox and the engine all read it.
 */

export type ProcessDef = {
  label: string;
  /** Can decide any request in this process, whoever it is waiting for. */
  overridePermission: Permission;
  /** Facts a step's condition can test, and how the flows screen names them. */
  facts: Record<string, string>;
  /**
   * The facts are yes-or-no (1 or 0): a step's condition reads "only for
   * bank account changes" rather than "more than this many".
   */
  flagFacts?: boolean;
  /** Every step must be decided by someone who did not decide an earlier one. */
  distinctApprovers?: boolean;
  link: string;
};

export const PROCESSES: {
  leave: ProcessDef;
  correction: ProcessDef;
  headcount: ProcessDef;
  regularisation: ProcessDef;
  loan: ProcessDef;
  claim: ProcessDef;
  exit: ProcessDef;
} = {
  leave: {
    label: "Leave",
    overridePermission: "leave.decide_any",
    facts: { days: "working days" },
    link: "/approvals?process=leave",
  },
  correction: {
    label: "Corrections",
    overridePermission: "employee.edit",
    facts: { bank: "bank account changes" },
    flagFacts: true,
    // A changed bank account is how payroll fraud starts: two people, always.
    distinctApprovers: true,
    link: "/approvals?process=correction",
  },
  headcount: {
    label: "Headcount requests",
    overridePermission: "org.edit",
    facts: {},
    link: "/approvals?process=headcount",
  },
  regularisation: {
    label: "Attendance regularisations",
    overridePermission: "time.manage",
    facts: {},
    link: "/approvals?process=regularisation",
  },
  loan: {
    label: "Loans",
    overridePermission: "payroll.setup",
    facts: {},
    link: "/approvals?process=loan",
  },
  claim: {
    label: "Claims",
    overridePermission: "payroll.setup",
    facts: {},
    link: "/approvals?process=claim",
  },
  exit: {
    label: "Exits",
    overridePermission: "employee.edit",
    facts: {},
    link: "/approvals?process=exit",
  },
};

export type ProcessCode = keyof typeof PROCESSES;

export const PROCESS_CODES = Object.keys(PROCESSES) as ProcessCode[];

export function isProcess(value: unknown): value is ProcessCode {
  return typeof value === "string" && value in PROCESSES;
}

export const APPROVER_TYPES = {
  reporting_manager: "Their reporting manager",
  manager_of_manager: "Their manager's manager",
  role: "Anyone holding a role",
  person: "A named person",
} as const;

export type ApproverType = keyof typeof APPROVER_TYPES;

export type StepDef = {
  stepOrder: number;
  approverType: ApproverType;
  approverRole: string | null;
  approverUserId: number | null;
  conditionField: string | null;
  conditionMin: number | null;
  escalateAfterDays: number | null;
};

/** The steps a request with these facts goes through, in order. */
export function applicableSteps(steps: StepDef[], facts: Record<string, number>): StepDef[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .filter((s) => {
      if (!s.conditionField || s.conditionMin === null) return true;
      const value = facts[s.conditionField];
      return typeof value === "number" && value > s.conditionMin;
    });
}

/** "Their reporting manager, when more than 5 working days" — for the flows screen and tests. */
export function describeStep(
  process: ProcessCode,
  step: StepDef,
  names: { role?: string; person?: string } = {},
): string {
  const who =
    step.approverType === "role"
      ? `anyone holding ${names.role ?? step.approverRole ?? "a role"}`
      : step.approverType === "person"
        ? (names.person ?? "a named person")
        : APPROVER_TYPES[step.approverType].toLowerCase();
  const fact = step.conditionField ? (PROCESSES[process].facts[step.conditionField] ?? step.conditionField) : "";
  const when =
    step.conditionField && step.conditionMin !== null
      ? PROCESSES[process].flagFacts
        ? `, only for ${fact}`
        : `, when more than ${step.conditionMin} ${fact}`
      : "";
  const escalate = step.escalateAfterDays ? `; HR is added after ${step.escalateAfterDays} days` : "";
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}${when}${escalate}`;
}
