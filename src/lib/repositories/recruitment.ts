import "server-only";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";
import type { PipelineStage } from "@/db/schema";

/**
 * What the recruitment screens and the careers page read: requisitions with
 * their applications by stage, one application with its rounds and history,
 * interviews for recruiters and for the person taking them.
 */

type Row = Record<string, unknown>;

async function rows<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  return (await rawClient().execute({ sql, args })).rows as unknown as T[];
}

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ---------------------------------------------------------- requisitions */

export type Requisition = {
  id: number;
  code: string;
  title: string;
  positionCode: string;
  positionTitle: string;
  orgUnitCode: string;
  department: string;
  company: string | null;
  description: string | null;
  qualifications: string | null;
  skills: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  employmentType: string;
  workMode: string;
  location: string | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  hiringManagerEmployeeId: number | null;
  hiringManager: string | null;
  openings: number;
  priority: string;
  postedDate: string;
  targetCloseDate: string | null;
  status: string;
  isPublished: boolean;
  /** Live applications by stage, and rejected ones. */
  counts: Record<PipelineStage | "Rejected", number>;
};

const NAME_OF = (employeeColumn: string) => `(
  SELECT TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) FROM pa_it0002_personal_data p
  WHERE p.employee_id = ${employeeColumn} AND p.valid_from <= ?1 AND p.valid_to >= ?1 ORDER BY p.valid_from DESC LIMIT 1)`;

const REQUISITION_SELECT = `
  SELECT r.*, pos.title AS position_title, ou.name AS department, co.name AS company_name,
         ${NAME_OF("r.hiring_manager_employee_id")} AS hiring_manager,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.rejected_at IS NULL AND a.stage = 'Applied') AS n_applied,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.rejected_at IS NULL AND a.stage = 'Interviewing') AS n_interviewing,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.rejected_at IS NULL AND a.stage = 'Selected') AS n_selected,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.rejected_at IS NULL AND a.stage = 'Offered') AS n_offered,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.stage = 'Hired') AS n_hired,
         (SELECT COUNT(*) FROM rc_application a WHERE a.requisition_id = r.id AND a.rejected_at IS NOT NULL) AS n_rejected
  FROM rc_requisition r
  JOIN om_position pos ON pos.code = r.position_code
  JOIN om_org_unit ou ON ou.code = r.org_unit_code
  LEFT JOIN om_company co ON co.code = ou.company_code`;

function requisitionOf(r: Row): Requisition {
  return {
    id: Number(r.id),
    code: String(r.code),
    title: String(r.title) || String(r.position_title),
    positionCode: String(r.position_code),
    positionTitle: String(r.position_title),
    orgUnitCode: String(r.org_unit_code),
    department: String(r.department),
    company: s(r.company_name),
    description: s(r.description),
    qualifications: s(r.qualifications),
    skills: s(r.skills),
    experienceMinYears: n(r.experience_min_years),
    experienceMaxYears: n(r.experience_max_years),
    employmentType: String(r.employment_type),
    workMode: String(r.work_mode),
    location: s(r.location),
    budgetMinPaise: n(r.budget_min_paise),
    budgetMaxPaise: n(r.budget_max_paise),
    hiringManagerEmployeeId: n(r.hiring_manager_employee_id),
    hiringManager: s(r.hiring_manager) || null,
    openings: Number(r.openings),
    priority: String(r.priority),
    postedDate: String(r.posted_date),
    targetCloseDate: s(r.target_close_date),
    status: String(r.status),
    isPublished: Number(r.is_published) === 1,
    counts: {
      Applied: Number(r.n_applied),
      Interviewing: Number(r.n_interviewing),
      Selected: Number(r.n_selected),
      Offered: Number(r.n_offered),
      Hired: Number(r.n_hired),
      Rejected: Number(r.n_rejected),
    },
  };
}

export async function listRequisitions(): Promise<Requisition[]> {
  return (await rows(`${REQUISITION_SELECT} ORDER BY r.status = 'Closed', r.posted_date DESC, r.id DESC`, [today()])).map(requisitionOf);
}

