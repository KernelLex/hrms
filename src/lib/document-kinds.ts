/** What HR keeps on file for a person. */
export const EMPLOYEE_DOCUMENT_KINDS = [
  "Offer letter",
  "Appointment letter",
  "Identity proof",
  "Address proof",
  "Education certificate",
  "Relieving letter",
  "Other",
] as const;

/**
 * What the change log keeps of a document: what it was and whose, never
 * where it is stored. An employee's file is logged against that employee.
 */
export function documentSummary(doc: {
  id: number;
  ownerType: string;
  ownerId: number;
  kind: string;
  fileName: string;
  sizeBytes: number;
}) {
  return {
    id: doc.id,
    ...(doc.ownerType === "employee" ? { employeeId: doc.ownerId } : { candidateId: doc.ownerId }),
    kind: doc.kind,
    fileName: doc.fileName,
    sizeBytes: doc.sizeBytes,
  };
}
