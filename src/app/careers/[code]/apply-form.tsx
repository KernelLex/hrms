"use client";

import * as React from "react";
import { useActionState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { applyForJob, type ApplyState } from "@/app/actions/careers";
import { Button } from "@/components/ui";
import { Field, FormError, Input, Textarea } from "@/components/inputs";

/** Applying for one role: details, resume, a note, and consent. */
export function ApplyForm({ code, title }: { code: string; title: string }) {
  const [state, action, pending] = useActionState(applyForJob, {} as ApplyState);
  const done = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (state.ok) done.current?.focus();
  }, [state.ok]);

  if (state.ok) {
    return (
      <div ref={done} tabIndex={-1} role="status" className="flex flex-col items-start gap-2 py-4 outline-none">
        <CircleCheck className="size-7 text-ink" />
        <h3 className="text-[17px] font-semibold text-ink">Thank you, your application is in</h3>
        <p className="text-[13px] text-muted">
          We have sent a confirmation to your email. Our recruitment team reads every application for {title} and will be in touch about next steps.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="code" value={code} />
      {/* Left empty by people; filled in by bots, whose applications are dropped. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Field label="Full name" htmlFor="fullName" required>
        <Input id="fullName" name="fullName" required autoComplete="name" maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" required autoComplete="email" maxLength={200} />
      </Field>
      <Field label="Phone" htmlFor="phone" required>
        <Input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+91 98765 43210" maxLength={20} />
      </Field>
      <Field label="Where you work now" htmlFor="currentEmployer">
        <Input id="currentEmployer" name="currentEmployer" autoComplete="organization" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Experience" htmlFor="experienceYears" hint="Years.">
          <Input id="experienceYears" name="experienceYears" inputMode="numeric" maxLength={2} />
        </Field>
        <Field label="Notice period" htmlFor="noticePeriodDays" hint="Days.">
          <Input id="noticePeriodDays" name="noticePeriodDays" inputMode="numeric" maxLength={3} />
        </Field>
      </div>
      <Field label="LinkedIn or portfolio" htmlFor="profileLink">
        <Input id="profileLink" name="profileLink" type="url" placeholder="https://" maxLength={300} />
      </Field>
      <Field label="Resume" htmlFor="resume" required hint="A PDF or Word document, up to 4 MB.">
        <input
          id="resume"
          name="resume"
          type="file"
          required
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-soft file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-ink hover:file:bg-line"
        />
      </Field>
      <Field label="Anything you would like us to know" htmlFor="coverNote">
        <Textarea id="coverNote" name="coverNote" rows={4} maxLength={3000} />
      </Field>
      <div className="flex items-start gap-2.5">
        <input id="consent" name="consent" type="checkbox" required className="mt-0.5 size-4 shrink-0 rounded-[4px] border-control accent-ink" />
        <label htmlFor="consent" className="text-[13px] text-ink-hover">
          I agree that my details and resume are kept and used to consider me for this role.
        </label>
      </div>

      {state.error ? <FormError>{state.error}</FormError> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Send application
      </Button>
    </form>
  );
}