export async function getRequisition(code: string): Promise<Requisition | null> {
  const [r] = await rows(`${REQUISITION_SELECT} WHERE r.code = ?2`, [today(), code]);
  return r ? requisitionOf(r) : null;
}

/** Roles on the careers page: open and published. */
export async function publishedRoles(): Promise<Requisition[]> {
  return (await rows(`${REQUISITION_SELECT} WHERE r.status = 'Open' AND r.is_published = 1 ORDER BY r.posted_date DESC, r.id DESC`, [today()])).map(
    requisitionOf,
  );
}

export async function publishedRole(code: string): Promise<Requisition | null> {
  const r = await getRequisition(code);
  return r && r.status === "Open" && r.isPublished ? r : null;
}

/* ---------------------------------------------------------- applications */

export type ApplicationRow = {
  id: number;
  stage: PipelineStage;
  rejected: boolean;
  appliedDate: string;
  channel: string;
  candidateId: number;
  candidateName: string;
  candidateCode: string;
  requisitionCode: string;
  roleTitle: string;
  rounds: number;
  roundsDone: number;
  nextRound: { date: string; time: string | null; interviewer: string } | null;
  offeredSalaryPaise: number | null;
};

export type ApplicationFilter = { stage?: PipelineStage | "Rejected" | null; requisition?: string | null };

export async function listApplications(filter: ApplicationFilter = {}): Promise<ApplicationRow[]> {
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter.stage === "Rejected") where.push("a.rejected_at IS NOT NULL");
  else if (filter.stage) {
    where.push("a.stage = ?", "a.rejected_at IS NULL");
    args.push(filter.stage);
  }
  if (filter.requisition) {
    where.push("r.code = ?");
    args.push(filter.requisition);
  }
  const found = await rows(
    `SELECT a.*, c.full_name, c.code AS candidate_code, r.code AS requisition_code,
            COALESCE(NULLIF(r.title, ''), pos.title) AS role_title,
            (SELECT COUNT(*) FROM rc_interview i WHERE i.application_id = a.id AND i.status IN ('Scheduled', 'Completed')) AS rounds,
            (SELECT COUNT(*) FROM rc_interview i WHERE i.application_id = a.id AND i.status = 'Completed') AS rounds_done,
            (SELECT i.scheduled_date || '|' || COALESCE(i.scheduled_time, '') || '|' || i.interviewer FROM rc_interview i
              WHERE i.application_id = a.id AND i.status = 'Scheduled' ORDER BY i.scheduled_date, i.scheduled_time LIMIT 1) AS next_round
     FROM rc_application a
     JOIN rc_candidate c ON c.id = a.candidate_id
     JOIN rc_requisition r ON r.id = a.requisition_id
     JOIN om_position pos ON pos.code = r.position_code
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY a.applied_date DESC, a.id DESC`,
    args,
  );
  return found.map((a) => {
    const next = s(a.next_round)?.split("|");
    return {
      id: Number(a.id),
      stage: String(a.stage) as PipelineStage,
      rejected: a.rejected_at !== null,
      appliedDate: String(a.applied_date),
      channel: String(a.channel),
      candidateId: Number(a.candidate_id),
      candidateName: String(a.full_name),
      candidateCode: String(a.candidate_code),
      requisitionCode: String(a.requisition_code),
      roleTitle: String(a.role_title),
      rounds: Number(a.rounds),
      roundsDone: Number(a.rounds_done),
      nextRound: next ? { date: next[0], time: next[1] || null, interviewer: next[2] } : null,
      offeredSalaryPaise: n(a.offered_salary_paise),
    };
  });
}

