"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { saveFlow, type ActionState } from "@/app/actions/access";
import { APPROVER_TYPES } from "@/lib/workflow/processes";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, FormError, FormGrid, Input, Select } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Step = {
  approverType: string;
  approverRole: string;
  approverUserId: string;
  conditionMin: string;
  escalateAfterDays: string;
};

const blank: Step = { approverType: "reporting_manager", approverRole: "", approverUserId: "", conditionMin: "", escalateAfterDays: "" };

/**
 * The steps of one process's approval route, as a form: who approves, when
 * the step applies, and when it escalates. Saving makes a new version;
 * requests already waiting keep the route they started on.
 */
export function FlowForm({
  process,
  factLabel,
  initial,
  roles,
  users,
}: {
  process: string;
  factLabel: string | null;
  initial: Step[];
  roles: { code: string; name: string }[];
  users: { id: number; label: string }[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [steps, setSteps] = React.useState<Step[]>(initial.length ? initial : [blank]);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveFlow(prev, form);
      if (result.ok) {
        toast("Approval flow saved");
        router.push("/admin/approval-flows");
      }
      return result;
    },
    {},
  );

  const set = (i: number, patch: Partial<Step>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="process" value={process} />
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(
          steps.map((s) => ({
            approverType: s.approverType,
            approverRole: s.approverRole || null,
            approverUserId: s.approverUserId ? Number(s.approverUserId) : null,
            conditionMin: s.conditionMin === "" ? null : Number(s.conditionMin),
            escalateAfterDays: s.escalateAfterDays === "" ? null : Number(s.escalateAfterDays),
          })),
        )}
      />
      {steps.map((s, i) => (
        <Card key={i}>
          <CardHeader
            title={`Step ${i + 1}`}
            description={i === 0 ? "Always applies." : "Applies only when its condition holds, if it has one."}
            actions={
              steps.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                  aria-label={`Remove step ${i + 1}`}
                >
                  <X />
                  Remove
                </Button>
              ) : undefined
            }
          />
          <div className="px-6 pb-5">
            <FormGrid columns={2}>
              <Field label="Who approves" htmlFor={`type-${i}`} required>
                <Select id={`type-${i}`} value={s.approverType} onChange={(e) => set(i, { approverType: e.target.value })}>
                  {Object.entries(APPROVER_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              {s.approverType === "role" ? (
                <Field label="Role" htmlFor={`role-${i}`} required>
                  <Select id={`role-${i}`} value={s.approverRole} onChange={(e) => set(i, { approverRole: e.target.value })}>
                    <option value="">Choose a role</option>
                    {roles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : s.approverType === "person" ? (
                <Field label="Person" htmlFor={`person-${i}`} required>
                  <Select id={`person-${i}`} value={s.approverUserId} onChange={(e) => set(i, { approverUserId: e.target.value })}>
                    <option value="">Choose a person</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div />
              )}
              {i > 0 && factLabel ? (
                <Field label={`Only when more than this many ${factLabel}`} htmlFor={`min-${i}`} hint="Empty means every request.">
                  <Input
                    id={`min-${i}`}
                    inputMode="decimal"
                    value={s.conditionMin}
                    onChange={(e) => set(i, { conditionMin: e.target.value })}
                    placeholder="5"
                  />
                </Field>
              ) : null}
              <Field label="Add HR after this many days waiting" htmlFor={`esc-${i}`} hint="Empty means it never escalates.">
                <Input
                  id={`esc-${i}`}
                  inputMode="numeric"
                  value={s.escalateAfterDays}
                  onChange={(e) => set(i, { escalateAfterDays: e.target.value })}
                  placeholder="3"
                />
              </Field>
            </FormGrid>
          </div>
        </Card>
      ))}

      {state.error ? <FormError>{state.error}</FormError> : null}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" onClick={() => setSteps((all) => [...all, blank])} disabled={steps.length >= 5}>
          <Plus />
          Add a step
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save as a new version
        </Button>
      </div>
    </form>
  );
}
