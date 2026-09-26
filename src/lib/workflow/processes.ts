import type { Permission } from "@/lib/permissions";

/**
 * The processes that go through approval, and what a flow for each may say.
 * Leave is the first; corrections, headcount requests, claims and exits join
 * in later phases by adding an entry here and a completion handler.
 *
 * Plain module: the flows screen, the inbox and the engine all read it.
 */

export const PROCESSES = {
  leave: {
    label: "Leave",
    /** Can decide any request in this process, whoever it is waiting for. */
    overridePermission: "leave.decide_any" as Permission,
    /** Facts a step's condition can test, and how the flows screen names them. */
    facts: { days: "working days" } as Record<string, string>,
    link: "/approvals?process=leave",
  },
} as const;

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
  const when =
    step.conditionField && step.conditionMin !== null
      ? `, when more than ${step.conditionMin} ${PROCESSES[process].facts[step.conditionField] ?? step.conditionField}`
      : "";
  const escalate = step.escalateAfterDays ? `; HR is added after ${step.escalateAfterDays} days` : "";
  return `${who.charAt(0).toUpperCase()}${who.slice(1)}${when}${escalate}`;
}
