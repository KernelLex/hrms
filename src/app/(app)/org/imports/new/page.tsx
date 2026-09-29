import { requirePage } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { IMPORT_KINDS, IMPORT_LABELS, columnsFor } from "@/lib/services/imports";
import { ImportWizard } from "./wizard";

export default async function NewImportPage() {
  await requirePage(["org.view"], "/");

  const kinds = IMPORT_KINDS.map((kind) => ({
    kind,
    ...IMPORT_LABELS[kind],
    columns: columnsFor(kind),
  }));

  return (
    <>
      <PageHeader
        title="New import"
        subtitle="Choose what you are loading, fill in the template, and upload it. Every row is checked before anything is written."
      />
      <ImportWizard kinds={kinds} />
    </>
  );
}
