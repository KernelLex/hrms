"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { saveRole, deleteRole, addRoleMember, removeRoleMember, type ActionState } from "@/app/actions/access";
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { Field, FormError, FormGrid, Input, Select } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Option = { code: string; name: string };

/**
 * A role's name, what it can do — one plain sentence per permission, grouped
 * — and which companies or areas it covers.
 */
export function RoleForm({
  role,
  companies,
  areas,
}: {
  role: {
    code: string;
    name: string;
    description: string | null;
    isBuiltIn: boolean;
    permissions: string[];
    companies: string[];
    areas: string[];
  } | null;
  companies: Option[];
  areas: Option[];
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveRole(prev, form);
      if (result.ok) toast("Role saved");
      return result;
    },
    {},
  );
  const granted = new Set(role?.permissions ?? []);

  return (
    <form action={action} className="flex flex-col gap-6">
      {role ? <input type="hidden" name="originalCode" value={role.code} /> : null}
      <Card>
        <CardHeader
          title={role ? role.name : "New role"}
          description={role?.isBuiltIn ? "Built in: it can be renamed and regranted, but not removed." : undefined}
        />
        <div className="px-6 pb-5">
          <FormGrid columns={2}>
            <Field label="Name" htmlFor="name" required>
              <Input id="name" name="name" defaultValue={role?.name ?? ""} placeholder="Recruiter" required />
            </Field>
            <Field label="Code" htmlFor="code" required hint={role ? "Fixed once created." : "Capital letters, digits and underscores."}>
              <Input
                id="code"
                name="code"
                defaultValue={role?.code ?? ""}
                placeholder="RECRUITER"
                disabled={Boolean(role)}
                required={!role}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="What it is for" htmlFor="description">
                <Input
                  id="description"
                  name="description"
                  defaultValue={role?.description ?? ""}
                  placeholder="Runs hiring: requisitions, candidates and interviews."
                />
              </Field>
            </div>
          </FormGrid>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What it can do"
          description="Someone holding this role can do everything ticked. Sensitive permissions show pay, bank or tax details."
        />
        <div className="px-6 pb-5">
          {PERMISSION_GROUPS.map((group) => {
            const perms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => PERMISSIONS[p].group === group);
            return (
              <fieldset key={group} className="border-t border-soft py-4 first:border-0 first:pt-0">
                <legend className="text-[13px] font-medium text-ink-hover">{group}</legend>
                <ul className="mt-2 flex flex-col gap-2.5">
                  {perms.map((p) => {
                    const def = PERMISSIONS[p] as { can: string; sensitive?: boolean };
                    return (
                      <li key={p} className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          id={`perm-${p}`}
                          name="permission"
                          value={p}
                          defaultChecked={granted.has(p)}
                          className="mt-0.5 size-4 shrink-0 rounded-[4px] accent-ink"
                        />
                        <label htmlFor={`perm-${p}`} className="text-sm text-ink">
                          Can {def.can}
                          {def.sensitive ? (
                            <span className="ml-2 align-middle">
                              <Badge tone="action">Sensitive</Badge>
                            </span>
                          ) : null}
                          <span className="ml-2 font-mono text-xs text-muted">{p}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Where it applies"
          description="Leave everything unticked for the whole organisation. Otherwise, whoever holds the role sees and changes only employees assigned to what is ticked."
        />
        <div className="grid grid-cols-1 gap-6 px-6 pb-5 sm:grid-cols-2">
          <ScopeList title="Companies" name="company" options={companies} ticked={role?.companies ?? []} />
          <ScopeList title="Personnel areas" name="area" options={areas} ticked={role?.areas ?? []} />
        </div>
      </Card>

      {state.error ? <FormError>{state.error}</FormError> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {role ? "Save role" : "Create role"}
        </Button>
      </div>
    </form>
  );
}

function ScopeList({ title, name, options, ticked }: { title: string; name: string; options: Option[]; ticked: string[] }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-ink-hover">{title}</legend>
      <ul className="mt-2 flex flex-col gap-2">
        {options.map((o) => (
          <li key={o.code} className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id={`${name}-${o.code}`}
              name={name}
              value={o.code}
              defaultChecked={ticked.includes(o.code)}
              className="size-4 rounded-[4px] accent-ink"
            />
            <label htmlFor={`${name}-${o.code}`} className="text-sm text-ink">
              {o.name} <span className="text-muted">{o.code}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Who holds the role: add and remove people. */
export function RoleMembers({
  roleCode,
  members,
  users,
}: {
  roleCode: string;
  members: { userId: number; displayName: string; username: string }[];
  users: { id: number; label: string }[];
}) {
  const toast = useToast();
  const [state, add, adding] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await addRoleMember(prev, form);
      if (result.ok) toast("Role given");
      return result;
    },
    {},
  );
  const [removeState, remove, removing] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await removeRoleMember(prev, form);
      if (result.ok) toast("Role taken away");
      return result;
    },
    {},
  );
  const holders = new Set(members.map((m) => m.userId));
  const candidates = users.filter((u) => !holders.has(u.id));

  return (
    <Card>
      <CardHeader title="Who holds it" description="A change applies the next time they open a page." />
      <ul className="px-6">
        {members.length === 0 ? <li className="py-3 text-sm text-muted">Nobody holds this role yet.</li> : null}
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-4 border-b border-soft py-3 last:border-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{m.displayName}</div>
              <div className="text-xs text-muted">{m.username}</div>
            </div>
            <form action={remove}>
              <input type="hidden" name="roleCode" value={roleCode} />
              <input type="hidden" name="userId" value={m.userId} />
              <Button type="submit" size="sm" variant="ghost" disabled={removing} aria-label={`Remove ${m.displayName}`}>
                Remove
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {removeState.error ? (
        <div className="px-6 pb-2">
          <FormError>{removeState.error}</FormError>
        </div>
      ) : null}
      {candidates.length > 0 ? (
        <form action={add} className="flex flex-wrap items-end gap-2 border-t border-soft px-6 py-4">
          <input type="hidden" name="roleCode" value={roleCode} />
          <div className="min-w-0 flex-1">
            <Field label="Give it to" htmlFor="userId">
              <Select id="userId" name="userId" defaultValue="">
                <option value="" disabled>
                  Choose a person
                </option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? <Loader2 className="animate-spin" /> : null}
            Give role
          </Button>
        </form>
      ) : null}
      {state.error ? (
        <div className="px-6 pb-4">
          <FormError>{state.error}</FormError>
        </div>
      ) : null}
    </Card>
  );
}

/** Removing a role HR created. */
export function DeleteRole({ code, name }: { code: string; name: string }) {
  const [state, action, pending] = useActionState(deleteRole, {});
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="code" value={code} />
          <span className="text-[13px] text-muted">Everyone holding {name} loses it.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            Remove role
          </Button>
        </form>
      ) : (
        <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 />
          Remove role
        </Button>
      )}
      {state.error ? <FormError>{state.error}</FormError> : null}
    </div>
  );
}
