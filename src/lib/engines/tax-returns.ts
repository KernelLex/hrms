/**
 * Form 24Q, the quarterly TDS-on-salary return: Annexure I (challan and
 * deductee detail, every quarter) and Annexure II (the salary detail, only
 * in the fourth quarter). Caret-separated text, the field separator NSDL's
 * own Return Preparation Utility uses — a best-effort reading of the
 * published layout's deductee and salary fields, the same spirit as the
 * ECR file: validating an actual file against the government's own
 * utility is phase 25.
 */

const rupeesOf = (paise: number) => (paise / 100).toFixed(2);

export type Annexure1Row = {
  bsrCode: string;
  depositDate: string;
  challanSerial: string;
  employeePan: string | null;
  employeeName: string;
  paymentDate: string;
  amountPaidPaise: number;
  tdsDeductedPaise: number;
};

/** Every quarter: each deductee's payment against the challan that deposited the tax on it. */
export function generate24QAnnexure1(rows: Annexure1Row[]): string {
  return rows
    .map((r) =>
      [r.bsrCode, r.depositDate, r.challanSerial, r.employeePan ?? "", r.employeeName, r.paymentDate, rupeesOf(r.amountPaidPaise), rupeesOf(r.tdsDeductedPaise)].join("^"),
    )
    .join("\r\n");
}

export type Annexure2Row = {
  employeePan: string | null;
  employeeName: string;
  grossSalaryPaise: number;
  section10ExemptPaise: number;
  standardDeductionPaise: number;
  chapterViaPaise: number;
  taxableIncomePaise: number;
  taxOnIncomePaise: number;
  rebate87aPaise: number;
  cessPaise: number;
  totalTaxPaise: number;
  tdsDeductedPaise: number;
};

/** The fourth quarter only: the full annual computation behind each person's Form 16 Part B. */
export function generate24QAnnexure2(rows: Annexure2Row[]): string {
  return rows
    .map((r) =>
      [
        r.employeePan ?? "",
        r.employeeName,
        rupeesOf(r.grossSalaryPaise),
        rupeesOf(r.section10ExemptPaise),
        rupeesOf(r.standardDeductionPaise),
        rupeesOf(r.chapterViaPaise),
        rupeesOf(r.taxableIncomePaise),
        rupeesOf(r.taxOnIncomePaise),
        rupeesOf(r.rebate87aPaise),
        rupeesOf(r.cessPaise),
        rupeesOf(r.totalTaxPaise),
        rupeesOf(r.tdsDeductedPaise),
      ].join("^"),
    )
    .join("\r\n");
}
