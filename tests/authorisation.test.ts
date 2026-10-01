import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_DENIED, accessFor } from "@/lib/access";
import type { Permission } from "@/lib/permissions";
import * as accessActions from "@/app/actions/access";
import * as approvals from "@/app/actions/approvals";
import * as attendance from "@/app/actions/attendance";
import * as auth from "@/app/actions/auth";
import * as careers from "@/app/actions/careers";
import * as coreHr from "@/app/actions/core-hr";
import * as corrections from "@/app/actions/corrections";
import * as documents from "@/app/actions/documents";
import * as headcount from "@/app/actions/headcount";
import * as imports from "@/app/actions/imports";
import * as integrations from "@/app/actions/integrations";
import * as lifecycle from "@/app/actions/lifecycle";
import * as loansClaims from "@/app/actions/loans-claims";
import * as notifications from "@/app/actions/notifications";
import * as org from "@/app/actions/org";
import * as payroll from "@/app/actions/payroll";
import * as performance from "@/app/actions/performance";
import * as recruitment from "@/app/actions/recruitment";
import * as search from "@/app/actions/search";
import * as statutory from "@/app/actions/statutory";
import * as tax from "@/app/actions/tax";
import * as time from "@/app/actions/time";
import { GET as documentRoute } from "@/app/api/documents/[id]/route";
import { GET as exportEmployees } from "@/app/api/export/employees/route";
import { GET as exportPayrollRun } from "@/app/api/export/payroll-run/[id]/route";
import { GET as exportRegister } from "@/app/api/export/register/route";
import { GET as bankFile } from "@/app/api/payroll/bank-file/[id]/route";
import { GET as ecrFile } from "@/app/api/payroll/ecr/[id]/route";
import { GET as glJournal } from "@/app/api/payroll/gl-journal/[id]/route";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * The authorisation matrix: every Server Function and every signed-in route,
 * called as every kind of person, and whether it let them in.
 *
 * A Server Function can be called by a direct POST whatever the screens show,
 * so this is the check that matters. Each row says which permissions open
 * it — any one of them — or that anyone signed in may call it because it
 * works only on their own things, or decides by the data (an approval goes to
 * whoever it is waiting for). A new Server Function without a row fails the
 * first test here.
 */

type Rule = Permission[] | "signed-in" | "public";

const MODULES = {
  access: accessActions,
  approvals,
  attendance,
  auth,
  careers,
  "core-hr": coreHr,
  corrections,
  documents,
  headcount,
  imports,
  integrations,
  lifecycle,
  "loans-claims": loansClaims,
  notifications,
  org,
  payroll,
  performance,
  recruitment,
  search,
  statutory,
  tax,
  time,
} as const;

const org_ = (fns: string[]): Record<string, Rule> => Object.fromEntries(fns.map((f) => [f, ["org.edit"]]));

