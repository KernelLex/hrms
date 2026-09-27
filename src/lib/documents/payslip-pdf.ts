import "server-only";
import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { formatDate } from "@/lib/dates";
import type { PayslipData, PayslipLine } from "@/lib/repositories/payslips";

/**
 * A payslip as a PDF: the same content as the payslip page (both read
 * `getPayslip`), laid out to the printed-document pattern of HANDOVER.md
 * §8.11 — ink only, hairline rules, amounts right-aligned, totals in bold.
 * One A4 page.
 *
 * Drawn directly rather than printed from the page by a headless browser
 * (the plan's first choice): a browser is too heavy to start inside a
 * serverless job that makes one PDF per employee, and protecting the file
 * needs a PDF library anyway. With a password it is encrypted with AES-256,
 * which every current PDF reader opens.
 *
 * The standard PDF fonts cannot draw ₹, so amounts are plain numbers under
 * a note that they are in rupees, as printed payslips often do.
 */

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.9, 0.9, 0.9);
const SOFT = rgb(0.96, 0.96, 0.96);

const NUMBER = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (paise: number) => NUMBER.format(paise / 100);

/** Only what the standard fonts can draw; anything else becomes its nearest plain form. */
function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E·]/g, "?");
}

type Fonts = { regular: PDFFont; bold: PDFFont };

