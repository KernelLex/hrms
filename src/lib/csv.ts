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

/**
 * Reads a spreadsheet's own CSV back: a header row naming each column, then
 * one row per record, quoted fields honoured (a comma or a newline inside
 * "quotes"), a doubled quote as an escaped one. Blank lines are skipped, so a
 * trailing newline never becomes a phantom last row.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < body.length) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      endField();
      i += 1;
    } else if (c === "\n") {
      endRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? "").trim()])));
}
