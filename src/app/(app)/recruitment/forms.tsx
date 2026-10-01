"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import {
  createApplication,
  deleteInterview,
  deleteRequisition,
  makeOffer,
  recordInterviewFeedback,
  rejectApplication,
  saveRequisition,
  scheduleInterview,
  selectCandidate,
  setInterviewStatus,
  setRequisitionPublished,
  takeToInterview,
  type ActionState,
} from "@/app/actions/recruitment";
import { EMPLOYMENT_TYPES, RECOMMENDATION_LABEL, RECOMMENDATIONS, WORK_MODES } from "@/lib/recruitment-values";
import { Button, ButtonLink, Card, CardHeader } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Checkbox, DateInput, Field, FormError, FormFull, FormGrid, Input, Select, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

type Choice = { id: number; label: string };

/** An action that toasts and refreshes on success, and keeps its error. */
function useAction(action: (prev: ActionState, form: FormData) => Promise<ActionState>, done?: string, after?: (r: ActionState) => void) {
  const toast = useToast();
  const router = useRouter();
  return useActionState(async (prev: ActionState, form: FormData) => {
    const r = await action(prev, form);
    if (r.ok) {
      if (done) toast(done);
      after?.(r);
      router.refresh();
    }
    return r;
  }, {} as ActionState);
}

const Spinner = ({ on }: { on: boolean }) => (on ? <Loader2 className="animate-spin" /> : null);

/* ---------------------------------------------------------- requisitions */

export type RequisitionValues = {
  code: string;
  positionCode: string;
  title: string;
  description: string;
  qualifications: string;
  skills: string;
  experienceMinYears: string;
  experienceMaxYears: string;
  employmentType: string;
  workMode: string;
  location: string;
  budgetMin: string;
  budgetMax: string;
  hiringManagerEmployeeId: string;
  openings: string;
  priority: string;
  postedDate: string;
  targetCloseDate: string;
  status: string;
  isPublished: boolean;
};

type PositionChoice = { code: string; title: string; department: string; location: string | null };

/**
 * Opening or changing a requisition: the position, the role as candidates
 * will read it, and how hiring for it runs.
 */
