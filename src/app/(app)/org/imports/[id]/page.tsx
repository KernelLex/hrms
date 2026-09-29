import { notFound } from "next/navigation";
import { FileWarning } from "lucide-react";
import { requirePage } from "@/lib/access";
import { getImport, importRows, IMPORT_LABELS } from "@/lib/services/imports";
import { formatTimestamp } from "@/lib/dates";
import { Badge, Card, EmptyState, Figure, FigureRow, PageHeader, Status, Table, Th, Tr, Td, type Tone } from "@/components/ui";
import { ConfirmImportButton } from "./confirm";
import { ImportProgressWatcher } from "./watch";

const STATUS_TONE: Record<string, Tone> = {
  Validating: "waiting",
  Validated: "waiting",
  Importing: "action",
  Completed: "done",
  Failed: "problem",
};

const OUTCOME_TONE: Record<string, Tone> = { ok: "waiting", written: "done", skipped: "neutral", error: "problem" };

export default async function ImportReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  await requirePage(["org.view"], "/");
  const { id } = await params;
  const found = await getImport(Number(id));
  if (!found) notFound();
  const outcome = (await searchParams).outcome;
  const rows = await importRows(found.id, { outcome, limit: 100 });

  return (
    <>
      <PageHeader
        title={found.fileName ?? `Import #${found.id}`}
        subtitle={`${IMPORT_LABELS[found.kind].label} · uploaded by ${found.uploadedBy}, ${formatTimestamp(found.uploadedAt)}`}
        actions={
          <div className="flex items-center gap-3">
            <Status tone={STATUS_TONE[found.status] ?? "neutral"}>{found.status}</Status>
            {found.status === "Validated" ? <ConfirmImportButton id={found.id} /> : null}
          </div>
        }
      />

      {found.status === "Importing" ? <ImportProgressWatcher id={found.id} /> : null}

      <FigureRow>
        <Figure label="Rows" value={found.totalRows} />
        <Figure label="Written" value={found.writtenRows} href={`/org/imports/${found.id}?outcome=written`} />
        <Figure label="Already on record" value={found.skippedRows} href={`/org/imports/${found.id}?outcome=skipped`} />
        <Figure label="Could not be read" value={found.errorRows} problem={found.errorRows > 0} href={`/org/imports/${found.id}?outcome=error`} />
      </FigureRow>

      <div className="mt-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<FileWarning />} title="Nothing here">
              {outcome ? `No row is "${outcome}".` : "That file had no rows."}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Key</Th>
                  <Th>Outcome</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.rowNumber}>
                    <Td>
                      <span className="tabular text-secondary">{r.rowNumber}</span>
                    </Td>
                    <Td>{r.key ?? "—"}</Td>
                    <Td>
                      <Badge tone={OUTCOME_TONE[r.outcome] ?? "neutral"}>{r.outcome}</Badge>
                    </Td>
                    <Td className="max-w-md">
                      <span className="text-[13px] text-muted">{r.messages.join(" ")}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