/** How many live applications sit at each stage, and how many were rejected. */
export async function stageCounts(): Promise<Record<PipelineStage | "Rejected" | "All", number>> {
  const [r] = await rows(
    `SELECT COUNT(*) AS all_count,
            SUM(rejected_at IS NULL AND stage = 'Applied') AS applied,
            SUM(rejected_at IS NULL AND stage = 'Interviewing') AS interviewing,
            SUM(rejected_at IS NULL AND stage = 'Selected') AS selected,
            SUM(rejected_at IS NULL AND stage = 'Offered') AS offered,
            SUM(stage = 'Hired') AS hired,
            SUM(rejected_at IS NOT NULL) AS rejected
     FROM rc_application`,
  );
  return {
    All: Number(r.all_count ?? 0),
    Applied: Number(r.applied ?? 0),
    Interviewing: Number(r.interviewing ?? 0),
    Selected: Number(r.selected ?? 0),
    Offered: Number(r.offered ?? 0),
    Hired: Number(r.hired ?? 0),
    Rejected: Number(r.rejected ?? 0),
  };
}

export type Interview = {
  id: number;
  applicationId: number;
  round: string;
  interviewer: string;
  interviewerEmployeeId: number | null;
  scheduledDate: string;
  scheduledTime: string | null;
  durationMinutes: number;
  mode: string;
  location: string | null;
  status: string;
  rating: number | null;
  recommendation: string | null;
  feedback: string | null;
  completedAt: string | null;
  completedBy: string | null;
};

function interviewOf(i: Row): Interview {
  return {
    id: Number(i.id),
    applicationId: Number(i.application_id),
    round: String(i.round),
    interviewer: String(i.interviewer),
    interviewerEmployeeId: n(i.interviewer_employee_id),
    scheduledDate: String(i.scheduled_date),
    scheduledTime: s(i.scheduled_time),
    durationMinutes: Number(i.duration_minutes),
    mode: String(i.mode),
    location: s(i.location),
    status: String(i.status),
    rating: n(i.rating),
    recommendation: s(i.recommendation),
    feedback: s(i.feedback),
    completedAt: s(i.completed_at),
    completedBy: s(i.completed_by),
  };
}

export type Candidate = {
  id: number;
  code: string;
  fullName: string;
  email: string;
  phone: string | null;
  source: string;
  resumeLink: string | null;
  profileLink: string | null;
  currentEmployer: string | null;
  experienceYears: number | null;
  noticePeriodDays: number | null;
};

const candidateOf = (c: Row): Candidate => ({
  id: Number(c.id),
  code: String(c.code),
  fullName: String(c.full_name),
  email: String(c.email),
  phone: s(c.phone),
  source: String(c.source),
  resumeLink: s(c.resume_link),
  profileLink: s(c.profile_link),
  currentEmployer: s(c.current_employer),
  experienceYears: n(c.experience_years),
  noticePeriodDays: n(c.notice_period_days),
});

export type ApplicationDetail = {
  id: number;
  stage: PipelineStage;
  appliedDate: string;
  channel: string;
  coverNote: string | null;
  rejected: { at: string; by: string | null; reason: string | null } | null;
  selected: { at: string; by: string | null; note: string | null } | null;
  offeredSalaryPaise: number | null;
  offeredAt: string | null;
  candidate: Candidate;
  resume: { id: number; fileName: string } | null;
  requisition: Requisition;
  interviews: Interview[];
  history: { from: string | null; to: string; by: string; at: string; note: string | null }[];
  employeeId: number | null;
  otherApplications: { id: number; roleTitle: string; stage: string; rejected: boolean }[];
  offer: { status: string; ctcPaise: number; joiningDate: string; expiryDate: string; sentAt: string; respondedAt: string | null } | null;
};

