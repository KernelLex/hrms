"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RotateCw } from "lucide-react";
import {
  createIntegrationClient,
  deleteIntegrationClient,
  discardIssue,
  replayWebhookDeliveries,
  retryIssue,
  revokeIntegrationSecrets,
  rotateIntegrationSecret,
  setRecordOwner,
  setWebhookActive,
  updateIntegrationClient,
  type ActionState,
} from "@/app/actions/integrations";
import { SCOPES, type Scope } from "@/lib/api/scopes";
import { Button, Card, CardHeader, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, FormError, FormGrid, Input, Select } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Option = { code: string; name: string };

/** A secret, shown once, with a copy button. */
function SecretOnce({ clientId, secret }: { clientId?: string; secret: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Notice>
      <p className="font-medium text-ink">Copy the secret now. It is not shown again.</p>
      {clientId ? (
        <p className="mt-2">
          Client id <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">{clientId}</code>
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="max-w-full break-all rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">{secret}</code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy secret"}
        </Button>
      </div>
    </Notice>
  );
}

function ScopeBoxes({ granted }: { granted: Scope[] }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-ink-hover">Scopes</legend>
      <ul className="mt-2 flex flex-col gap-2">
        {(Object.keys(SCOPES) as Scope[]).map((s) => (
          <li key={s} className="flex items-start gap-2.5">
            <input type="checkbox" id={`scope-${s}`} name="scope" value={s} defaultChecked={granted.includes(s)} className="mt-0.5 size-4 shrink-0 rounded-[4px] accent-ink" />
            <label htmlFor={`scope-${s}`} className="text-sm text-ink">
              <span className="font-mono text-[13px]">{s}</span>
              <span className="text-muted"> — {SCOPES[s]}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function CompanyBoxes({ companies, chosen }: { companies: Option[]; chosen: string[] }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-ink-hover">Companies it may see</legend>
      <p className="mt-0.5 text-xs text-muted">Leave all unticked for every company.</p>
      <ul className="mt-2 flex flex-col gap-2">
        {companies.map((c) => (
          <li key={c.code} className="flex items-center gap-2.5">
            <input type="checkbox" id={`company-${c.code}`} name="company" value={c.code} defaultChecked={chosen.includes(c.code)} className="size-4 rounded-[4px] accent-ink" />
            <label htmlFor={`company-${c.code}`} className="text-sm text-ink">
              {c.name} <span className="text-muted">{c.code}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Registering a system: name, scopes, companies, addresses. */
export function NewClientForm({ companies, defaultScopes }: { companies: Option[]; defaultScopes: Scope[] }) {
  const [state, action, pending] = useActionState(createIntegrationClient, {} as ActionState);
  if (state.ok && state.secret) {
    return (
      <Card>
        <CardHeader title="Connected" description="Give the client id and secret to the other system's team, over a secure channel." />
        <div className="px-6 pb-5">
          <SecretOnce clientId={state.clientId} secret={state.secret} />
          <p className="mt-4 text-[13px] text-muted">
            They take a token at <code className="font-mono">/api/v1/oauth/token</code>; API.md and the reference at{" "}
            <code className="font-mono">/developers</code> explain the rest.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <form action={action}>
      <Card>
        <CardHeader title="Connect a system" description="Registers a client that can call the API and receive events." />
        <div className="flex flex-col gap-6 px-6 pb-5">
          <FormGrid columns={2}>
            <Field label="Name" htmlFor="name" required>
              <Input id="name" name="name" placeholder="Acme ERP" required />
            </Field>
            <Field label="Label for its ids" htmlFor="systemKey" hint="How its own ids appear in external_ids.">
              <Input id="systemKey" name="systemKey" defaultValue="erp" />
            </Field>
          </FormGrid>
          <ScopeBoxes granted={defaultScopes} />
          <CompanyBoxes companies={companies} chosen={[]} />
          <Field label="Allowed addresses" htmlFor="allowedIps" hint="IP addresses, separated by commas. Leave empty for any.">
            <Input id="allowedIps" name="allowedIps" placeholder="203.0.113.10, 203.0.113.11" />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Connect system
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

export function ClientSettingsForm({
  client,
  companies,
}: {
  client: { pk: number; name: string; scopes: Scope[]; companies: string[]; allowedIps: string[]; status: string; rateLimit: number };
  companies: Option[];
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await updateIntegrationClient(prev, form);
    if (r.ok) toast("Settings saved");
    return r;
  }, {} as ActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={client.pk} />
      <Card>
        <CardHeader title="Settings" description="Scopes removed here stop working at once, even for tokens already issued." />
        <div className="flex flex-col gap-6 px-6 pb-5">
          <FormGrid columns={2}>
            <Field label="Name" htmlFor="name" required>
              <Input id="name" name="name" defaultValue={client.name} required />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={client.status}>
                <option value="active">Active</option>
                <option value="suspended">Suspended: every call refused</option>
              </Select>
            </Field>
            <Field label="Requests a minute" htmlFor="rateLimit">
              <Input id="rateLimit" name="rateLimit" inputMode="numeric" defaultValue={String(client.rateLimit)} />
            </Field>
            <Field label="Allowed addresses" htmlFor="allowedIps" hint="Empty for any.">
              <Input id="allowedIps" name="allowedIps" defaultValue={client.allowedIps.join(", ")} />
            </Field>
          </FormGrid>
          <ScopeBoxes granted={client.scopes} />
          <CompanyBoxes companies={companies} chosen={client.companies} />
          {state.error ? <FormError>{state.error}</FormError> : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save settings
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

export function SecretActions({ pk, olderWorking }: { pk: number; olderWorking: boolean }) {
  const [rotated, rotate, rotating] = useActionState(rotateIntegrationSecret, {} as ActionState);
  const [revoked, revoke, revoking] = useActionState(revokeIntegrationSecrets, {} as ActionState);
  return (
    <div className="flex flex-col gap-3 px-6 pb-5">
      {rotated.ok && rotated.secret ? <SecretOnce secret={rotated.secret} /> : null}
      <div className="flex flex-wrap gap-2">
        <form action={rotate}>
          <input type="hidden" name="id" value={pk} />
          <Button type="submit" size="sm" disabled={rotating}>
            {rotating ? <Loader2 className="animate-spin" /> : <RotateCw />}
            New secret
          </Button>
        </form>
        {olderWorking ? (
          <form action={revoke}>
            <input type="hidden" name="id" value={pk} />
            <Button type="submit" size="sm" variant="destructive" disabled={revoking}>
              Stop older secrets now
            </Button>
          </form>
        ) : null}
      </div>
      <p className="text-xs text-muted">A new secret leaves the current ones working for a day, so the system can switch without an outage.</p>
      {rotated.error || revoked.error ? <FormError>{rotated.error ?? revoked.error}</FormError> : null}
    </div>
  );
}

export function WebhookToggle({ id, active }: { id: number; active: boolean }) {
  const router = useRouter();
  const [, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await setWebhookActive(prev, form);
    router.refresh();
    return r;
  }, {} as ActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {active ? "Pause" : "Resume"}
      </Button>
    </form>
  );
}

export function ReplayButton({ id, clientPk, label }: { id?: number; clientPk?: number; label: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await replayWebhookDeliveries(prev, form);
    if (r.ok) toast("Queued to send again");
    return r;
  }, {} as ActionState);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {clientPk ? <input type="hidden" name="clientId" value={clientPk} /> : null}
      <Button type="submit" size="sm" variant={clientPk ? "secondary" : "ghost"} disabled={pending}>
        {label}
      </Button>
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}

export function OwnerSelect({ recordType, field, owner, allowInherit, label }: { recordType: string; field: string; owner: string; allowInherit: boolean; label: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await setRecordOwner(prev, form);
    if (r.ok) toast("Ownership saved");
    return r;
  }, {} as ActionState);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="recordType" value={recordType} />
      <input type="hidden" name="field" value={field} />
      <Select name="owner" defaultValue={owner} aria-label={`Owner of ${label}`} className="h-8 w-auto text-[13px]">
        {allowInherit ? <option value="inherit">Same as the record</option> : null}
        <option value="hrms">The HRMS</option>
        <option value="erp">The ERP</option>
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}

/** Removes a system that was never really used; one with history is kept — suspend it instead. */
export function DeleteClientButton({ pk, name }: { pk: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await deleteIntegrationClient(prev, form);
    if (r.ok) router.push("/admin/integrations");
    return r;
  }, {} as ActionState);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${name}?`}
        description="Only a system that has never called the API and has no deliveries, acknowledgements or sync issues can be deleted. Its client id and secret stop working at once and cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button type="submit" form="delete-client" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Delete system
            </Button>
          </>
        }
      >
        <form id="delete-client" action={action} className="pb-1">
          <input type="hidden" name="id" value={pk} />
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

export function IssueActions({ id }: { id: number }) {
  const toast = useToast();
  const [retried, retry, retrying] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await retryIssue(prev, form);
    if (r.ok) toast("Applied");
    return r;
  }, {} as ActionState);
  const [, discard, discarding] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await discardIssue(prev, form);
    if (r.ok) toast("Discarded");
    return r;
  }, {} as ActionState);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <form action={retry}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" disabled={retrying}>
            Try again
          </Button>
        </form>
        <form action={discard}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="ghost" disabled={discarding}>
            Discard
          </Button>
        </form>
      </div>
      {retried.error ? <span className="max-w-[240px] text-right text-[13px] text-danger">{retried.error}</span> : null}
    </div>
  );
}