const MATRIX: Record<string, Record<string, Rule>> = {
  access: {
    saveRole: ["access.manage"],
    deleteRole: ["access.manage"],
    addRoleMember: ["access.manage"],
    removeRoleMember: ["access.manage"],
    saveFlow: ["access.manage"],
  },
  approvals: { decideApproval: "signed-in", saveDelegation: "signed-in", endDelegation: "signed-in" },
  attendance: {
    saveShift: ["time.manage"],
    deleteShift: ["time.manage"],
    saveRosterPattern: ["time.manage"],
    deleteRosterPattern: ["time.manage"],
    savePatternDays: ["time.manage"],
    assignRosterAction: ["time.manage"],
    setRosterDayAction: ["time.manage"],
    saveDevice: ["time.manage"],
    deleteDevice: ["time.manage"],
    uploadPunchesAction: ["time.manage"],
    runDailyAttendanceAction: ["time.manage"],
    submitRegularisation: ["self.attendance", "time.manage"],
    cancelRegularisation: "signed-in",
  },
  auth: { signInAction: "public", demoSignInAction: "public", signOutAction: "public" },
  // The careers page: anyone, signed in or not, may apply.
  careers: { applyForJob: "public" },
  "core-hr": {
    hireEmployee: ["employee.edit"], // and pay.view: see below
    saveInfotypeSlice: ["employee.edit"],
    deleteInfotypeSlice: ["employee.edit"],
    saveRepeatingInfotype: ["employee.edit"],
    deleteRepeatingInfotype: ["employee.edit"],
    massUpdate: ["employee.edit"],
    setEmploymentStatus: ["employee.edit"],
  },
  // Only about the person themselves; HR decides in the approvals inbox.
  corrections: { requestChange: ["self.profile"], cancelChange: ["self.profile"] },
  documents: { uploadEmployeeDocument: ["employee.documents"], removeEmployeeDocument: ["employee.documents"] },
  headcount: { requestHeadcount: ["employee.view_team", "org.edit"] },
  "loans-claims": {
    submitLoan: ["self.loans"],
    withdrawLoan: ["self.loans"],
    prepayLoanAction: ["payroll.setup"],
    closeLoanAction: ["payroll.setup"],
    submitClaim: ["self.claims"],
    withdrawClaim: ["self.claims"],
    saveClaimCategory: ["payroll.setup"],
    deleteClaimCategory: ["payroll.setup"],
    saveClaimCategoryLimit: ["payroll.setup"],
    deleteClaimCategoryLimit: ["payroll.setup"],
    saveLoanBenchmarkRate: ["payroll.setup"],
    deleteLoanBenchmarkRate: ["payroll.setup"],
  },
  imports: {
    uploadImport: ["employee.edit"], // and org.edit: like hireEmployee
    confirmImportAction: ["employee.edit"], // and org.edit: like hireEmployee
    watchImport: ["org.view"],
  },
  integrations: {
    createIntegrationClient: ["integrations.manage"],
    updateIntegrationClient: ["integrations.manage"],
    deleteIntegrationClient: ["integrations.manage"],
    rotateIntegrationSecret: ["integrations.manage"],
    revokeIntegrationSecrets: ["integrations.manage"],
    setWebhookActive: ["integrations.manage"],
    replayWebhookDeliveries: ["integrations.manage"],
    setRecordOwner: ["integrations.manage"],
    retryIssue: ["integrations.manage"],
    discardIssue: ["integrations.manage"],
    resendJournal: ["payroll.post", "integrations.manage"],
  },
  lifecycle: {
    completeTask: "signed-in",
    confirmProbationAction: ["employee.edit"],
    extendProbationAction: ["employee.edit"],
    endProbationAction: ["employee.edit"],
    transferEmployeeAction: ["employee.edit"],
    promoteEmployeeAction: ["employee.edit"], // and pay.view: like hireEmployee
    saveLetterTemplate: ["employee.edit"],
    issueLetterAction: ["employee.edit"],
  },
  notifications: { openNotification: "signed-in", markAllRead: "signed-in", saveNotificationPrefs: "signed-in" },
  org: org_([
    "saveCompany", "deleteCompany", "saveArea", "deleteArea", "saveSubArea", "deleteSubArea", "saveJob",
    "deleteJob", "saveOrgUnit", "deleteOrgUnit", "savePosition", "deletePosition", "saveReportingLine",
    "deleteReportingLine",
  ]),
  payroll: {
    setPeriodStatus: ["payroll.post"],
    setPeriodEmail: ["payroll.post"],
    resendPayslip: ["payroll.post"],
    createPeriod: ["payroll.post"],
    saveWageType: ["payroll.setup"],
    deleteWageType: ["payroll.setup"],
    saveRecurringPayment: ["payroll.setup"],
    deleteRecurringPayment: ["payroll.setup"],
    saveAdditionalPayment: ["payroll.setup"],
    deleteAdditionalPayment: ["payroll.setup"],
    startRunAction: ["payroll.run"],
    startOffCycleAction: ["payroll.run"],
    watchRun: ["payroll.run"],
    resumeRun: ["payroll.run"],
    generateBankFile: ["payroll.post"],
    postToLedger: ["payroll.post"],
    markRemitted: ["payroll.post"],
  },
  statutory: {
    saveSalaryStructure: ["payroll.setup"],
    deleteSalaryStructure: ["payroll.setup"],
    saveStructureComponents: ["payroll.setup"],
    saveCtc: ["payroll.setup"],
    deleteCtc: ["payroll.setup"],
    saveCostSplit: ["payroll.setup"],
    deleteCostSplit: ["payroll.setup"],
    saveGlMapping: ["payroll.setup"],
    deleteGlMapping: ["payroll.setup"],
    savePfRate: ["payroll.setup"],
    deletePfRate: ["payroll.setup"],
    saveEsiRate: ["payroll.setup"],
    deleteEsiRate: ["payroll.setup"],
    savePtSlab: ["payroll.setup"],
    deletePtSlab: ["payroll.setup"],
    saveLwfRate: ["payroll.setup"],
    deleteLwfRate: ["payroll.setup"],
    saveTaxConstant: ["payroll.setup"],
    deleteTaxConstant: ["payroll.setup"],
  },
  performance: {
    saveCycle: ["performance.manage"],
    deleteCycle: ["performance.manage"],
    openCycle: ["performance.manage"],
    saveGoal: ["performance.rate_any", "performance.rate_team"],
    deleteGoal: ["performance.rate_any", "performance.rate_team"],
    saveSelfRating: ["self.appraisal"],
    saveManagerRating: ["performance.rate_any", "performance.rate_team"],
    saveCalibration: ["performance.manage"],
    generateIncrements: ["performance.manage"],
    updateIncrement: ["performance.manage"],
    approveIncrement: ["performance.manage"],
    pushIncrementsToPayroll: ["performance.manage"],
    setIncrementSalary: ["performance.manage"],
  },
  recruitment: {
    saveRequisition: ["recruitment.manage"],
    setRequisitionPublished: ["recruitment.manage"],
    deleteRequisition: ["recruitment.manage"],
    saveCandidate: ["recruitment.manage"],
    deleteCandidate: ["recruitment.manage"],
    uploadResume: ["recruitment.manage"],
    removeResume: ["recruitment.manage"],
    createApplication: ["recruitment.manage"],
    takeToInterview: ["recruitment.manage"],
    rejectApplication: ["recruitment.manage"],
    selectCandidate: ["recruitment.manage"],
    makeOffer: ["recruitment.manage"],
    scheduleInterview: ["recruitment.manage"],
    // An interviewer records their own rounds' notes; the data decides which.
    recordInterviewFeedback: ["recruitment.manage", "recruitment.interview"],
    setInterviewStatus: ["recruitment.manage"],
    deleteInterview: ["recruitment.manage"],
    convertToEmployee: ["recruitment.hire"],
  },
  search: { searchPeople: "signed-in" },
  tax: {
    saveSection: ["tax.manage"],
    deleteSection: ["tax.manage"],
    saveDeclaration: ["self.tax", "tax.manage"],
    deleteDeclaration: ["tax.manage"],
    buildRegister: ["tax.manage"],
    saveChallan: ["tax.manage"],
    generateForm16: ["tax.manage"],
    deleteForm16: ["tax.manage"],
  },
  time: {
    submitLeaveRequest: ["self.leave", "time.manage"],
    decideLeaveRequest: "signed-in",
    cancelLeaveRequest: "signed-in",
    saveAbsence: ["time.manage"],
    deleteAbsence: ["time.manage"],
    saveAttendance: ["time.manage"],
    deleteAttendance: ["time.manage"],
    adjustQuotaAction: ["time.manage"],
    encashLeaveAction: ["time.manage"],
    runTimeEvaluation: ["time.manage"],
    saveWorkSchedule: ["time.manage"],
    deleteWorkSchedule: ["time.manage"],
    saveHoliday: ["time.manage"],
    deleteHoliday: ["time.manage"],
    saveHolidayCalendar: ["time.manage"],
    deleteHolidayCalendar: ["time.manage"],
    saveLeavePolicy: ["time.manage"],
    deleteLeavePolicy: ["time.manage"],
  },
};

