// The sheet of QR labels that gets printed and stuck on the equipment (FR-AST-01).
//
// Pure, and built on the dependency-free PDF writer Phase 5 wrote for payslips: the QR modules are
// drawn as filled rectangles, and the caption underneath is set in the same Roboto subset, so
// "Máy quay Sony FX6" prints with its diacritics and stays selectable in a PDF reader.
//
// The sheet is laid out for ordinary A4 label stock, three across and eight down. Every label is
// encoded at the *same* QR version whatever it says, so all the squares on a page come out the
// same size — a sheet of subtly different squares looks like a mistake and prints like one.
import { type ParsedFont, truncateToWidth } from "@/modules/platform/pdf/font";
import { A4, Page, type PageSize, renderPdf } from "@/modules/platform/pdf/writer";
import { encodeQr, type QrMatrix, smallestVersion } from "./engine/qr";

export type LabelRow = {
  /** What the label says in words: SZM-LAP-0007. */
  code: string;
  name: string;
  /** What a scanner will be sent to. */
  url: string;
  entityName: string | null;
};

export type LabelSheetLabels = { title: string; footer: string; scanHint: string };

export type LabelSheetInput = {
  rows: readonly LabelRow[];
  labels: LabelSheetLabels;
  font: ParsedFont;
  createdAt?: Date;
  size?: PageSize;
};

const MARGIN = 28;
const COLUMNS = 3;
const ROWS = 8;
const GUTTER = 8;
const QUIET = 2; // quiet-zone modules; the label's own white border does the rest of the work

/** The one version every label on the sheet is drawn at: the largest any of them needs. */
export function sheetVersion(rows: readonly LabelRow[]): number {
  const longest = rows.reduce((most, row) => Math.max(most, new TextEncoder().encode(row.url).length), 1);
  const version = smallestVersion(longest);
  if (version === null) throw new Error("asset_label_url_too_long");
  return version;
}

/** Draws one symbol into a square of `side` points with its top-left corner at (x, y-side). */
function drawMatrix(page: Page, matrix: QrMatrix, x: number, bottom: number, side: number): void {
  const modules = matrix.size + QUIET * 2;
  const unit = side / modules;
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.modules[row][col]) continue;
      // Rows run downwards; the page's y runs up from the bottom.
      const left = x + (col + QUIET) * unit;
      const top = bottom + side - (row + QUIET) * unit;
      // A hair of overlap, so neighbouring modules do not show a seam at print resolution.
      page.rectangle(left, top - unit, unit + 0.12, unit + 0.12, 0);
    }
  }
}

/** The printable sheet: one page per twenty-four labels. */
export function renderLabelSheetPdf(input: LabelSheetInput): Uint8Array {
  const size = input.size ?? A4;
  const { font, labels } = input;
  if (input.rows.length === 0) throw new Error("asset_label_sheet_empty");
  const version = sheetVersion(input.rows);

  const usableWidth = size.width - MARGIN * 2;
  const cellWidth = (usableWidth - GUTTER * (COLUMNS - 1)) / COLUMNS;
  const headerHeight = 30;
  const footerHeight = 18;
  const usableHeight = size.height - MARGIN * 2 - headerHeight - footerHeight;
  const cellHeight = (usableHeight - GUTTER * (ROWS - 1)) / ROWS;
  const qrSide = Math.min(cellHeight - 20, cellWidth - 64);

  const perPage = COLUMNS * ROWS;
  const pages: Page[] = [];
  for (let start = 0; start < input.rows.length; start += perPage) {
    const page = new Page(size, font);
    const slice = input.rows.slice(start, start + perPage);
    page.text(labels.title, MARGIN, size.height - MARGIN - 10, { size: 12, bold: true });
    page.text(labels.scanHint, MARGIN, size.height - MARGIN - 23, { size: 8, grey: 0.45 });

    slice.forEach((row, index) => {
      const column = index % COLUMNS;
      const line = Math.floor(index / COLUMNS);
      const left = MARGIN + column * (cellWidth + GUTTER);
      const top = size.height - MARGIN - headerHeight - line * (cellHeight + GUTTER);
      const bottom = top - cellHeight;

      // The cut line, so whoever wields the scissors can see where the label ends.
      page.rectangle(left, bottom, cellWidth, cellHeight, 1);
      page.line(left, bottom, left + cellWidth, bottom, 0.85);
      page.line(left, top, left + cellWidth, top, 0.85);
      page.line(left, bottom, left, top, 0.85);
      page.line(left + cellWidth, bottom, left + cellWidth, top, 0.85);

      const qrBottom = bottom + (cellHeight - qrSide) / 2;
      drawMatrix(page, encodeQr(row.url, { version }), left + 6, qrBottom, qrSide);

      const textLeft = left + 6 + qrSide + 8;
      const textWidth = cellWidth - (textLeft - left) - 6;
      page.text(truncateToWidth(font, row.code, 9, textWidth), textLeft, top - cellHeight / 2 + 4, { size: 9, bold: true });
      page.text(truncateToWidth(font, row.name, 7.5, textWidth), textLeft, top - cellHeight / 2 - 6, { size: 7.5, grey: 0.3 });
      if (row.entityName) page.text(truncateToWidth(font, row.entityName, 6.5, textWidth), textLeft, top - cellHeight / 2 - 15, { size: 6.5, grey: 0.55 });
    });

    page.text(labels.footer, MARGIN, MARGIN, { size: 7, grey: 0.5 });
    pages.push(page);
  }

  return renderPdf(pages, font, { title: labels.title, subject: labels.title, createdAt: input.createdAt });
}

/**
 * The same symbol as an inline SVG, for a screen. One `<path>` of rectangles rather than a
 * thousand elements, so a register of fifty assets does not choke the page.
 */
export function qrSvg(text: string, options: { size?: number; quietZone?: number } = {}): string {
  const matrix = encodeQr(text);
  const quiet = options.quietZone ?? 2;
  const modules = matrix.size + quiet * 2;
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.modules[row][col]) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }
  const side = options.size ?? 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules} ${modules}" width="${side}" height="${side}" shape-rendering="crispEdges" role="img"><rect width="${modules}" height="${modules}" fill="#fff"/><path d="${parts.join("")}" fill="#000"/></svg>`;
}