export function RequisitionForm({
  values,
  positions,
  employees,
}: {
  values: RequisitionValues;
  positions: PositionChoice[];
  employees: Choice[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(values.code);
  const [title, setTitle] = React.useState(values.title);
  const [location, setLocation] = React.useState(values.location);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await saveRequisition(prev, form);
    if (r.ok && r.code) {
      toast(editing ? "Requisition saved" : `${r.code} opened`);
      router.push(`/recruitment/requisitions/${r.code}`);
    }
    return r;
  }, {} as ActionState);

  // Choosing a position suggests its title and place, until they are typed.
  const choosePosition = (code: string) => {
    const p = positions.find((x) => x.code === code);
    if (!p) return;
    if (!title) setTitle(p.title);
    if (!location && p.location) setLocation(p.location);
  };

  return (
    <form action={action} className="flex flex-col gap-6">
      {editing ? <input type="hidden" name="originalCode" value={values.code} /> : null}

      <Card>
        <CardHeader title="The role" description="The position it fills, and how candidates will see it on the careers page." />
        <div className="px-6 pb-6">
          <FormGrid>
            <Field label="Position" htmlFor="positionCode" required hint="The department and job follow from the position.">
              <Select
                id="positionCode"
                name="positionCode"
                required
                defaultValue={values.positionCode}
                onChange={(e) => choosePosition(e.target.value)}
              >
                <option value="">{positions.length ? "Choose a vacant position" : "No vacant positions"}</option>
                {positions.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} — {p.title}, {p.department}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Job title" htmlFor="title" required hint="As candidates will search for it.">
              <Input id="title" name="title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Java developer" />
            </Field>
            <Field label="Employment type" htmlFor="employmentType" required>
              <Select id="employmentType" name="employmentType" defaultValue={values.employmentType}>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Where they work" htmlFor="workMode" required>
              <Select id="workMode" name="workMode" defaultValue={values.workMode}>
                {WORK_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <FormFull>
              <Field label="Location" htmlFor="location">
                <Input id="location" name="location" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bengaluru" />
              </Field>
            </FormFull>
          </FormGrid>
        </div>
      </Card>

      <Card>
        <CardHeader title="What candidates read" description="Shown on the careers page when the requisition is published." />
        <div className="px-6 pb-6">
          <FormGrid>
            <FormFull>
              <Field label="About the role" htmlFor="description" hint="What the job is, what the person will do, and who they will work with. Blank lines start new paragraphs.">
                <Textarea id="description" name="description" rows={7} maxLength={8000} defaultValue={values.description} placeholder="You will build and run the services behind our plant systems…" />
              </Field>
            </FormFull>
            <FormFull>
              <Field label="Qualifications" htmlFor="qualifications" hint="Education and certifications. One per line.">
                <Textarea id="qualifications" name="qualifications" rows={4} maxLength={4000} defaultValue={values.qualifications} placeholder={"B.E. or B.Tech in computer science, or equivalent"} />
              </Field>
            </FormFull>
            <FormFull>
              <Field label="Skills" htmlFor="skills" hint="One per line.">
                <Textarea id="skills" name="skills" rows={3} maxLength={2000} defaultValue={values.skills} placeholder={"Java 17 and Spring Boot\nSQL"} />
              </Field>
            </FormFull>
            <Field label="Experience from" htmlFor="experienceMinYears" hint="Years.">
              <Input id="experienceMinYears" name="experienceMinYears" inputMode="numeric" defaultValue={values.experienceMinYears} placeholder="3" />
            </Field>
            <Field label="Experience up to" htmlFor="experienceMaxYears" hint="Years. Leave blank for no upper limit.">
              <Input id="experienceMaxYears" name="experienceMaxYears" inputMode="numeric" defaultValue={values.experienceMaxYears} placeholder="6" />
            </Field>
          </FormGrid>
        </div>
      </Card>

      <Card>
        <CardHeader title="Hiring" description="For HR and the hiring manager. The budget is never shown to candidates." />
        <div className="px-6 pb-6">
          <FormGrid>
            <Field label="Openings" htmlFor="openings" required>
              <Input id="openings" name="openings" inputMode="numeric" required defaultValue={values.openings} />
            </Field>
            <Field label="Priority" htmlFor="priority" required>
              <Select id="priority" name="priority" defaultValue={values.priority}>
                {["High", "Medium", "Low"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Hiring manager" htmlFor="hiringManagerEmployeeId">
              <Select id="hiringManagerEmployeeId" name="hiringManagerEmployeeId" defaultValue={values.hiringManagerEmployeeId}>
                <option value="">Not named</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="status" required>
              <Select id="status" name="status" defaultValue={values.status}>
                {["Open", "On hold", "Closed"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Monthly budget from" htmlFor="budgetMin" hint="In rupees.">
              <Input id="budgetMin" name="budgetMin" inputMode="decimal" defaultValue={values.budgetMin} placeholder="60000" />
            </Field>
            <Field label="Monthly budget up to" htmlFor="budgetMax" hint="In rupees.">
              <Input id="budgetMax" name="budgetMax" inputMode="decimal" defaultValue={values.budgetMax} placeholder="85000" />
            </Field>
            <Field label="Posted" htmlFor="postedDate" required>
              <DateInput id="postedDate" name="postedDate" required defaultValue={values.postedDate} />
            </Field>
            <Field label="Close by" htmlFor="targetCloseDate">
              <DateInput id="targetCloseDate" name="targetCloseDate" defaultValue={values.targetCloseDate} />
            </Field>
            <FormFull>
              <Checkbox
                id="isPublished"
                name="isPublished"
                defaultChecked={values.isPublished}
                label="Publish on the careers page, so candidates can apply for it themselves"
              />
            </FormFull>
          </FormGrid>
        </div>
      </Card>

      {state.error ? <FormError>{state.error}</FormError> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          <Spinner on={pending} />
          {editing ? "Save changes" : "Open requisition"}
        </Button>
        <ButtonLink href={editing ? `/recruitment/requisitions/${values.code}` : "/recruitment/requisitions"} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}

export function PublishButton({ code, published }: { code: string; published: boolean }) {
  const [state, action, pending] = useAction(setRequisitionPublished, published ? "Taken off the careers page" : "Published on the careers page");
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="publish" value={published ? "0" : "1"} />
      <Button type="submit" variant={published ? "secondary" : "primary"} disabled={pending}>
        <Spinner on={pending} />
        {published ? "Unpublish" : "Publish"}
      </Button>
      {state.error ? <span className="max-w-[280px] text-right text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}

export function DeleteRequisitionButton({ code }: { code: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useAction(deleteRequisition, `${code} deleted`, () => router.push("/recruitment/requisitions"));
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${code}?`}
        description="A requisition nobody has applied to can be deleted. One with applications is closed instead."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button type="submit" form={formId} variant="destructive" disabled={pending}>
              <Spinner on={pending} />
              Delete requisition
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="pb-1">
          <input type="hidden" name="code" value={code} />
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

/** Copies this site's address for a path, such as a careers page. */
export function CopyLink({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(new URL(path, window.location.origin).toString());
        setCopied(true);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/* ---------------------------------------------------------- applications */

/** Rejecting, at any stage, always with a reason. */
export function RejectButton({
  id,
  label,
  title,
  description,
  placeholder,
  confirm = label,
}: {
  id: number;
  label: string;
  title: string;
  description: string;
  placeholder: string;
  confirm?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useAction(rejectApplication, "Application closed", () => setOpen(false));
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="destructive" disabled={pending}>
              <Spinner on={pending} />
              {confirm}
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Reason" htmlFor={`${formId}-reason`} required hint="Kept on the application for the record. The candidate does not see it.">
            <Textarea id={`${formId}-reason`} name="reason" rows={3} required maxLength={1000} placeholder={placeholder} />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

/** Screening a new application: take it to interview, or reject the profile. */
export function ScreeningActions({ id }: { id: number }) {
  const [state, action, pending] = useAction(takeToInterview, "Taken to interview");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="primary" disabled={pending}>
            <Spinner on={pending} />
            Take to interview
          </Button>
        </form>
        <RejectButton
          id={id}
          label="Reject profile"
          title="Reject this profile"
          description="The application closes here, without an interview."
          placeholder="Experience is in a different stack"
        />
      </div>
      {state.error ? <FormError>{state.error}</FormError> : null}
    </div>
  );
}

/** After interviews: approve the candidate, or reject them. */
export function DecisionActions({ id, blocker }: { id: number; blocker: string | null }) {
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useAction(selectCandidate, "Candidate approved", () => setOpen(false));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setOpen(true)} disabled={Boolean(blocker)}>
          Approve candidate
        </Button>
        <RejectButton
          id={id}
          label="Reject candidate"
          title="Reject after interviews"
          description="The application closes, with the interview notes kept on it."
          placeholder="Strong fundamentals, but the role needs more system design depth"
        />
      </div>
      {blocker ? <p className="text-[13px] text-muted">{blocker}</p> : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Approve the candidate"
        description="They move on to an offer. The interview notes stay on the application."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              <Spinner on={pending} />
              Approve
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Note" htmlFor={`${formId}-note`} hint="Optional: why, for whoever makes the offer.">
            <Textarea id={`${formId}-note`} name="note" rows={3} maxLength={1000} placeholder="Both panels recommend; strongest on the plant integration work" />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </div>
  );
}

/** An approved candidate's offer: the CTC breakdown, joining date and expiry. Builds the letter and sends it to the candidate's own link. */
export function OfferForm({ id, hint, structures, today }: { id: number; hint: string; structures: { code: string; name: string }[]; today: string }) {
  const [state, action, pending] = useAction(makeOffer, "Offer sent to the candidate");
  const formId = React.useId();
  const expiry = new Date(`${today}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 7);
  const defaultExpiry = expiry.toISOString().slice(0, 10);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <FormGrid>
        <Field label="Annual CTC" htmlFor={`${formId}-ctc`} required hint={hint}>
          <Input id={`${formId}-ctc`} name="annualCtc" inputMode="decimal" required placeholder="864000" />
        </Field>
        <Field label="Salary structure" htmlFor={`${formId}-structure`} required>
          <Select id={`${formId}-structure`} name="structureCode" required defaultValue={structures[0]?.code ?? ""}>
            {structures.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Joining date" htmlFor={`${formId}-joining`} required>
          <DateInput id={`${formId}-joining`} name="joiningDate" required min={today} defaultValue={today} />
        </Field>
        <Field label="Offer open until" htmlFor={`${formId}-expiry`} required>
          <DateInput id={`${formId}-expiry`} name="expiryDate" required min={today} defaultValue={defaultExpiry} />
        </Field>
        <FormFull>
          <Field label="Note" htmlFor={`${formId}-note`}>
            <Input id={`${formId}-note`} name="note" maxLength={500} placeholder="Joining in four weeks" />
          </Field>
        </FormFull>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          <Spinner on={pending} />
          Send offer
        </Button>
        <RejectButton
          id={id}
          label="Reject candidate"
          title="Close without an offer"
          description="The application closes without an offer being made."
          placeholder="The role was put on hold"
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ interviews */

export type InterviewValues = {
  id: number;
  round: string;
  interviewerEmployeeId: number | null;
  interviewer: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  mode: string;
  location: string;
};

const ROUNDS = ["Screening call", "Technical round 1", "Technical round 2", "Hiring manager round", "HR round"];
const DURATIONS = [30, 45, 60, 90, 120];
const OTHER = "other";

/** Scheduling a round, or moving one: who, when, how and where. */
export function InterviewButton({
  applicationId,
  employees,
  interview,
  suggestedRound,
  today,
}: {
  applicationId: number;
  employees: Choice[];
  interview?: InterviewValues;
  suggestedRound?: string;
  today: string;
}) {
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const external = interview ? interview.interviewerEmployeeId === null : false;
  const [who, setWho] = React.useState(interview ? (external ? OTHER : String(interview.interviewerEmployeeId)) : "");
  const [state, action, pending] = useAction(scheduleInterview, interview ? "Interview moved" : "Interview scheduled", () => setOpen(false));
  return (
    <>
      {interview ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Change
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus />
          Schedule a round
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={interview ? `Change ${interview.round}` : "Schedule an interview round"}
        description="The interviewer is told, and can open the round to see the candidate and record their notes."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              <Spinner on={pending} />
              {interview ? "Save" : "Schedule"}
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="applicationId" value={applicationId} />
          {interview ? <input type="hidden" name="id" value={interview.id} /> : null}
          <FormGrid>
            <Field label="Round" htmlFor={`${formId}-round`} required>
              <Input
                id={`${formId}-round`}
                name="round"
                required
                maxLength={80}
                list={`${formId}-rounds`}
                defaultValue={interview?.round ?? suggestedRound ?? ""}
              />
              <datalist id={`${formId}-rounds`}>
                {ROUNDS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Interviewer" htmlFor={`${formId}-who`} required>
              <Select id={`${formId}-who`} name="interviewerEmployeeId" required value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose who takes it</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
                <option value={OTHER}>Someone outside the company</option>
              </Select>
            </Field>
            {who === OTHER ? (
              <FormFull>
                <Field label="Their name" htmlFor={`${formId}-name`} required hint="They cannot sign in, so record their notes for them.">
                  <Input id={`${formId}-name`} name="interviewerName" required maxLength={120} defaultValue={external ? interview?.interviewer : ""} />
                </Field>
              </FormFull>
            ) : null}
            <Field label="Date" htmlFor={`${formId}-date`} required>
              <DateInput id={`${formId}-date`} name="scheduledDate" required min={interview ? undefined : today} defaultValue={interview?.scheduledDate ?? ""} />
            </Field>
            <Field label="Time" htmlFor={`${formId}-time`} required>
              <Input id={`${formId}-time`} name="scheduledTime" type="time" required defaultValue={interview?.scheduledTime ?? ""} />
            </Field>
            <Field label="Length" htmlFor={`${formId}-duration`} required>
              <Select id={`${formId}-duration`} name="durationMinutes" defaultValue={String(interview?.durationMinutes ?? 60)}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} minutes` : d === 60 ? "1 hour" : `${d / 60} hours`.replace("1.5 hours", "1½ hours")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How" htmlFor={`${formId}-mode`} required>
              <Select id={`${formId}-mode`} name="mode" defaultValue={interview?.mode ?? "Video call"}>
                {["Video call", "On site", "Phone"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <FormFull>
              <Field label="Where" htmlFor={`${formId}-location`} hint="A meeting link, a room, or an address.">
                <Input id={`${formId}-location`} name="location" maxLength={500} defaultValue={interview?.location ?? ""} placeholder="https://meet.example.com/abc-defg or Room 3B, Bengaluru campus" />
              </Field>
            </FormFull>
          </FormGrid>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

/** A round that will not happen as planned. */
export function InterviewStatusActions({ id, status }: { id: number; status: string }) {
  const [statusState, setStatus, busy] = useAction(setInterviewStatus, "Interview updated");
  const [deleteState, remove, removing] = useAction(deleteInterview, "Interview removed");
  const error = statusState.error ?? deleteState.error;
  const statusButton = (value: string, label: string) => (
    <form action={setStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={value} />
      <Button type="submit" size="sm" variant="ghost" disabled={busy}>
        {label}
      </Button>
    </form>
  );
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {status === "Scheduled" ? (
          <>
            {statusButton("Cancelled", "Cancel")}
            {statusButton("No-show", "Did not come")}
          </>
        ) : (
          statusButton("Scheduled", "Restore")
        )}
        <form action={remove}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="ghost" disabled={removing}>
            Delete
          </Button>
        </form>
      </div>
      {error ? <span className="max-w-[260px] text-right text-[13px] text-danger">{error}</span> : null}
    </div>
  );
}

/** One choice from a few, as a row of pills. */
function PillChoice({
  name,
  legend,
  options,
  defaultValue,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-ink-hover">
        {legend}
        <span className="text-faint"> *</span>
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10",
              value === o.value ? "border-ink bg-ink text-white" : "border-control bg-surface text-ink-hover hover:border-faint",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const RATING_OPTIONS = [
  { value: "1", label: "1 · Poor" },
  { value: "2", label: "2 · Weak" },
  { value: "3", label: "3 · Good" },
  { value: "4", label: "4 · Strong" },
  { value: "5", label: "5 · Exceptional" },
];

/** How a round went: the role's scorecard if it has one, a rating, a recommendation and notes. */
export function FeedbackForm({
  id,
  existing,
  scorecard = [],
}: {
  id: number;
  existing: { rating: number | null; recommendation: string | null; feedback: string | null };
  scorecard?: { criterion: string; rating: number | null }[];
}) {
  const [state, action, pending] = useAction(recordInterviewFeedback, "Notes saved");
  const formId = React.useId();
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={id} />
      {scorecard.length > 0 ? (
        <fieldset className="flex flex-col gap-4 rounded-xl bg-canvas p-4">
          <legend className="px-0.5 text-[13px] font-semibold text-ink">Scorecard</legend>
          {scorecard.map((c) => (
            <PillChoice key={c.criterion} name={`sc:${c.criterion}`} legend={c.criterion} defaultValue={c.rating ? String(c.rating) : ""} options={RATING_OPTIONS} />
          ))}
        </fieldset>
      ) : null}
      <PillChoice name="rating" legend="Rating" defaultValue={existing.rating ? String(existing.rating) : ""} options={RATING_OPTIONS} />
      <PillChoice
        name="recommendation"
        legend="Recommendation"
        defaultValue={existing.recommendation ?? ""}
        options={RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABEL[r] }))}
      />
      <Field label="Notes" htmlFor={`${formId}-notes`} required hint="What you asked, what you saw, and anything the next round should probe.">
        <Textarea id={`${formId}-notes`} name="feedback" rows={8} required maxLength={8000} defaultValue={existing.feedback ?? ""} />
      </Field>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          <Spinner on={pending} />
          {existing.feedback ? "Save notes" : "Record notes"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- pipeline */

/** Applying an existing candidate to an open requisition, for them. */
export function NewApplicationForm({
  candidates,
  requisitions,
}: {
  candidates: { value: string; label: string }[];
  requisitions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useAction(createApplication, "Application created", (r) => {
    setOpen(false);
    if (r.id) router.push(`/recruitment/applications/${r.id}`);
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus />
        Add an application
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add an application"
        description="Apply a candidate HR already has to an open requisition, on their behalf."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              <Spinner on={pending} />
              Add application
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <Field label="Candidate" htmlFor={`${formId}-candidate`} required>
            <Select id={`${formId}-candidate`} name="candidateId" required>
              {candidates.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Requisition" htmlFor={`${formId}-requisition`} required>
            <Select id={`${formId}-requisition`} name="requisitionId" required>
              {requisitions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
