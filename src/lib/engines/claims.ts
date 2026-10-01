import "server-only";
import type { InStatement } from "@libsql/client";
import { now } from "@/db/schema";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";

/**
 * Paying a claim: queued as one one-off payment, on the wage type its
 * category's taxability picks — the one step a decision made inside HRMS
 * and a claim arriving already approved from the ERP both take. Kept apart
 * from `services/claims.ts`, which calls the workflow engine, so that
 * `workflow/claim.ts` can call this without the import cycle that would
 * make — the same separation `engines/loans.ts` keeps from `services/loans.ts`.
 */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };

export async function queueClaimPayment(
  tx: Executor,
  logActor: LogActor,
  opts: { claimId: number; employeeId: number; categoryCode: string; totalAmountPaise: number; paymentDate: string },
): Promise<{ wageTypeCode: string; additionalPaymentId: number }> {
  const cat = await tx.execute({ sql: "SELECT is_taxable FROM py_claim_category WHERE code = ?", args: [opts.categoryCode] });
  const isTaxable = cat.rows[0] ? Number((cat.rows[0] as Record<string, unknown>).is_taxable) === 1 : true;
  const wageTypeCode = isTaxable ? "CLAIM" : "REIMB";
  const inserted = await tx.execute({
    sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [opts.employeeId, wageTypeCode, opts.totalAmountPaise, opts.paymentDate, now()],
  });
  const additionalPaymentId = Number((inserted.rows[0] as Record<string, unknown>).id);
  await tx.execute({ sql: "UPDATE py_claim SET additional_payment_id = ? WHERE id = ?", args: [additionalPaymentId, opts.claimId] });
  const logged = changeStatement(logActor, {
    entity: "py_it0015_additional_payment",
    entityId: additionalPaymentId,
    subjectEmployeeId: opts.employeeId,
    action: "create",
    after: { employeeId: opts.employeeId, wageTypeCode, amountPaise: opts.totalAmountPaise, paymentDate: opts.paymentDate },
    reason: `Claim #${opts.claimId}`,
  });
  if (logged) await tx.execute(logged);
  return { wageTypeCode, additionalPaymentId };
}
