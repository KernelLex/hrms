import Link from "next/link";
import { Plus } from "lucide-react";
import { listRoles } from "@/lib/repositories/access";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { Badge, ButtonLink, Card, CardHeader, Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/**
 * Every role: what it can do, where, and who holds it. The three built-in
 * roles ship with the product; HR adds more — a recruiter who sees
 * candidates but no pay, an auditor who can read but not change.
 */
export default async function RolesPage() {
  const roles = await listRoles();

  return (
    <Card>
      <CardHeader
        title="Roles"
        description="A role is a set of permissions, optionally limited to some companies or personnel areas."
        actions={
          <ButtonLink href="/admin/roles/new" variant="primary" size="sm">
            <Plus />
            New role
          </ButtonLink>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>Role</Th>
            <Th numeric>Permissions</Th>
            <Th>Covers</Th>
            <Th>Held by</Th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <Tr key={r.code}>
              <Td>
                <Link href={`/admin/roles/${r.code}`} className="hover:underline">
                  <TwoLine
                    value={
                      <span className="inline-flex items-center gap-2">
                        {r.name}
                        {r.isBuiltIn ? <Badge>Built in</Badge> : null}
                      </span>
                    }
                    sub={r.description ?? r.code}
                  />
                </Link>
              </Td>
              <Td numeric>
                {r.permissions.length} of {ALL_PERMISSIONS.length}
              </Td>
              <Td>
                <span className="text-secondary">
                  {r.companies.length + r.areas.length === 0
                    ? "The whole organisation"
                    : [...r.companies, ...r.areas].join(", ")}
                </span>
              </Td>
              <Td>
                <span className="text-secondary">
                  {r.members.length === 0
                    ? "Nobody yet"
                    : r.members.length <= 2
                      ? r.members.map((m) => m.displayName).join(", ")
                      : `${r.members[0].displayName} and ${r.members.length - 1} more`}
                </span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
