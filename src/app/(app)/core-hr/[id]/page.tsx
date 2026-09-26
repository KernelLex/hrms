import { redirect } from "next/navigation";

export default async function EmployeeIndex(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  redirect(`/core-hr/${id}/0002`);
}
