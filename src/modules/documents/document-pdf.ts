// A generated document as a PDF (FR-CHR-06), on the dependency-free writer Phase 5 built for
// payslips. Nothing clever: a Vietnamese letterhead, the rendered body wrapped to the page, and a
// signature block. The interesting work — deciding what the body is allowed to say — happened
// long before this file is reached.
import "server-only";
import { A4, Page, type PageSize, renderPdf } from "@/modules/platform/pdf/writer";
import { type ParsedFont, widthOfText } from "@/modules/platform/pdf/font";
import { documentFont } from "@/modules/platform/pdf/load-font";
import type { LetterheadFields } from "./enums";

const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE = 15.5;

/** Breaks a paragraph into lines that fit, measuring the real glyph widths. */
function wrap(font: ParsedFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOfText(font, candidate, size) <= maxWidth || line === "") line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export type DocumentPdfInput = {
  title: string;
  number: string;
  text: string;
  letterhead: LetterheadFields;
  /** "Tài liệu do SuZu One tạo" and the like — the footer of every page. */
  footer: string;
  today: string;
  font?: ParsedFont;
  size?: PageSize;
  createdAt?: Date;
};

export function renderDocumentPdf(input: DocumentPdfInput): Uint8Array {
  const font = input.font ?? documentFont();
  const size = input.size ?? A4;
  const width = size.width - MARGIN * 2;
  const pages: Page[] = [];

  let page = new Page(size, font);
  pages.push(page);
  // The writer's y runs from the bottom; this cursor runs down the page, which reads better.
  let y = size.height - MARGIN;
  const newPage = () => {
    page = new Page(size, font);
    pages.push(page);
    y = size.height - MARGIN;
  };
  const room = (needed: number) => {
    if (y - needed < MARGIN + 40) newPage();
  };
  const at = () => y;

  // ── Letterhead ──
  const head = input.letterhead ?? {};
  if (head.companyName) {
    page.text(head.companyName.toUpperCase(), MARGIN, at(), { size: 12, bold: true });
    y -= 14;
  }
  for (const line of [head.address, [head.taxCode ? `MST: ${head.taxCode}` : "", head.phone ? `ĐT: ${head.phone}` : ""].filter(Boolean).join("   ")].filter(Boolean)) {
    page.text(line as string, MARGIN, at(), { size: 8.5, grey: 0.35 });
    y -= 11;
  }
  y -= 4;
  page.line(MARGIN, at(), size.width - MARGIN, at(), 0.6);
  y -= 22;

  // ── The national heading every Vietnamese document carries ──
  const centre = (value: string, options: { size?: number; bold?: boolean; grey?: number } = {}) => {
    const textWidth = widthOfText(font, value, options.size ?? BODY_SIZE);
    page.text(value, (size.width - textWidth) / 2, at(), options);
  };
  centre("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { size: 10.5, bold: true });
  y -= 14;
  centre("Độc lập – Tự do – Hạnh phúc", { size: 10, bold: true });
  y -= 10;
  const rule = widthOfText(font, "Độc lập – Tự do – Hạnh phúc", 10);
  page.line((size.width - rule) / 2, at(), (size.width + rule) / 2, at(), 0.3);
  y -= 26;

  // ── Title and number ──
  centre(input.title.toUpperCase(), { size: 14, bold: true });
  y -= 18;
  centre(`Số: ${input.number}`, { size: 9, grey: 0.35 });
  y -= 8;
  if (head.place) {
    const [year, month, day] = input.today.split("-");
    page.textRight(`${head.place}, ngày ${day} tháng ${month} năm ${year}`, size.width - MARGIN, at(), { size: 9.5 });
  }
  y -= 24;

  // ── Body ──
  for (const line of wrap(font, input.text, BODY_SIZE, width)) {
    room(LINE);
    if (line !== "") page.text(line, MARGIN, at(), { size: BODY_SIZE });
    y -= LINE;
  }

  // ── Signature block ──
  y -= 24;
  room(90);
  const columnLeft = size.width / 2 + 10;
  page.text(head.representativeTitle ? head.representativeTitle.toUpperCase() : "ĐẠI DIỆN CÔNG TY", columnLeft, at(), { size: 10, bold: true });
  y -= 13;
  page.text("(Ký, ghi rõ họ tên và đóng dấu)", columnLeft, at(), { size: 8, grey: 0.4 });
  y -= 56;
  if (head.representative) page.text(head.representative, columnLeft, at(), { size: 10.5, bold: true });

  // ── Footer on every page ──
  for (const each of pages) each.text(input.footer, MARGIN, MARGIN - 18, { size: 7.5, grey: 0.55 });

  return renderPdf(pages, font, { title: `${input.title} ${input.number}`, subject: input.title, createdAt: input.createdAt });
}
