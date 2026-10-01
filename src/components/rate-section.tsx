"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, Inbox } from "lucide-react";
import { Button, Card, CardHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { Field, Input, Select, DateInput, Checkbox, FormGrid, FormError } from "@/components/inputs";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import type { ActionState } from "@/app/actions/org";
import type { Column, FieldDef, Row } from "@/components/master-screen";

/**
 * A compact master-data list that lives inside one Card section rather than
 * owning a whole page — several of these stack under one PageHeader, the way
 * dated statutory rates (PF, ESI, professional tax, LWF) share one screen.
 *
 * Same dialog-driven editing as MasterScreen, without its own page header.
 */
export function RateSection({
  title,
  description,
  entity,
  columns,
  rows,
  fields,
  idField,
  saveAction,
  deleteAction,
  emptyHint,
  hiddenFields,
}: {
  title: string;
  description: string;
  entity: string;
  columns: Column[];
  rows: Row[];
  fields: FieldDef[];
  idField: string;
  saveAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  /** Submitted with every save, outside the editable fields — such as the employee a list is scoped to. */
  hiddenFields?: Record<string, string | number>;
  deleteAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  emptyHint: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<Row | null>(null);

  const open = creating || editing !== null;
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const [saveState, saveFormAction, saving] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveAction(prev, form);
      if (result.ok) {
        closeForm();
        toast(`${cap(entity)} saved`);
      }
      return result;
    },
    {},
  );

  const [deleteState, deleteFormAction, deletingBusy] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await deleteAction(prev, form);
      if (result.ok) {
        setRemoving(null);
        toast(`${cap(entity)} deleted`);
      }
      return result;
    },
    {},
  );

  return (
    <div className="mt-6">
      <Card>
        <CardHeader
          title={title}
          description={description}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus />
              Add
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState icon={<Inbox />} title={`No ${entity} records yet`}>
            {emptyHint}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
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
                  {columns.map((c) => (
                    <Td key={c.key} numeric={c.numeric}>
                      {r.cells[c.key]}
                    </Td>
                  ))}
                  <Td className="text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
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
        key={editing ? `edit-${editing.id}` : `create-${entity}`}
        open={open}
        onClose={closeForm}
        title={editing ? `Edit ${entity}` : `New ${entity}`}
        description={editing ? `Changing ${editing.describe}.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form={`form-${entity}`} variant="primary" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </>
        }
      >
        <form id={`form-${entity}`} action={saveFormAction} className="flex flex-col gap-4 pb-1">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          {hiddenFields
            ? Object.entries(hiddenFields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
            : null}
          <FormGrid columns={2}>
            {fields.map((f) => {
              const defaultValue = editing?.values[f.name];
              if (f.kind === "checkbox") {
                return (
                  <div key={f.name} className="flex items-end pb-2 sm:col-span-2">
                    <Checkbox id={`f-${entity}-${f.name}`} name={f.name} label={f.label} defaultChecked={editing ? Boolean(defaultValue) : false} />
                  </div>
                );
              }
              const control =
                f.kind === "select" ? (
                  <Select id={`f-${entity}-${f.name}`} name={f.name} defaultValue={String(defaultValue ?? "")} required={f.required}>
                    {f.emptyLabel ? <option value="">{f.emptyLabel}</option> : null}
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.kind === "date" ? (
                  <DateInput id={`f-${entity}-${f.name}`} name={f.name} defaultValue={String(defaultValue ?? "")} required={f.required} />
                ) : (
                  <Input id={`f-${entity}-${f.name}`} name={f.name} defaultValue={String(defaultValue ?? "")} placeholder={f.placeholder} required={f.required} />
                );
              return (
                <Field key={f.name} label={f.label} htmlFor={`f-${entity}-${f.name}`} required={f.required} hint={f.hint} className={"full" in f && f.full ? "sm:col-span-2" : undefined}>
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
        title={`Delete ${entity}`}
        description={removing ? `${removing.describe} will be removed.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button type="submit" form={`delete-${entity}`} variant="destructive" disabled={deletingBusy}>
              {deletingBusy ? <Loader2 className="animate-spin" /> : null}
              Delete
            </Button>
          </>
        }
      >
        <form id={`delete-${entity}`} action={deleteFormAction} className="pb-1">
          <input type="hidden" name={idField} value={removing?.id ?? ""} />
          <p className="text-sm text-secondary">This cannot be undone.</p>
          {deleteState.error ? (
            <div className="mt-4">
              <FormError>{deleteState.error}</FormError>
            </div>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