export async function getApplication(id: number): Promise<ApplicationDetail | null> {
  const [a] = await rows("SELECT * FROM rc_application WHERE id = ?", [id]);
  if (!a) return null;
  const [[c], [req], interviews, history, [resume], [hire], others, [offer]] = await Promise.all([
    rows("SELECT * FROM rc_candidate WHERE id = ?", [Number(a.candidate_id)]),
    rows(`${REQUISITION_SELECT} WHERE r.id = ?2`, [today(), Number(a.requisition_id)]),
    rows("SELECT * FROM rc_interview WHERE application_id = ? ORDER BY scheduled_date, scheduled_time, id", [id]),
    rows("SELECT * FROM rc_application_stage_history WHERE application_id = ? ORDER BY changed_at, id", [id]),
    rows(
      "SELECT id, file_name FROM app_document WHERE owner_type = 'candidate' AND owner_id = ? AND kind = 'Resume' ORDER BY id DESC LIMIT 1",
      [Number(a.candidate_id)],
    ),
    rows("SELECT employee_id FROM rc_hire_conversion WHERE application_id = ?", [id]),
    rows(
      `SELECT a.id, a.stage, a.rejected_at, COALESCE(NULLIF(r.title, ''), pos.title) AS role_title
       FROM rc_application a JOIN rc_requisition r ON r.id = a.requisition_id JOIN om_position pos ON pos.code = r.position_code
       WHERE a.candidate_id = ? AND a.id <> ? ORDER BY a.applied_date DESC`,
      [Number(a.candidate_id), id],
    ),
    rows("SELECT * FROM rc_offer WHERE application_id = ? ORDER BY id DESC LIMIT 1", [id]),
  ]);
  return {
    id,
    stage: String(a.stage) as PipelineStage,
    appliedDate: String(a.applied_date),
    channel: String(a.channel),
    coverNote: s(a.cover_note),
    rejected: a.rejected_at ? { at: String(a.rejected_at), by: s(a.rejected_by), reason: s(a.rejected_reason) } : null,
    selected: a.selected_at ? { at: String(a.selected_at), by: s(a.selected_by), note: s(a.selection_note) } : null,
    offeredSalaryPaise: n(a.offered_salary_paise),
    offeredAt: s(a.offered_at),
    candidate: candidateOf(c),
    resume: resume ? { id: Number(resume.id), fileName: String(resume.file_name) } : null,
    requisition: requisitionOf(req),
    interviews: interviews.map(interviewOf),
    history: history.map((h) => ({ from: s(h.from_stage), to: String(h.to_stage), by: String(h.changed_by), at: String(h.changed_at), note: s(h.note) })),
    employeeId: hire ? Number(hire.employee_id) : null,
    otherApplications: others.map((o) => ({ id: Number(o.id), roleTitle: String(o.role_title), stage: String(o.stage), rejected: o.rejected_at !== null })),
    offer: offer
      ? { status: String(offer.status), ctcPaise: Number(offer.ctc_paise), joiningDate: String(offer.joining_date), expiryDate: String(offer.expiry_date), sentAt: String(offer.sent_at), respondedAt: s(offer.responded_at) }
      : null,
  };
}

/* ------------------------------------------------------------ interviews */

export type InterviewRow = Interview & {
  candidateName: string;
  roleTitle: string;
  requisitionCode: string;
  applicationStage: string;
  applicationRejected: boolean;
};

const INTERVIEW_SELECT = `
  SELECT i.*, c.full_name, r.code AS requisition_code, COALESCE(NULLIF(r.title, ''), pos.title) AS role_title,
         a.stage AS application_stage, a.rejected_at
  FROM rc_interview i
  JOIN rc_application a ON a.id = i.application_id
  JOIN rc_candidate c ON c.id = a.candidate_id
  JOIN rc_requisition r ON r.id = a.requisition_id
  JOIN om_position pos ON pos.code = r.position_code`;

const interviewRowOf = (i: Row): InterviewRow => ({
  ...interviewOf(i),
  candidateName: String(i.full_name),
  roleTitle: String(i.role_title),
  requisitionCode: String(i.requisition_code),
  applicationStage: String(i.application_stage),
  applicationRejected: i.rejected_at !== null,
});

/** Upcoming rounds soonest first, or past ones latest first. */
export async function listInterviews(when: "upcoming" | "past", employeeId?: number): Promise<InterviewRow[]> {
  const mine = employeeId ? "AND i.interviewer_employee_id = ?" : "";
  const args: InValue[] = employeeId ? [employeeId] : [];
  const sql =
    when === "upcoming"
      ? `${INTERVIEW_SELECT} WHERE i.status = 'Scheduled' ${mine} ORDER BY i.scheduled_date, i.scheduled_time, i.id`
      : `${INTERVIEW_SELECT} WHERE i.status <> 'Scheduled' ${mine} ORDER BY i.scheduled_date DESC, i.scheduled_time DESC, i.id DESC LIMIT 200`;
  return (await rows(sql, args)).map(interviewRowOf);
}

