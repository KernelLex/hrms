"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, History } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Table,
  Th,
  Tr,
  Td,
  EmptyState,
} from "@/components/ui";
import {
  Field,
  Input,
  Select,
  DateInput,
  FormGrid,
  FormError,
} from "@/components/inputs";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import type { FieldDef } from "@/components/master-screen";
import type { ActionState } from "@/app/actions/core-hr";
import { formatDateRange, todayInIndia } from "@/lib/dates";

export type HistoryRow = {
  id: string;
  cells: Record<string, React.ReactNode>;
  values: Record<string, string>;
  /** Present on sliced infotypes; drives the validity inputs when editing. */
  validFrom?: string;
  validTo?: string;
  describe: string;
};

/**
 * One infotype's editor: the record history, and a dialog that writes a new
 * record rather than overwriting the old one.
 *
 * For sliced infotypes the dialog asks for a valid-from date, because that is
 * the whole point — saving does not replace what was true before, it ends it.
 */
export function InfotypeEditor({
  employeeId,
  code,
  name,
  description,
  sliced,
  fields,
  columns,
  rows,
  saveAction,
  deleteAction,
}: {
  employeeId: number;
  code: string;
  name: string;
  description: string;
  sliced: boolean;
  fields: FieldDef[];
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: HistoryRow[];
  saveAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  deleteAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const toast = useToast();
  const [editing, setEditing] = React.useState<HistoryRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<HistoryRow | null>(null);

  const open = creating || editing !== null;
  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const [saveState, save, saving] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveAction(prev, form);
      if (result.ok) {
        close();
        toast(sliced ? "Record saved, previous one delimited" : "Record saved");
      }
      return result;
    },
    {},
  );

  const [deleteState, remove, removingBusy] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await deleteAction(prev, form);
      if (result.ok) {
        setRemoving(null);
        toast("Record deleted");
      }
      return result;
    },
    {},
  );

  return (
    <>
      <Card>
        <CardHeader
          title={name}
          description={description}
          actions={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {sliced ? "New record" : "Add"}
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState icon={<History />} title="Nothing recorded yet">
            {sliced
              ? "Add a record and give it a valid-from date."
              : "Add the first entry."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                {sliced ? <Th>Valid</Th> : null}
                {columns.map((c) => (
                  <Th key={c.key} numeric={c.numeric}>
                    {c.label}
                  </Th>
                ))}
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  {sliced ? (
                    <Td>
                      <span className="tabular text-secondary">
                        {r.validFrom ? formatDateRange(r.validFrom, r.validTo) : "—"}
                      </span>
                    </Td>
                  ) : null}
                  {columns.map((c) => (
                    <Td key={c.key} numeric={c.numeric}>
                      {r.cells[c.key]}
                    </Td>
                  ))}
                  <Td className="text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      {!sliced ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                      ) : null}
                      <Button size="sm" variant="destructive" onClick={() => setRemoving(r)}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        key={editing ? `edit-${editing.id}` : "create"}
        open={open}
        onClose={close}
        wide
        title={editing ? `Edit ${name.toLowerCase()}` : `New ${name.toLowerCase()} record`}
        description={
          sliced
            ? "Saving ends the record that was valid before this date. Nothing is overwritten."
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="infotype-form" variant="primary" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save record
            </Button>
          </>
        }
      >
        <form id="infotype-form" action={save} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="infotype" value={code} />
          {editing && !sliced ? (
            <input type="hidden" name="id" value={editing.id} />
          ) : null}

          <FormGrid columns={2}>
            {sliced ? (
              <>
                <Field label="Valid from" htmlFor="validFrom" required>
                  <DateInput
                    id="validFrom"
                    name="validFrom"
                    required
                    defaultValue={editing?.validFrom ?? ""}
                  />
                </Field>
                <Field
                  label="Valid to"
                  htmlFor="validTo"
                  hint="Leave empty for open ended."
                >
                  <DateInput
                    id="validTo"
                    name="validTo"
                    defaultValue={
                      editing?.validTo && editing.validTo !== "9999-12-31"
                        ? editing.validTo
                        : ""
                    }
                  />
                </Field>
              </>
            ) : (
              <input type="hidden" name="validFrom" value={todayInIndia()} />
            )}

            {fields.map((f) => {
              const value = editing?.values[f.name] ?? "";
              if (f.kind === "checkbox") return null;
              const control =
                f.kind === "select" ? (
                  <Select id={`if-${f.name}`} name={f.name} defaultValue={value} required={f.required}>
                    {f.emptyLabel ? <option value="">{f.emptyLabel}</option> : null}
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.kind === "date" ? (
                  <DateInput id={`if-${f.name}`} name={f.name} defaultValue={value} required={f.required} />
                ) : (
                  <Input
                    id={`if-${f.name}`}
                    name={f.name}
                    defaultValue={value}
                    placeholder={f.placeholder}
                    required={f.required}
                  />
                );
              return (
                <Field
                  key={f.name}
                  label={f.label}
                  htmlFor={`if-${f.name}`}
                  required={f.required}
                  hint={f.hint}
                  className={"full" in f && f.full ? "sm:col-span-2" : undefined}
                >
                  {control}
                </Field>
              );
            })}
          </FormGrid>

          {saveState.error ? <FormError>{saveState.error}</FormError> : null}
        </form>
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Delete record"
        description={removing ? `${removing.describe} will be removed.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={removingBusy}>
              Cancel
            </Button>
            <Button type="submit" form="delete-infotype" variant="destructive" disabled={removingBusy}>
              {removingBusy ? <Loader2 className="animate-spin" /> : null}
              Delete record
            </Button>
          </>
        }
      >
        <form id="delete-infotype" action={remove} className="pb-1">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="infotype" value={code} />
          <input type="hidden" name="id" value={removing?.id ?? ""} />
          <p className="text-sm text-secondary">
            {sliced
              ? "The record valid before this one will be extended to cover the gap, so the history stays continuous."
              : "This cannot be undone."}
          </p>
          {deleteState.error ? (
            <div className="mt-4">
              <FormError>{deleteState.error}</FormError>
            </div>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
