import { notFound } from "next/navigation";
import { requirePage } from "@/lib/access";
import { getRequisition } from "@/lib/repositories/recruitment";
import { PageHeader } from "@/components/ui";
import { RequisitionForm } from "../../../forms";
import { requisitionChoices, valuesOf } from "../../choices";

/** Changing a requisition. */
export default async function EditRequisitionPage(props: { params: Promise<{ code: string }> }) {
  await requirePage(["recruitment.manage"], "/");
  const requisition = await getRequisition((await props.params).code);
  if (!requisition) notFound();
  const { positions, employees } = await requisitionChoices(requisition.positionCode);
  return (
    <>
      <PageHeader back={{ href: `/recruitment/requisitions/${requisition.code}`, label: requisition.title }} title={`Change ${requisition.code}`} />
      <div className="max-w-[860px]">
        <RequisitionForm values={valuesOf(requisition)} positions={positions} employees={employees} />
      </div>
    </>
  );
}