export type ScorecardCriterion = { criterion: string; weight: number; rating: number | null };

export type InterviewDetail = InterviewRow & {
  candidate: Candidate;
  resume: { id: number; fileName: string } | null;
  requisition: Requisition;
  coverNote: string | null;
  scorecard: ScorecardCriterion[];
};

export async function getInterview(id: number): Promise<InterviewDetail | null> {
  const [i] = await rows(`${INTERVIEW_SELECT} WHERE i.id = ?`, [id]);
  if (!i) return null;
  const [a] = await rows("SELECT candidate_id, requisition_id, cover_note FROM rc_application WHERE id = ?", [Number(i.application_id)]);
  const [[c], [req], [resume], scorecard] = await Promise.all([
    rows("SELECT * FROM rc_candidate WHERE id = ?", [Number(a.candidate_id)]),
    rows(`${REQUISITION_SELECT} WHERE r.id = ?2`, [today(), Number(a.requisition_id)]),
    rows(
      "SELECT id, file_name FROM app_document WHERE owner_type = 'candidate' AND owner_id = ? AND kind = 'Resume' ORDER BY id DESC LIMIT 1",
      [Number(a.candidate_id)],
    ),
    rows(
      `SELECT t.criterion, t.weight, sc.rating FROM rc_scorecard_template t
       LEFT JOIN rc_scorecard sc ON sc.interview_id = ? AND sc.criterion = t.criterion
       WHERE t.job_code = (SELECT job_code FROM rc_requisition WHERE id = ?) AND t.is_active = 1
       ORDER BY t.sort_order, t.criterion`,
      [id, Number(a.requisition_id)],
    ),
  ]);
  return {
    ...interviewRowOf(i),
    candidate: candidateOf(c),
    resume: resume ? { id: Number(resume.id), fileName: String(resume.file_name) } : null,
    requisition: requisitionOf(req),
    coverNote: s(a.cover_note),
    scorecard: scorecard.map((r) => ({ criterion: String(r.criterion), weight: Number(r.weight), rating: r.rating === null ? null : Number(r.rating) })),
  };
}

/* ---------------------------------------------------------------- people */

/** Current employees, for choosing an interviewer or a hiring manager. */
export async function employeeChoices(): Promise<{ id: number; label: string }[]> {
  const found = await rows(
    `SELECT e.id, e.employee_number, ${NAME_OF("e.id")} AS name
     FROM pa_employee e WHERE e.employment_status <> 'Terminated' ORDER BY name, e.employee_number`,
    [today()],
  );
  return found.map((e) => ({ id: Number(e.id), label: `${s(e.name) || String(e.employee_number)} (${String(e.employee_number)})` }));
}

/* ------------------------------------------------------------------ offers */

export type OfferByToken = {
  id: number;
  candidateName: string;
  roleTitle: string;
  ctcPaise: number;
  letterText: string;
  joiningDate: string;
  expiryDate: string;
  status: string;
};

export type Referral = {
  id: number;
  candidateName: string;
  roleTitle: string | null;
  status: string;
  bonusPaise: number;
  createdAt: string;
  paidAt: string | null;
};

/** One employee's own referrals, newest first. */
export async function referralsByEmployee(employeeId: number): Promise<Referral[]> {
  const found = await rows(
    `SELECT f.id, f.status, f.bonus_paise, f.created_at, f.paid_at, c.full_name,
            (SELECT COALESCE(NULLIF(r.title, ''), pos.title) FROM rc_application a
             JOIN rc_requisition r ON r.id = a.requisition_id JOIN om_position pos ON pos.code = r.position_code
             WHERE a.candidate_id = f.candidate_id ORDER BY a.applied_date DESC LIMIT 1) AS role_title
     FROM rc_referral f JOIN rc_candidate c ON c.id = f.candidate_id
     WHERE f.referrer_employee_id = ? ORDER BY f.id DESC`,
    [employeeId],
  );
  return found.map((f) => ({
    id: Number(f.id),
    candidateName: String(f.full_name),
    roleTitle: s(f.role_title),
    status: String(f.status),
    bonusPaise: Number(f.bonus_paise),
    createdAt: String(f.created_at),
    paidAt: s(f.paid_at),
  }));
}

