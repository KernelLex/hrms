import { documentsFor } from "@/lib/storage";
import { Card, CardHeader } from "@/components/ui";
import { DocumentList } from "@/components/documents";

/**
 * The files HR keeps for a person: offer and appointment letters, identity
 * and address proofs. The employee downloads their own from their profile.
 * HR-only here, like the rest of the employee record (the layout checks).
 */
export default async function EmployeeDocumentsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const employeeId = Number(id);
  const documents = await documentsFor("employee", [employeeId]);

  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Kept in document storage and registered one by one. Each download is recorded in the access log."
      />
      <DocumentList employeeId={employeeId} documents={documents} canManage />
    </Card>
  );
}