/** How to call each shape of Server Function with nothing in it. */
function call(fn: (...args: never[]) => Promise<unknown>, name: string): Promise<unknown> {
  const f = fn as unknown as (...args: unknown[]) => Promise<unknown>;
  if (name === "searchPeople") return f("ab");
  if (name === "watchRun" || name === "resumeRun" || name === "watchImport") return f(0);
  if (name === "markAllRead") return f();
  if (name === "openNotification") return f(new FormData());
  return f({}, new FormData());
}

async function outcome(run: () => Promise<unknown>): Promise<"allowed" | "refused"> {
  try {
    await run();
    return "allowed";
  } catch (err) {
    // Refusal is the permission error and nothing else; a redirect or a
    // validation failure means the function let them in.
    return err instanceof Error && err.message === PERMISSION_DENIED ? "refused" : "allowed";
  }
}

const personas: Record<string, Person> = {};

beforeAll(async () => {
  personas.hr = await createPerson({ roles: ["HR_ADMIN"], email: false });
  personas.manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"], email: false });
  personas.employee = await createPerson({ roles: ["EMPLOYEE"], email: false });
  personas.recruiter = await createPerson({ roles: ["RECRUITER"], email: false });
  personas.nobody = await createPerson({ roles: [], email: false });
});

afterEach(() => actAs(null));

