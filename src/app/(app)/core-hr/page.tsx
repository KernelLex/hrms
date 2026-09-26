import Link from "next/link";
import { Users, UserPlus, Layers, Download } from "lucide-react";
import { can, requirePage } from "@/lib/access";
import {
  searchEmployees,
  listDepartmentNames,
  listDirectReports,
  fullName,
} from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
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
  ButtonAnchor,
} from "@/components/ui";
import { Field, Input, Select, FormGrid } from "@/components/inputs";
import { Pagination, pageFrom } from "@/components/pagination";

/**
 * CH-04 — employee search, and the way into every other Core HR screen.
 *
 * Filtering and paging run on the server through the URL, so a filtered list
 * is a real address someone can send to a colleague, and only one page of
 * people is ever read.
 *
 * HR sees everyone. A manager sees their direct reports and nothing about
 * their pay — the employee record itself is an HR screen.
 */
export default async function EmployeesPage(props: {
  searchParams: Promise<{ q?: string; status?: string; unit?: string; page?: string }>;
}) {
  const session = await requirePage(["employee.view_all", "employee.view_team"]);
  const isHr = can(session, "employee.view_all");
  const seesPay = isHr && can(session, "pay.view");

  const params = await props.searchParams;
  const q = (params.q ?? "").trim();
  const status = params.status ?? "";
  const unit = params.unit ?? "";
  const { page, limit, offset } = pageFrom(params.page);

  // A role limited to some companies or areas sees only the people there.
  const scope = isHr ? session.scope : null;
  const onlyIds = isHr
    ? undefined
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];

  const [{ rows, total }, everyone, units] = await Promise.all([
    searchEmployees({ q, status, unit, onlyIds, scope }, { limit, offset }),
    q || status || unit ? searchEmployees({ onlyIds, scope }, { limit: 1, offset: 0 }) : null,
    listDepartmentNames(),
  ]);
  const overall = everyone?.total ?? total;
  const filtered = Boolean(q || status || unit);

  return (
    <>
      <PageHeader
        title={isHr ? "Employees" : "My team"}
        subtitle={
          isHr
            ? "Every person on the books. Records are dated, so nothing is overwritten when something changes."
            : "The people who report to you."
        }
        actions={
          isHr ? (
            <>
              {can(session, "reports.view") ? (
                <ButtonAnchor
                  href={`/api/export/employees?${new URLSearchParams({ q, status, unit }).toString()}`}
                  download
                  variant="ghost"
                >
                  <Download />
                  Export CSV
                </ButtonAnchor>
              ) : null}
              {can(session, "employee.edit") ? (
                <>
                  <ButtonLink href="/core-hr/mass-update">
                    <Layers />
                    Mass update
                  </ButtonLink>
                  {can(session, "pay.view") ? (
                    <ButtonLink href="/core-hr/hire" variant="primary">
                      <UserPlus />
                      Hire employee
                    </ButtonLink>
                  ) : null}
                </>
              ) : null}
            </>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <form className="p-5">
          <FormGrid columns={3}>
            <Field label="Search" htmlFor="q">
              <Input
                id="q"
                name="q"
                defaultValue={q}
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
            {filtered ? (
              <Link
                href="/core-hr"
                className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink"
              >
                Clear
              </Link>
            ) : null}
            <span className="tabular ml-auto text-[13px] text-muted">
              {total} of {overall}
            </span>
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={
              overall === 0
                ? isHr
                  ? "No employees yet"
                  : "Nobody reports to you yet"
                : "Nothing matches those filters"
            }
            action={
              overall === 0 && isHr ? (
                <ButtonLink href="/core-hr/hire" variant="primary">
                  <UserPlus />
                  Hire employee
                </ButtonLink>
              ) : undefined
            }
          >
            {overall === 0
              ? isHr
                ? "Run a hire action to create the first employee record."
                : "People appear here once their position reports to yours."
              : "Try a broader search, or clear the filters."}
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Position</Th>
                  <Th>Department</Th>
                  <Th>Joined</Th>
                  {seesPay ? <Th numeric>Basic pay</Th> : null}
                  <Th>Status</Th>
                  {isHr ? (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      {isHr ? (
                        <Link href={`/core-hr/${e.id}`} className="hover:underline">
                          <TwoLine value={fullName(e)} sub={e.employee_number} />
                        </Link>
                      ) : (
                        <TwoLine value={fullName(e)} sub={e.employee_number} />
                      )}
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
                      <span className="tabular text-secondary">{formatDate(e.hire_date)}</span>
                    </Td>
                    {seesPay ? (
                      <Td numeric>
                        {e.amount_paise !== null ? (
                          formatINR(e.amount_paise)
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                    ) : null}
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
                    {isHr ? (
                      <Td className="text-right whitespace-nowrap">
                        <Link
                          href={`/core-hr/${e.id}`}
                          className="text-[13px] font-medium text-ink hover:underline"
                        >
                          Open
                        </Link>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={page}
              total={total}
              path="/core-hr"
              params={{ q, status, unit }}
              noun="employees"
            />
          </>
        )}
      </Card>
    </>
  );
}
