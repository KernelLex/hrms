import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { formatDate } from "@/lib/dates";

/**
 * A letter as a PDF: a plain letterhead, the merged text as paragraphs, on
 * as many A4 pages as it needs. The same drawing approach as the payslip
 * (`documents/payslip-pdf.ts`) — pdf-lib, not a printed page — for the same
 * reason: no browser to start inside a serverless job.
 */

const W = 595.28;
const H = 841.89;
const M = 56;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.9, 0.9, 0.9);

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
  page: PDFPage;
  y: number;
  private pageNumber = 1;

  constructor(
    private readonly doc: PDFDocument,
    private readonly f: Fonts,
    private readonly header: { employer: string; issueDate: string },
  ) {
    this.page = doc.addPage([W, H]);
    this.y = H - M;
    this.drawHeader();
  }

  private drawHeader() {
    this.page.drawText(plain(this.header.employer), { x: M, y: this.y, size: 13, font: this.f.bold, color: INK });
    const date = plain(formatDate(this.header.issueDate));
    this.page.drawText(date, { x: W - M - this.f.regular.widthOfTextAtSize(date, 9), y: this.y + 2, size: 9, font: this.f.regular, color: MUTED });
    this.y -= 12;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.75, color: LINE });
    this.y -= 28;
  }

  private newPage() {
    this.pageNumber += 1;
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    const label = `page ${this.pageNumber}`;
    this.page.drawText(label, { x: W - M - this.f.regular.widthOfTextAtSize(label, 8), y: M / 2, size: 8, font: this.f.regular, color: MUTED });
  }

  private ensure(height: number) {
    if (this.y - height < M) this.newPage();
  }

  paragraph(text: string, opts: { size?: number; bold?: boolean; gap?: number } = {}) {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.f.bold : this.f.regular;
    const lineHeight = size * 1.5;
    const words = plain(text).split(/\s+/).filter(Boolean);
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > W - 2 * M && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);

    this.ensure(lines.length * lineHeight);
    for (const l of lines) {
      this.page.drawText(l, { x: M, y: this.y, size, font, color: INK });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? size * 0.9;
  }

  space(points: number) {
    this.y -= points;
  }
}

export async function renderLetterPdf(input: { kind: string; employer: string; text: string; issueDate: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(plain(`${input.kind} letter`));
  doc.setAuthor(plain(input.employer));
  doc.setCreator("HRMS");
  doc.setProducer("HRMS");

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, fonts, { employer: input.employer, issueDate: input.issueDate });

  w.paragraph(`${input.kind} letter`, { size: 15, bold: true, gap: 20 });
  const paragraphs = input.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paragraphs) w.paragraph(p, { gap: 14 });

  return doc.save();
}