describe("the authorisation matrix", () => {
  it("has a row for every Server Function", () => {
    for (const [module, exports] of Object.entries(MODULES)) {
      const functions = Object.entries(exports)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k)
        .sort();
      expect(Object.keys(MATRIX[module] ?? {}).sort(), `rows for ${module}`).toEqual(functions);
    }
  });

  for (const persona of ["hr", "manager", "employee", "recruiter", "nobody"]) {
    it(`lets ${persona} in exactly where their permissions say`, async () => {
      const person = personas[persona];
      const access = await accessFor(person.session);
      const mismatches: string[] = [];
      for (const [module, rows] of Object.entries(MATRIX)) {
        for (const [name, rule] of Object.entries(rows)) {
          if (rule === "public") continue;
          const expected =
            rule === "signed-in" || rule.some((p) => access.permissions.has(p)) ? "allowed" : "refused";
          actAs(person.session);
          const fn = (MODULES[module as keyof typeof MODULES] as Record<string, unknown>)[name];
          const got = await outcome(() => call(fn as (...args: never[]) => Promise<unknown>, name));
          actAs(null);
          if (got !== expected) mismatches.push(`${module}.${name}: expected ${expected}, got ${got}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it("asks for pay as well to hire someone", async () => {
    // A role that can edit records but not see pay may not hire: hiring sets a salary.
    const { saveRole } = accessActions;
    const code = `NOPAY_${Date.now() % 100000}`;
    await saveRole({}, (() => { const f = new FormData(); f.set("code", code); f.set("name", "No pay"); return f; })()).catch(() => {});
    const f = new FormData();
    f.set("originalCode", code);
    f.set("name", "No pay");
    f.append("permission", "employee.edit");
    await saveRole({}, f);
    const person = await createPerson({ roles: [code], email: false });
    actAs(person.session);
    expect(await outcome(() => coreHr.hireEmployee({}, new FormData()))).toBe("refused");
  });
});

describe("routes", () => {
  const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
  const ROUTES: { name: string; rule: Permission[]; run: () => Promise<Response> }[] = [
    { name: "employee export", rule: ["reports.view"], run: () => exportEmployees(new Request("http://localhost/api/export/employees")) },
    { name: "payroll run export", rule: ["payroll.view"], run: () => exportPayrollRun(new Request("http://localhost/x"), params({ id: "0" }) as never) },
    { name: "tax register export", rule: ["tax.manage"], run: () => exportRegister(new Request("http://localhost/api/export/register?fy=2026-27")) },
    { name: "bank file", rule: ["payroll.post"], run: () => bankFile(new Request("http://localhost/x"), params({ id: "0" }) as never) },
    { name: "ECR file", rule: ["payroll.post"], run: () => ecrFile(new Request("http://localhost/x"), params({ id: "0" }) as never) },
    { name: "GL journal", rule: ["payroll.view"], run: () => glJournal(new Request("http://localhost/x"), params({ id: "0" }) as never) },
  ];

  for (const persona of ["hr", "manager", "employee", "recruiter", "nobody"]) {
    it(`refuses ${persona} the downloads their permissions do not cover`, async () => {
      const access = await accessFor(personas[persona].session);
      for (const route of ROUTES) {
        actAs(personas[persona].session);
        const res = await route.run();
        actAs(null);
        const allowed = route.rule.some((p) => access.permissions.has(p));
        expect(res.status === 403, `${persona} ${route.name}`).toBe(!allowed);
      }
    });
  }

  it("never shows a document to someone it does not belong to", async () => {
    actAs(personas.employee.session);
    const res = await documentRoute(new Request("http://localhost/x"), params({ id: "999999" }) as never);
    expect(res.status).toBe(404);
  });
});
