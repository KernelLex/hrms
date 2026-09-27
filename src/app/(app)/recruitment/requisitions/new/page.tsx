import { requirePage } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { RequisitionForm } from "../../forms";
import { requisitionChoices, valuesOf } from "../choices";

/** Opening a requisition. */
export default async function NewRequisitionPage() {
  await requirePage(["recruitment.manage"], "/");
  const { positions, employees } = await requisitionChoices(null);
  return (
    <>
      <PageHeader
        back={{ href: "/recruitment/requisitions", label: "Requisitions" }}
        title="Open a requisition"
        subtitle="Choose the vacant position, then describe the role the way candidates should read it."
      />
      <div className="max-w-[860px]">
        <RequisitionForm values={valuesOf(null)} positions={positions} employees={employees} />
      </div>
    </>
  );
}
