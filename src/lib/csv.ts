/**
 * CSV for downloads that open in a spreadsheet.
 *
 * A cell beginning = + - or @ is run as a formula when the file is opened, so
 * text cells that start that way are prefixed with an apostrophe (OWASP's
 * advice for CSV injection). Amounts are written as plain numbers and are not
 * touched, so a negative figure stays a number.
 */

export type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Cell[][]): string {
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Paise as a rupee figure with two decimals, by integer arithmetic. */
export function rupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function csvResponse(csv: string, fileName: string): Response {
  // A byte-order mark so Excel reads the ₹ sign and Indian names correctly.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