/** The one thing the candidate's own link can read: their offer, nothing else. */
export async function getOfferByToken(token: string): Promise<OfferByToken | null> {
  const [o] = await rows(
    `SELECT o.*, c.full_name, COALESCE(NULLIF(r.title, ''), pos.title) AS role_title
     FROM rc_offer o
     JOIN rc_application a ON a.id = o.application_id
     JOIN rc_candidate c ON c.id = a.candidate_id
     JOIN rc_requisition r ON r.id = a.requisition_id
     JOIN om_position pos ON pos.code = r.position_code
     WHERE o.token = ?`,
    [token],
  );
  if (!o) return null;
  return {
    id: Number(o.id),
    candidateName: String(o.full_name),
    roleTitle: String(o.role_title),
    ctcPaise: Number(o.ctc_paise),
    letterText: String(o.letter_text),
    joiningDate: String(o.joining_date),
    expiryDate: String(o.expiry_date),
    status: String(o.status),
  };
}

/* --------------------------------------------------------------- analytics */

export type Bar = { label: string; value: number };

export type RecruitmentAnalytics = {
  /** Average days from applying to being hired. */
  timeToHireDays: number | null;
  /** Average days spent in each stage, before moving to the next or being decided. */
  timeInStage: Bar[];
  /** Applications and hires by source. */
  sourceEffectiveness: { source: string; applications: number; hires: number }[];
  /** Offers by how the candidate (or time) responded. */
  offersByStatus: Bar[];
  /** Rejections by the stage reached. */
  dropOffByStage: Bar[];
};

/**
 * Time to hire, time in stage, source effectiveness, offer acceptance and
 * drop-off — each a plain count or average over every application on
 * record, for the bar lists on the analytics screen.
 */
export async function recruitmentAnalytics(): Promise<RecruitmentAnalytics> {
  const [[hire], stages, sources, offers, dropOff] = await Promise.all([
    rows(
      `SELECT AVG(julianday(h.changed_at) - julianday(a.applied_date)) AS avg_days
       FROM rc_application a JOIN rc_application_stage_history h ON h.application_id = a.id AND h.to_stage = 'Hired'
       WHERE a.stage = 'Hired'`,
    ),
    rows(
      `SELECT h.to_stage AS stage, AVG(julianday(nxt.changed_at) - julianday(h.changed_at)) AS avg_days
       FROM rc_application_stage_history h
       JOIN rc_application_stage_history nxt
         ON nxt.application_id = h.application_id
        AND nxt.id = (SELECT MIN(id) FROM rc_application_stage_history WHERE application_id = h.application_id AND id > h.id)
       WHERE h.to_stage <> 'Rejected'
       GROUP BY h.to_stage`,
    ),
    rows(
      `SELECT c.source, COUNT(*) AS applications, SUM(a.stage = 'Hired') AS hires
       FROM rc_application a JOIN rc_candidate c ON c.id = a.candidate_id
       GROUP BY c.source ORDER BY applications DESC`,
    ),
    rows("SELECT status, COUNT(*) AS n FROM rc_offer GROUP BY status"),
    rows("SELECT stage, COUNT(*) AS n FROM rc_application WHERE rejected_at IS NOT NULL GROUP BY stage"),
  ]);
  return {
    timeToHireDays: hire && hire.avg_days !== null ? Math.round(Number(hire.avg_days) * 10) / 10 : null,
    timeInStage: stages.map((r) => ({ label: String(r.stage), value: Math.round(Number(r.avg_days) * 10) / 10 })),
    sourceEffectiveness: sources.map((r) => ({ source: String(r.source), applications: Number(r.applications), hires: Number(r.hires ?? 0) })),
    offersByStatus: offers.map((r) => ({ label: String(r.status), value: Number(r.n) })),
    dropOffByStage: dropOff.map((r) => ({ label: String(r.stage), value: Number(r.n) })),
  };
}
