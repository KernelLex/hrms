"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/app/actions/tax";
import { Button } from "@/components/ui";
import { Field, Select, Checkbox, NumberInput, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { toRupees } from "@/lib/money";

type Company = { code: string; name: string; country: string };
type Component = { country: string; code: string; name: string; capPaise: number | null };
type Chosen = { companyCode: string; componentCode: string; isEnabled: boolean; capOverridePaise: number | null };

const INITIAL: ActionState = {};

/**
 * One company's list: every component its country defines, each on or off,
 * with a cap it may tighten. Absence of a row means "as the country defines
 * it", so a new statutory component reaches everybody without an edit here.
 */
export function CompanyComponents({
  companies,
  components,
  chosen,
  save,
}: {
  companies: Company[];
  components: Component[];
  chosen: Chosen[];
  save: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [companyCode, setCompanyCode] = React.useState(companies[0]?.code ?? "");
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await save(prev, form);
    if (result.ok) {
      toast("Saved");
      router.refresh();
    }
    return result;
  }, INITIAL);

  const company = companies.find((c) => c.code === companyCode);
  const forCountry = components.filter((c) => c.country === (company?.country ?? "India"));
  const settingOf = (code: string) => chosen.find((c) => c.companyCode === companyCode && c.componentCode === code);

  if (companies.length === 0) return <p className="px-6 pb-6 text-[13px] text-muted">Add a company first.</p>;

  return (
    <div className="px-6 pb-6">
      <div className="mb-4 max-w-sm">
        <Field label="Company" htmlFor="company-picker">
          <Select id="company-picker" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)}>
            {companies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {forCountry.length === 0 ? (
        <p className="text-[13px] text-muted">
          Nothing is defined for {company?.country ?? "this country"} yet. Add a component above.
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="companyCode" value={companyCode} />
          {forCountry.map((c) => {
            const setting = settingOf(c.code);
            return (
              <div key={c.code} className="flex flex-wrap items-end gap-4 border-b border-soft pb-3 last:border-0">
                <div className="min-w-[220px] flex-1">
                  <div className="text-sm font-medium text-ink">
                    {c.code} — {c.name}
                  </div>
                  <div className="text-[13px] text-muted">
                    {c.capPaise === null ? "No statutory cap" : `Statutory cap ${toRupees(c.capPaise).toLocaleString("en-IN")}`}
                  </div>
                </div>
                <Checkbox
                  id={`enabled-${c.code}`}
                  name={`enabled.${c.code}`}
                  label="Offered"
                  defaultChecked={setting?.isEnabled ?? true}
                />
                <Field label="Cap for this company" htmlFor={`cap-${c.code}`}>
                  <NumberInput
                    id={`cap-${c.code}`}
                    name={`cap.${c.code}`}
                    min="0"
                    step="1"
                    placeholder="As the law sets"
                    defaultValue={setting?.capOverridePaise === null || setting?.capOverridePaise === undefined ? "" : String(toRupees(setting.capOverridePaise))}
                  />
                </Field>
              </div>
            );
          })}
          {state.error ? <FormError>{state.error}</FormError> : null}
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save what {company?.code ?? "this company"} offers
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
