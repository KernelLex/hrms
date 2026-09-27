/**
 * Recruitment's fixed lists, in a plain module so screens in the browser can
 * use them without the database schema. The schema re-exports them.
 */

export const PIPELINE_STAGES = ["Applied", "Interviewing", "Selected", "Offered", "Hired"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** What a stage is called where people read it. */
export const STAGE_LABEL: Record<PipelineStage, string> = {
  Applied: "New",
  Interviewing: "Interviewing",
  Selected: "Approved",
  Offered: "Offered",
  Hired: "Hired",
};

export const REQUISITION_STATUS = ["Open", "On hold", "Closed"] as const;
export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;
export const WORK_MODES = ["On site", "Hybrid", "Remote"] as const;

export const INTERVIEW_STATUS = ["Scheduled", "Completed", "Cancelled", "No-show"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUS)[number];
export const RECOMMENDATIONS = ["Advance", "Hold", "Reject"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** "3 to 6 years", "3 years or more", "Up to 2 years", or null. */
export function experienceText(min: number | null, max: number | null): string | null {
  const years = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
  if (min !== null && max !== null) return min === max ? years(min) : `${min} to ${years(max)}`;
  if (min !== null) return min === 0 ? "Open to freshers" : `${years(min)} or more`;
  if (max !== null) return `Up to ${years(max)}`;
  return null;
}

export const INTERVIEW_LABEL: Record<string, string> = { Scheduled: "Scheduled", Completed: "Done", Cancelled: "Cancelled", "No-show": "Did not come" };
export const INTERVIEW_TONE: Record<string, "waiting" | "done" | "neutral" | "problem"> = {
  Scheduled: "waiting",
  Completed: "done",
  Cancelled: "neutral",
  "No-show": "problem",
};
export const RECOMMENDATION_LABEL: Record<string, string> = { Advance: "Move forward", Hold: "Not sure", Reject: "Do not move forward" };
