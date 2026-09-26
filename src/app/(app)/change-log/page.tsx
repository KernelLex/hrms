import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { getSession, hasRole } from "@/lib/auth";
import { changeFacets, listChanges } from "@/lib/repositories/change-log";
import { entityLabel } from "@/lib/change-format";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { DateInput, Field, FormGrid, Select } from "@/components/inputs";
import { ChangeLogTable } from "@/components/change-log";
import { Pagination, pageFrom } from "@/components/pagination";

/**
 * Everything anyone changed, across the organisation, newest first. Filter
 * by what was changed, by whom, and when.
 */
export default async function ChangeLogPage(props: {
  searchParams: Promise<{ entity?: string; actor?: string; from?: string; to?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const params = await props.searchParams;
  const filter = {
    entity: params.entity || undefined,
    actor: params.actor || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };
  const filtered = Object.values(filter).some(Boolean);
  const { page, limit, offset } = pageFrom(params.page);
  const [{ rows, total }, facets] = await Promise.all([
    listChanges(filter, limit, offset),
    changeFacets(),
  ]);

  const entities = facets.entities
    .map((e) => ({ value: e, label: entityLabel(e) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <PageHeader
        title="Change log"
        subtitle="Who changed what, and when, across every record. Each entry keeps the value before and after."
      />

      <Card className="mb-6">
        <form className="p-5">
          <FormGrid columns={2} className="lg:grid-cols-4">
            <Field label="What changed" htmlFor="entity">
              <Select id="entity" name="entity" defaultValue={filter.entity ?? ""}>
                <option value="">Everything</option>
                {entities.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Changed by" htmlFor="actor">
              <Select id="actor" name="actor" defaultValue={filter.actor ?? ""}>
                <option value="">Anyone</option>
                {facets.actors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" htmlFor="from">
              <DateInput id="from" name="from" defaultValue={filter.from ?? ""} />
            </Field>
            <Field label="To" htmlFor="to">
              <DateInput id="to" name="to" defaultValue={filter.to ?? ""} />
            </Field>
          </FormGrid>
          <div className="mt-4 flex items-center gap-2">
            <Button type="submit">Apply filters</Button>
            {filtered ? (
              <Link
                href="/change-log"
                className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink"
              >
                Clear
              </Link>
            ) : null}
            <span className="tabular ml-auto text-[13px] text-muted">
              {total.toLocaleString("en-IN")} {total === 1 ? "change" : "changes"}
            </span>
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<History />} title={filtered ? "No changes match" : "No changes recorded yet"}>
            {filtered
              ? "Try a wider date range, or clear the filters."
              : "Every save, approval and payroll step is recorded here from now on."}
          </EmptyState>
        ) : (
          <>
            <ChangeLogTable rows={rows} showSubject />
            <Pagination
              page={page}
              total={total}
              path="/change-log"
              params={{ entity: filter.entity, actor: filter.actor, from: filter.from, to: filter.to }}
              noun="changes"
            />
          </>
        )}
      </Card>
    </>
  );
}
