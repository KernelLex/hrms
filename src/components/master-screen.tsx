"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, Inbox } from "lucide-react";
import {
  Button,
  Card,
  PageHeader,
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
  Checkbox,
  FormGrid,
  FormError,
} from "@/components/inputs";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import type { ActionState } from "@/app/actions/org";

/**
 * The shared shape of a master-data screen: a list, one primary action that
 * opens a dialog, and per-row edit and delete.
 *
 * The reference mockups put a form and a grid on one page with four equal
 * buttons (Save / New / Edit selected / Delete selected), which needs the
 * reader to hold a selection in their head and breaks §9's "at most one
 * primary button per screen". A list with a dialog says the same thing with
 * less to remember.
 */

export type FieldDef =
  | {
      kind: "text";
      name: string;
      label: string;
      required?: boolean;
      placeholder?: string;
      hint?: string;
      full?: boolean;
      uppercase?: boolean;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      options: { value: string; label: string }[];
      required?: boolean;
      emptyLabel?: string;
      hint?: string;
      full?: boolean;
    }
  | { kind: "date"; name: string; label: string; required?: boolean; hint?: string }
  | { kind: "checkbox"; name: string; label: string };

export type Column = { key: string; label: string; numeric?: boolean };

export type Row = {
  id: string;
  cells: Record<string, React.ReactNode>;
  values: Record<string, string | boolean>;
  /** Shown in the delete confirmation, so it names what is being removed. */
  describe: string;
};

type Props = {
  title: string;
  subtitle: string;
  /** Singular, lower case — used in buttons and messages. */
  entity: string;
  columns: Column[];
  rows: Row[];
  fields: FieldDef[];
  /** Identifies the record on edit and delete. */
  idField: string;
  saveAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  deleteAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  /** The code cannot change once other records point at it. */
  lockIdOnEdit?: boolean;
  /** Append-only records (a reporting-line history) offer no edit. */
  allowEdit?: boolean;
  emptyHint: string;
  wideDialog?: boolean;
  /** Under the table, inside the card: paging for lists that grow. */
  footer?: React.ReactNode;
  /** How many records exist in all, when the rows are one page of them. */
  total?: number;
};

const INITIAL: ActionState = {};

export function MasterScreen({
  title,
  subtitle,
  entity,
  columns,
  rows,
  fields,
  idField,
  saveAction,
  deleteAction,
  lockIdOnEdit = true,
  allowEdit = true,
  emptyHint,
  wideDialog,
  footer,
  total,
}: Props) {
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
        const wasEditing = form.get("originalCode") !== null && form.get("originalCode") !== "";
        closeForm();
        toast(wasEditing ? `${cap(entity)} updated` : `${cap(entity)} saved`);
      }
      return result;
    },
    INITIAL,
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
    INITIAL,
  );

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New {entity}
          </Button>
        }
      />

      <Card>
        {rows.length === 0 && !total ? (
          <EmptyState
            icon={<Inbox />}
            title={`No ${entity} records yet`}
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                New {entity}
              </Button>
            }
          >
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
                      {allowEdit ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRemoving(r)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {footer}
      </Card>

      {/* Create and edit share one dialog; the key remounts it so defaults reset. */}
      <Dialog
        key={editing ? `edit-${editing.id}` : "create"}
        open={open}
        onClose={closeForm}
        wide={wideDialog}
        title={editing ? `Edit ${entity}` : `New ${entity}`}
        description={
          editing ? `Changing ${editing.describe}.` : `Add a ${entity} to the org structure.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="master-form"
              variant="primary"
              disabled={saving}
            >
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save {entity}
            </Button>
          </>
        }
      >
        <form id="master-form" action={saveFormAction} className="flex flex-col gap-4 pb-1">
          {editing ? (
            <input type="hidden" name="originalCode" value={editing.id} />
          ) : null}

          <FormGrid columns={2}>
            {fields.map((f) => {
              const locked =
                lockIdOnEdit && editing !== null && f.kind !== "checkbox" && f.name === idField;
              const defaultValue = editing?.values[f.name];

              if (f.kind === "checkbox") {
                return (
                  <div key={f.name} className="flex items-end pb-2 sm:col-span-2">
                    <Checkbox
                      id={`f-${f.name}`}
                      name={f.name}
                      label={f.label}
                      defaultChecked={
                        editing ? Boolean(defaultValue) : f.name === "isActive"
                      }
                    />
                  </div>
                );
              }

              const control =
                f.kind === "select" ? (
                  <Select
                    id={`f-${f.name}`}
                    name={f.name}
                    defaultValue={String(defaultValue ?? "")}
                    required={f.required}
                    disabled={locked}
                  >
                    {f.emptyLabel ? <option value="">{f.emptyLabel}</option> : null}
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.kind === "date" ? (
                  <DateInput
                    id={`f-${f.name}`}
                    name={f.name}
                    defaultValue={String(defaultValue ?? "")}
                    required={f.required}
                    disabled={locked}
                  />
                ) : (
                  <Input
                    id={`f-${f.name}`}
                    name={f.name}
                    defaultValue={String(defaultValue ?? "")}
                    placeholder={f.placeholder}
                    required={f.required}
                    disabled={locked}
                    className={f.uppercase ? "uppercase" : undefined}
                  />
                );

              return (
                <Field
                  key={f.name}
                  label={f.label}
                  htmlFor={`f-${f.name}`}
                  required={f.required}
                  hint={locked ? "A code cannot be changed once it is in use." : f.hint}
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

      {/* §9 — destructive confirmations name the thing being removed. */}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Delete ${entity}`}
        description={removing ? `${removing.describe} will be removed.` : undefined}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setRemoving(null)}
              disabled={deletingBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="delete-form"
              variant="destructive"
              disabled={deletingBusy}
            >
              {deletingBusy ? <Loader2 className="animate-spin" /> : null}
              Delete {entity}
            </Button>
          </>
        }
      >
        <form id="delete-form" action={deleteFormAction} className="pb-1">
          <input type="hidden" name={idField === "id" ? "id" : "code"} value={removing?.id ?? ""} />
          <p className="text-sm text-secondary">
            This cannot be undone.
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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
