import { requirePage } from "@/lib/access";
import { listOwnership } from "@/lib/services/integration";
import { OWNERSHIP_DEFAULTS } from "@/lib/api/ownership-defaults";
import { Card, CardHeader, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import { OwnerSelect } from "../forms";

const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  work_email: "Work email",
  cost_centre: "Cost centre",
};

/**
 * Who owns each kind of record. Only the owner writes it: the other side
 * reads it, and its writes are refused. An employee's fields can be given to
 * the ERP one at a time.
 */
export default async function OwnershipPage() {
  await requirePage(["integrations.manage"], "/admin");
  const current = await listOwnership();
  const ownerOf = (type: string, field = "") => current.find((o) => o.recordType === type && o.field === field)?.owner;

  return (
    <Card>
      <CardHeader
        title="Who owns what"
        description="The ERP may write only what it owns; the HRMS never writes what the ERP owns. A change applies to the next write."
      />
      <Table>
        <thead>
          <tr>
            <Th>Record</Th>
            <Th>
              <span className="sr-only">Owner</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {OWNERSHIP_DEFAULTS.flatMap((o) => [
            <Tr key={o.recordType}>
              <Td>
                <TwoLine value={o.label} sub={`Default: ${o.owner === "erp" ? "the ERP" : "the HRMS"}`} />
              </Td>
              <Td className="text-right">
                <OwnerSelect recordType={o.recordType} field="" owner={ownerOf(o.recordType) ?? o.owner} allowInherit={false} label={o.label} />
              </Td>
            </Tr>,
            ...(o.fields ?? []).map((f) => (
              <Tr key={`${o.recordType}.${f}`}>
                <Td>
                  <span className="pl-4 text-secondary">{FIELD_LABELS[f] ?? f}</span>
                </Td>
                <Td className="text-right">
                  <OwnerSelect
                    recordType={o.recordType}
                    field={f}
                    owner={ownerOf(o.recordType, f) ?? "inherit"}
                    allowInherit
                    label={FIELD_LABELS[f] ?? f}
                  />
                </Td>
              </Tr>
            )),
          ])}
        </tbody>
      </Table>
    </Card>
  );
}
