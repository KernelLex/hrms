import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listImports, IMPORT_LABELS } from "@/lib/services/imports";
import { formatTimestamp } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader, Status, Table, Th, Tr, Td, TwoLine, type Tone } from "@/components/ui";

const STATUS_TONE: Record<string, Tone> = {
  Validating: "waiting",
  Validated: "waiting",
  Importing: "action",
  Completed: "done",
  Failed: "problem",
};

export default async function ImportsPage() {
  await requirePage(["org.view"], "/");
  const imports = await listImports(50);

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="Load positions, employees or opening balances from a spreadsheet. Nothing is written until you confirm what the dry run found."
        actions={
          <ButtonLink href="/org/imports/new" variant="primary">
            <UploadCloud /> New import
          </ButtonLink>
        }
      />
      <Card>
        {imports.length === 0 ? (
          <EmptyState icon={<UploadCloud />} title="Nothing imported yet">
            Start one to load your organisation&apos;s data in bulk.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th numeric>Rows</Th>
                <Th>Status</Th>
                <Th>Uploaded</Th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <Link href={`/org/imports/${i.id}`} className="hover:underline">
                      <TwoLine value={i.fileName ?? `Import #${i.id}`} sub={IMPORT_LABELS[i.kind].label} />
                    </Link>
                  </Td>
                  <Td numeric>
                    <span className="tabular text-secondary">{i.totalRows}</span>
                  </Td>
                  <Td>
                    <Status tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Status>
                  </Td>
                  <Td>
                    <TwoLine value={formatTimestamp(i.uploadedAt)} sub={i.uploadedBy} />
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
