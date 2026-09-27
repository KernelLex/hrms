import "server-only";
import { rawClient } from "@/lib/db";
import { employeeChoices, type Requisition } from "@/lib/repositories/recruitment";
import { toRupees } from "@/lib/money";
import { todayInIndia } from "@/lib/dates";
import type { RequisitionValues } from "../forms";

/** Vacant positions to open a requisition against, and the one it already has. */
export async function requisitionChoices(current: string | null) {
  const positions = (
    await rawClient().execute({
      sql: `SELECT p.code, p.title, ou.name AS department, a.location
            FROM om_position p JOIN om_org_unit ou ON ou.code = p.org_unit_code
            LEFT JOIN om_personnel_area a ON a.code = ou.area_code
            WHERE (p.is_vacant = 1 AND p.is_active = 1) OR p.code = ?
            ORDER BY p.code`,
      args: [current ?? ""],
    })
  ).rows.map((p) => ({ code: String(p.code), title: String(p.title), department: String(p.department), location: p.location === null ? null : String(p.location) }));
  return { positions, employees: await employeeChoices() };
}

const text = (v: string | null) => v ?? "";
const whole = (v: number | null) => (v === null ? "" : String(v));
const rupees = (v: number | null) => (v === null ? "" : String(toRupees(v)));

export function valuesOf(r: Requisition | null): RequisitionValues {
  if (!r) {
    return {
      code: "",
      positionCode: "",
      title: "",
      description: "",
      qualifications: "",
      skills: "",
      experienceMinYears: "",
      experienceMaxYears: "",
      employmentType: "Full-time",
      workMode: "On site",
      location: "",
      budgetMin: "",
      budgetMax: "",
      hiringManagerEmployeeId: "",
      openings: "1",
      priority: "Medium",
      postedDate: todayInIndia(),
      targetCloseDate: "",
      status: "Open",
      isPublished: false,
    };
  }
  return {
    code: r.code,
    positionCode: r.positionCode,
    title: r.title,
    description: text(r.description),
    qualifications: text(r.qualifications),
    skills: text(r.skills),
    experienceMinYears: whole(r.experienceMinYears),
    experienceMaxYears: whole(r.experienceMaxYears),
    employmentType: r.employmentType,
    workMode: r.workMode,
    location: text(r.location),
    budgetMin: rupees(r.budgetMinPaise),
    budgetMax: rupees(r.budgetMaxPaise),
    hiringManagerEmployeeId: whole(r.hiringManagerEmployeeId),
    openings: String(r.openings),
    priority: r.priority,
    postedDate: r.postedDate,
    targetCloseDate: text(r.targetCloseDate),
    status: r.status,
    isPublished: r.isPublished,
  };
}
