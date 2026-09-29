"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveLetterTemplate, type ActionState } from "@/app/actions/lifecycle";
import { MERGE_FIELD_NAMES } from "@/lib/lifecycle-values";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, FormError, Input, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";

const INITIAL: ActionState = {};
const FIELD_HINT = MERGE_FIELD_NAMES.map((f) => `{{${f}}}`).join(", ");

function TemplateDialog({
  buttonLabel,
  buttonVariant,
  title,
  kind,
  body,
  kindEditable,
}: {
  buttonLabel: string;
  buttonVariant?: "primary" | "secondary" | "ghost";
  title: string;
  kind?: string;
  body?: string;
  kindEditable: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const formId = `letter-template-${kind ?? "new"}`;
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await saveLetterTemplate(prev, form);
    if (r.ok) {
      setOpen(false);
      toast("Letter template saved");
    }
    return r;
  }, INITIAL);

  return (
    <>
      <Button type="button" size="sm" variant={buttonVariant} onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={`Merge fields it can use: ${FIELD_HINT}.`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save as a new version
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <Field label="Kind" htmlFor={`kind-${kind ?? "new"}`} required>
            <Input id={`kind-${kind ?? "new"}`} name="kind" required defaultValue={kind} readOnly={!kindEditable} disabled={!kindEditable} placeholder="Appointment" />
          </Field>
          <Field label="Body" htmlFor={`body-${kind ?? "new"}`} required hint="One or more paragraphs, separated by a blank line.">
            <Textarea id={`body-${kind ?? "new"}`} name="body" required rows={10} defaultValue={body} />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

export function NewTemplateButton() {
  return <TemplateDialog buttonLabel="New letter kind" title="New letter kind" kindEditable />;
}

export function EditTemplateButton({ kind, body }: { kind: string; body: string }) {
  return <TemplateDialog buttonLabel="Edit" buttonVariant="ghost" title={`Edit ${kind}`} kind={kind} body={body} kindEditable={false} />;
}
