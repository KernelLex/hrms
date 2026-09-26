import Link from "next/link";
import { Users, UserPlus, Layers } from "lucide-react";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  EmptyState,
  ButtonLink,
} from "@/components/ui";
import { Field, Input, Select, FormGrid } from "@/components/inputs";

/**
 * CH-04 — employee search, and the way into every other Core HR screen.
 *
 * Filtering runs on the server through the URL, so a filtered list is a real
 * address someone can send to a colleague.
 */
export default async function EmployeesPage(props: {
  searchParams: Promise<{ q?: string; status?: string; unit?: string }>;
}) {
  const params = await props.searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const status = params.status ?? "";
  const unit = params.unit ?? "";

  const all = await listEmployees();
  const units = [...new Set(all.map((e) => e.org_unit_name).filter(Boolean))] as string[];

  const rows = all.filter((e) => {
    if (status && e.employment_status !== status) return false;
    if (unit && e.org_unit_name !== unit) return false;
    if (!q) return true;
    const haystack = [
      e.employee_number,
      e.first_name,
      e.last_name,
      e.position_title,
      e.org_unit_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Every person on the books. Records are dated, so nothing is overwritten when something changes."
        actions={
          <>
            <ButtonLink href="/core-hr/mass-update">
              <Layers />
              Mass update
            </ButtonLink>
            <ButtonLink href="/core-hr/hire" variant="primary">
              <UserPlus />
              Hire employee
            </ButtonLink>
          </>
        }
      />

      <Card className="mb-6">
        <form className="p-5">
          <FormGrid columns={3}>
            <Field label="Search" htmlFor="q">
              <Input
                id="q"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Name, number or position"
              />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={status}>
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="On leave">On leave</option>
                <option value="Terminated">Terminated</option>
              </Select>
            </Field>
            <Field label="Department" htmlFor="unit">
              <Select id="unit" name="unit" defaultValue={unit}>
                <option value="">All</option>
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-ink-hover"
            >
              Apply filters
            </button>
            {q || status || unit ? (
              <Link
                href="/core-hr"
                className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink"
              >
                Clear
              </Link>
            ) : null}
            <span className="ml-auto text-[13px] text-muted">
              {rows.length} of {all.length}
            </span>
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={all.length === 0 ? "No employees yet" : "Nothing matches those filters"}
            action={
              all.length === 0 ? (
                <ButtonLink href="/core-hr/hire" variant="primary">
                  <UserPlus />
                  Hire employee
                </ButtonLink>
              ) : undefined
            }
          >
            {all.length === 0
              ? "Run a hire action to create the first employee record."
              : "Try a broader search, or clear the filters."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Position</Th>
                <Th>Department</Th>
                <Th>Joined</Th>
                <Th numeric>Basic pay</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`/core-hr/${e.id}`} className="hover:underline">
                      <TwoLine value={fullName(e)} sub={e.employee_number} />
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-secondary">
                      {e.position_title ?? <span className="text-decor">&mdash;</span>}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-secondary">
                      {e.org_unit_name ?? <span className="text-decor">&mdash;</span>}
                    </span>
                  </Td>
                  <Td>
                    <span className="tabular text-secondary">{e.hire_date}</span>
                  </Td>
                  <Td numeric>
                    {e.amount_paise !== null ? (
                      formatINR(e.amount_paise)
                    ) : (
                      <span className="text-decor">&mdash;</span>
                    )}
                  </Td>
                  <Td>
                    <Status
                      tone={
                        e.employment_status === "Active"
                          ? "done"
                          : e.employment_status === "On leave"
                            ? "waiting"
                            : "neutral"
                      }
                    >
                      {e.employment_status}
                    </Status>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link
                      href={`/core-hr/${e.id}`}
                      className="text-[13px] font-medium text-ink hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
