import "server-only";
import type { AttachmentSpec } from "@/lib/email";
import { getPayslip } from "@/lib/repositories/payslips";
import { renderPayslipPdf } from "@/lib/documents/payslip-pdf";
import { payslipPassword } from "@/lib/payslip-password";
import { renderReportCsv } from "@/lib/reports";

/**
 * Makes an email's attachment from its description, when the message is
 * sent (once a provider is connected) or opened on the Outbox screen.
 */
export async function renderAttachment(
  spec: AttachmentSpec,
): Promise<{ bytes: Uint8Array; contentType: string; employeeId: number | null } | null> {
  if (spec.type === "payslip") {
    const p = await getPayslip(spec.resultId);
    if (!p) return null;
    const bytes = await renderPayslipPdf(p, spec.protected ? { password: payslipPassword(p) } : {});
    return { bytes, contentType: "application/pdf", employeeId: p.employeeId };
  }
  if (spec.type === "report") {
    const rendered = await renderReportCsv(spec.reportName);
    if (!rendered) return null;
    return { bytes: new TextEncoder().encode(`﻿${rendered.csv}`), contentType: "text/csv; charset=utf-8", employeeId: null };
  }
  return null;
}
