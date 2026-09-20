// The cash payment sheet (FR-PAY-39, SRS D18): the sheet the chief accountant prints, carries to
// the people on the Simple pay profile, and has each of them sign as they take their money.
//
// Pure. Two outputs from the same rows:
//   * a **PDF** to print and sign — it has a signature column and a total, because the signed
//     paper is the evidence that the cash left the till;
//   * a **CSV** for the accountant's own books.
//
// Cash totals are deliberately kept apart from bank totals all the way through (FR-PAY-39), so
// nothing here ever adds the two together.
import { type ParsedFont, truncateToWidth, widthOfText } from "@/modules/platform/pdf/font";
import { A4, Page, type PageSize, renderPdf } from "@/modules/platform/pdf/writer";

export type CashSheetRow = {
  personId: string;
  employeeCode: string | null;
  fullName: string;
  /** Integer VND, the net the run computed. */
  amount: number;
  /** Set once the accountant has recorded handing it over. */
  disbursedOn: string | null;
  /** Set once the person confirmed in the app. The paper signature is the other way. */
  receiptConfirmed: boolean;
};

export type CashSheetLabels = {
  title: string;
  entityTaxCode: string;
  month: string;
  columns: { index: string; employeeCode: string; name: string; amount: string; signature: string; date: string };
  total: string;
  headcount: string;
  preparedBy: string;
  receivedBy: string;
  note: string;
};

export type CashSheetInput = {
  rows: readonly CashSheetRow[];
  entity: { legalName: string; taxCode: string | null; address: string | null };
  month: string;
  labels: CashSheetLabels;
  formatMoney: (amount: number) => string;
  font: ParsedFont;
  createdAt?: Date;
  size?: PageSize;
};

const MARGIN = 42;
const SIZE = { title: 13, heading: 9.5, body: 8.5, small: 7.5 };
const ROW_HEIGHT = 22;

export const cashSheetTotal = (rows: readonly CashSheetRow[]): number => rows.reduce((total, row) => total + row.amount, 0);

/** The signing sheet, one or more A4 pages with a signature column. */
export function renderCashSheetPdf(input: CashSheetInput): Uint8Array {
  const { labels, formatMoney, font } = input;
  const size = input.size ?? A4;
  const total = cashSheetTotal(input.rows);

  // Columns: №, code, name, amount, signature, date. The signature column is the widest thing on
  // the page that has nothing printed in it.
  const left = MARGIN;
  const right = size.width - MARGIN;
  const columns = { index: left + 4, code: left + 26, name: left + 86, amount: left + 292, signature: left + 300, date: right - 66 };

  const pages: Page[] = [];
  let page = new Page(size, font);
  let y = 0;

  const startPage = (first: boolean) => {
    page = new Page(size, font);
    pages.push(page);
    y = size.height - MARGIN;

    if (first) {
      page.text(truncateToWidth(font, input.entity.legalName, SIZE.heading, 300), left, y, { size: SIZE.heading, bold: true });
      y -= 12;
      if (input.entity.address) {
        page.text(truncateToWidth(font, input.entity.address, SIZE.small, 300), left, y, { size: SIZE.small, grey: 0.35 });
        y -= 10;
      }
      if (input.entity.taxCode) {
        page.text(`${labels.entityTaxCode}: ${input.entity.taxCode}`, left, y, { size: SIZE.small, grey: 0.35 });
        y -= 10;
      }
      y -= 8;
      const title = labels.title;
      page.text(title, (size.width - widthOfText(font, title, SIZE.title)) / 2, y, { size: SIZE.title, bold: true });
      y -= 14;
      const month = `${labels.month} ${input.month}`;
      page.text(month, (size.width - widthOfText(font, month, SIZE.body)) / 2, y, { size: SIZE.body, grey: 0.35 });
      y -= 22;
    }

    // The header row repeats on every page: a sheet of signatures is carried around loose.
    page.rectangle(left, y - 5, right - left, 16, 0.92);
    page.text(labels.columns.index, columns.index, y, { size: SIZE.small, grey: 0.3 });
    page.text(labels.columns.employeeCode, columns.code, y, { size: SIZE.small, grey: 0.3 });
    page.text(labels.columns.name, columns.name, y, { size: SIZE.small, grey: 0.3 });
    page.textRight(labels.columns.amount, columns.amount, y, { size: SIZE.small, grey: 0.3 });
    page.text(labels.columns.signature, columns.signature, y, { size: SIZE.small, grey: 0.3 });
    page.text(labels.columns.date, columns.date, y, { size: SIZE.small, grey: 0.3 });
    y -= 16;
  };

  startPage(true);

  input.rows.forEach((row, index) => {
    // Leave room for the total and the two signature blocks at the foot.
    if (y < MARGIN + 110) startPage(false);
    page.text(String(index + 1), columns.index, y, { size: SIZE.body, grey: 0.4 });
    page.text(row.employeeCode ?? "—", columns.code, y, { size: SIZE.body, grey: 0.4 });
    page.text(truncateToWidth(font, row.fullName, SIZE.body, columns.amount - columns.name - 60), columns.name, y, { size: SIZE.body });
    page.textRight(formatMoney(row.amount), columns.amount, y, { size: SIZE.body });
    // The line each person signs on.
    page.line(columns.signature, y - 4, columns.date - 10, y - 4, 0.75);
    page.line(columns.date, y - 4, right - 4, y - 4, 0.75);
    if (row.disbursedOn) page.text(row.disbursedOn, columns.date, y, { size: SIZE.small, grey: 0.45 });
    y -= ROW_HEIGHT;
  });

  // ── The total, then room for the two people who answer for the money ──
  y -= 4;
  page.line(left, y + 12, right, y + 12, 0.6);
  page.text(`${labels.total} (${input.rows.length} ${labels.headcount})`, columns.name, y, { size: SIZE.body, bold: true });
  page.textRight(formatMoney(total), columns.amount, y, { size: SIZE.body, bold: true });
  y -= 34;

  page.text(labels.preparedBy, left + 30, y, { size: SIZE.body, grey: 0.4 });
  page.text(labels.receivedBy, right - 190, y, { size: SIZE.body, grey: 0.4 });
  y -= 12;
  page.text(truncateToWidth(font, labels.note, SIZE.small, right - left), left, MARGIN - 6, { size: SIZE.small, grey: 0.45 });

  return renderPdf(pages, font, { title: `${labels.title} — ${input.entity.legalName} — ${input.month}`, author: input.entity.legalName, createdAt: input.createdAt });
}

/** The same rows as CSV, for the accountant's books. */
export function cashSheetCsv(rows: readonly CashSheetRow[], labels: CashSheetLabels): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [[labels.columns.index, labels.columns.employeeCode, labels.columns.name, labels.columns.amount, labels.columns.date].map(cell).join(",")];
  rows.forEach((row, index) => {
    lines.push([index + 1, row.employeeCode ?? "", row.fullName, row.amount, row.disbursedOn ?? ""].map(cell).join(","));
  });
  lines.push([labels.total, "", "", cashSheetTotal(rows), ""].map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