class Writer {
  y = H - M;
  constructor(
    readonly page: PDFPage,
    readonly f: Fonts,
  ) {}
  text(t: string, x: number, size: number, opts: { bold?: boolean; color?: typeof INK; right?: number } = {}) {
    const font = opts.bold ? this.f.bold : this.f.regular;
    const s = plain(t);
    const at = opts.right !== undefined ? opts.right - font.widthOfTextAtSize(s, size) : x;
    this.page.drawText(s, { x: at, y: this.y, size, font, color: opts.color ?? INK });
  }
  rule(thickness = 0.75, color = LINE) {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness, color });
  }
  down(points: number) {
    this.y -= points;
  }
  /** Wraps a sentence to the page width, returning the lines. */
  wrap(t: string, size: number, width = W - 2 * M): string[] {
    const words = plain(t).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (this.f.regular.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
}

function table(w: Writer, title: string, rows: { name: string; month: number | null; ytd: number }[], total: { label: string; month: number; ytd: number }) {
  const right = W - M;
  const ytdRight = right;
  const monthRight = right - 110;
  w.text(title, M, 9, { color: MUTED });
  w.text("This month", 0, 9, { color: MUTED, right: monthRight });
  w.text("Year to date", 0, 9, { color: MUTED, right: ytdRight });
  w.down(7);
  w.rule();
  if (rows.length === 0) {
    w.down(15);
    w.text("None", M, 10, { color: MUTED });
    w.text(amount(0), 0, 10, { color: MUTED, right: monthRight });
    w.text(amount(0), 0, 10, { color: MUTED, right: ytdRight });
    w.down(8);
  }
  for (const r of rows) {
    w.down(15);
    w.text(r.name, M, 10);
    w.text(r.month === null ? "-" : amount(r.month), 0, 10, { right: monthRight, color: r.month === null ? MUTED : INK });
    w.text(amount(r.ytd), 0, 10, { right: ytdRight, color: MUTED });
    w.down(7);
    w.page.drawLine({ start: { x: M, y: w.y }, end: { x: right, y: w.y }, thickness: 0.5, color: SOFT });
  }
  w.down(2);
  w.rule();
  w.down(15);
  w.text(total.label, M, 10, { bold: true });
  w.text(amount(total.month), 0, 10, { bold: true, right: monthRight });
  w.text(amount(total.ytd), 0, 10, { bold: true, right: ytdRight });
  w.down(26);
}

/** The rows for one kind: this month's lines, and any earlier this year that are not on it. */
function rowsFor(p: PayslipData, kind: string) {
  const month = new Map(p.lines.filter((l) => l.kind === kind && l.amountPaise !== 0).map((l) => [l.wageTypeCode, l]));
  const ytd = new Map(p.ytd.lines.filter((l) => l.kind === kind && l.amountPaise !== 0).map((l) => [l.wageTypeCode, l]));
  const codes = [...month.keys(), ...[...ytd.keys()].filter((c) => !month.has(c))];
  return codes.map((c) => {
    const line = (month.get(c) ?? ytd.get(c)) as PayslipLine;
    return { name: line.wageTypeName, month: month.get(c)?.amountPaise ?? null, ytd: ytd.get(c)?.amountPaise ?? 0 };
  });
}

export async function renderPayslipPdf(p: PayslipData, opts: { password?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = `${p.offCycleReason ? "Off-cycle payslip" : "Payslip"}, ${p.periodLabel}, ${p.employeeName}`;
  doc.setTitle(plain(title));
  doc.setAuthor(plain(p.employer.name));
  doc.setCreator("HRMS");
  doc.setProducer("HRMS");
  const page = doc.addPage([W, H]);
  const w = new Writer(page, {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  });

  // Letterhead.
  w.text(p.employer.name, M, 13, { bold: true });
  w.text(p.offCycleReason ? "Off-cycle payslip" : "Payslip", 0, 13, { bold: true, right: W - M });
  w.down(15);
  if (p.employer.address) w.text(p.employer.address, M, 9, { color: MUTED });
  w.text(p.offCycleReason ? `${p.offCycleReason}, ${p.periodLabel}` : p.periodLabel, 0, 9, { color: MUTED, right: W - M });
  w.down(14);
  w.rule();
  w.down(20);

  // Who it is for.
  const details: [string, string][] = [
    ["Employee", p.employeeName],
    ["Employee number", p.employeeNumber],
    ["Position", p.position ?? "-"],
    ["Pay date", p.payDate ? formatDate(p.payDate) : "-"],
  ];
  const col = (W - 2 * M) / 4;
  details.forEach(([label], i) => w.text(label, M + i * col, 8.5, { color: MUTED }));
  w.down(13);
  details.forEach(([, value], i) => w.text(value.length > 26 ? `${value.slice(0, 25)}...` : value, M + i * col, 10));
  w.down(24);

  const notes: string[] = [];
  if (!p.offCycleReason && p.employedDays > 0 && p.employedDays < p.workingDays) {
    notes.push(
      `${p.joinedOn ? `Joined on ${formatDate(p.joinedOn)}` : `Left on ${formatDate(p.leftOn)}`}, so this period pays ${p.employedDays} of its ${p.workingDays} working days.`,
    );
  }
  if (!p.offCycleReason && p.unpaidDays > 0) {
    notes.push(`${p.unpaidDays} of ${p.workingDays} working days were unpaid this period, so basic pay and the allowances derived from it are prorated.`);
  }
  for (const n of notes) {
    const lines = w.wrap(n, 9.5, W - 2 * M - 24);
    const h = lines.length * 13 + 14;
    page.drawRectangle({ x: M, y: w.y - h + 11, width: W - 2 * M, height: h, color: SOFT });
    for (const l of lines) {
      w.text(l, M + 12, 9.5);
      w.down(13);
    }
    w.down(14);
  }

  table(w, "Earnings", rowsFor(p, "Earning"), { label: "Gross pay", month: p.grossPaise, ytd: p.ytd.grossPaise });
  table(w, "Deductions", rowsFor(p, "Deduction"), { label: "Total deductions", month: p.deductionsPaise, ytd: p.ytd.deductionsPaise });

  // Net.
  w.rule(1.5, INK);
  w.down(24);
  w.text("Net pay", M, 12, { bold: true });
  w.text(amount(p.netPaise), 0, 20, { bold: true, right: W - M });
  w.down(16);
  w.text(`Year to date, ${p.financialYear}: ${amount(p.ytd.netPaise)} over ${p.ytd.payslips} payslip${p.ytd.payslips === 1 ? "" : "s"}`, 0, 9, {
    color: MUTED,
    right: W - M,
  });

  // Footer.
  w.y = M + 12;
  w.text("Amounts in Indian rupees. Computer generated, valid without a signature.", M, 8.5, { color: MUTED });

  if (opts.password) {
    doc.encrypt({
      userPassword: opts.password,
      // Nobody holds this, so nobody can lift the protections below.
      ownerPassword: randomBytes(24).toString("hex"),
      permissions: { printing: "highResolution", modifying: false, copying: true, annotating: false },
    });
  }
  return doc.save();
}

/** "payslip-2026-09-EMP1001.pdf". */
export const payslipFileName = (p: Pick<PayslipData, "year" | "month" | "employeeNumber" | "offCycleReason" | "runId">) =>
  `payslip-${p.year}-${String(p.month).padStart(2, "0")}-${p.employeeNumber}${p.offCycleReason ? `-off-cycle-${p.runId}` : ""}.pdf`;
