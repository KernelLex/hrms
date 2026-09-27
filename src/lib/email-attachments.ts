import "server-only";
import type { AttachmentSpec } from "@/lib/email";
import { getPayslip } from "@/lib/repositories/payslips";
import { renderPayslipPdf } from "@/lib/documents/payslip-pdf";
import { payslipPassword } from "@/lib/payslip-password";

/**
 * Makes an email's attachment from its description, when the message is
 * sent (once a provider is connected) or opened on the Outbox screen.
 */
export async function renderAttachment(
  spec: AttachmentSpec,
): Promise<{ bytes: Uint8Array; contentType: string; employeeId: number } | null> {
  if (spec.type === "payslip") {
    const p = await getPayslip(spec.resultId);
    if (!p) return null;
    const bytes = await renderPayslipPdf(p, spec.protected ? { password: payslipPassword(p) } : {});
    return { bytes, contentType: "application/pdf", employeeId: p.employeeId };
  }
  return null;
}
