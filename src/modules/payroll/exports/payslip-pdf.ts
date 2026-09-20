// The payslip as a PDF (FR-PAY-32) — the same figures as the screen, on one sheet of A4 that can
// be printed, filed or sent to a bank. Pure: it is handed a calculated result and returns bytes.
//
// The wording is passed in rather than looked up, so this file has no opinion about language and
// the caller can render it with next-intl exactly as the page does.
import type { PersonPayResult } from "../engine/types";
import { type ParsedFont, truncateToWidth, widthOfText } from "@/modules/platform/pdf/font";
import { A4, Page, type PageSize, renderPdf } from "@/modules/platform/pdf/writer";

export type PayslipLabels = {
  title: string;
  entityLabel: { taxCode: string };
  person: { person: string; employeeCode: string; position: string; department: string; profile: string; paidDays: string };
  profileName: string;
  sections: { earnings: string; deductions: string; net: string; insurance: string; pit: string; employerCosts: string };
  columns: { line: string; amount: string; fund: string; base: string; employee: string; employer: string };
  totals: { gross: string; deductions: string };
  insurance: { funds: { bhxh: string; bhyt: string; bhtn: string }; notCovered: string };
  pit: { method: string; taxableIncome: string; assessableIncome: string; personalDeduction: string; dependentDeduction: string; insuranceDeduction: string; tax: string };
  footer: string;
};

export type PayslipPdfInput = {
  result: PersonPayResult;
  componentNames: ReadonlyMap<string, string>;
  person: { fullName: string; employeeCode: string | null; positionName: string | null; departmentName: string | null };
  entity: { legalName: string; taxCode: string | null; address: string | null };
  month: string;
  labels: PayslipLabels;
  /** Integer VND → the text on the page. The caller's formatter, so the page and the PDF agree. */
  formatMoney: (amount: number) => string;
  font: ParsedFont;
  createdAt?: Date;
  size?: PageSize;
};

const MARGIN = 48;
const SIZE = { title: 14, heading: 9.5, body: 8.5, small: 7.5 };

/** Walks down the page; everything below measures from the top, which is how a form is read. */
class Cursor {
  constructor(
    private readonly page: Page,
    public y: number,
  ) {}
  down(by: number): number {
    this.y -= by;
    return this.y;
  }
  get left() {
    return MARGIN;
  }
  get right() {
    return this.page.size.width - MARGIN;
  }
}

export function renderPayslipPdf(input: PayslipPdfInput): Uint8Array {
  const { result, labels, formatMoney, font, componentNames } = input;
  const size = input.size ?? A4;
  const page = new Page(size, font);
  const cursor = new Cursor(page, size.height - MARGIN);
  const { left, right } = cursor;
  const width = right - left;
  const nameOf = (code: string) => componentNames.get(code) ?? code;
  const fit = (text: string, maxWidth: number, fontSize = SIZE.body) => truncateToWidth(font, text, fontSize, maxWidth);

  // ── Who is paying, and for which month ──
  page.text(fit(input.entity.legalName, width * 0.6, SIZE.heading), left, cursor.y, { size: SIZE.heading, bold: true });
  page.textRight(labels.title, right, cursor.y, { size: SIZE.title, bold: true });
  cursor.down(13);
  if (input.entity.address) {
    page.text(fit(input.entity.address, width * 0.6, SIZE.small), left, cursor.y, { size: SIZE.small, grey: 0.35 });
    cursor.down(10);
  }
  if (input.entity.taxCode) {
    page.text(`${labels.entityLabel.taxCode}: ${input.entity.taxCode}`, left, cursor.y, { size: SIZE.small, grey: 0.35 });
    cursor.down(10);
  }

  // ── Who is being paid ──
  cursor.down(8);
  const half = left + width / 2;
  const pairs: [string, string][] = [
    [labels.person.person, input.person.fullName],
    [labels.person.employeeCode, input.person.employeeCode ?? "—"],
    [labels.person.position, input.person.positionName ?? "—"],
    [labels.person.department, input.person.departmentName ?? "—"],
    [labels.person.profile, labels.profileName],
    [labels.person.paidDays, `${(result.proration.paidDaysCenti / 100).toFixed(2)} / ${result.proration.standardDays}`],
  ];
  // The value column starts past the longest label, so nothing ever runs into anything.
  const labelColumn = Math.max(...pairs.map(([label]) => widthOfText(font, `${label}:`, SIZE.body))) + 8;
  pairs.forEach(([label, value], index) => {
    const x = index % 2 === 0 ? left : half;
    if (index % 2 === 0 && index > 0) cursor.down(13);
    const y = cursor.y;
    page.text(`${label}:`, x, y, { size: SIZE.body, grey: 0.4 });
    page.text(fit(value, width / 2 - labelColumn - 8, SIZE.body), x + labelColumn, y, { size: SIZE.body });
  });
  cursor.down(20);

  /** A table of `label | amount` rows, ending with a totals line. */
  const moneyTable = (heading: string, rows: { label: string; amount: number }[], total: { label: string; amount: number }) => {
    page.text(heading, left, cursor.down(4), { size: SIZE.heading, bold: true });
    cursor.down(12);
    page.rectangle(left, cursor.y - 3, width, 14, 0.94);
    page.text(labels.columns.line, left + 6, cursor.y + 1, { size: SIZE.small, grey: 0.35 });
    page.textRight(labels.columns.amount, right - 6, cursor.y + 1, { size: SIZE.small, grey: 0.35 });
    cursor.down(13);
    for (const row of rows) {
      page.text(fit(row.label, width - 140), left + 6, cursor.y, { size: SIZE.body });
      page.textRight(formatMoney(row.amount), right - 6, cursor.y, { size: SIZE.body });
      cursor.down(13);
    }
    page.line(left, cursor.y + 8, right, cursor.y + 8);
    page.text(total.label, left + 6, cursor.y, { size: SIZE.body, bold: true });
    page.textRight(formatMoney(total.amount), right - 6, cursor.y, { size: SIZE.body, bold: true });
    cursor.down(20);
  };

  const lines = (kind: "earning" | "deduction" | "employer_cost") => result.lines.filter((line) => line.kind === kind && line.amount !== 0).map((line) => ({ label: nameOf(line.code), amount: line.amount }));

  moneyTable(labels.sections.earnings, lines("earning"), { label: labels.totals.gross, amount: result.totals.grossEarnings });
  moneyTable(labels.sections.deductions, lines("deduction"), { label: labels.totals.deductions, amount: result.totals.totalDeductions });

  // ── The net, boxed, because it is the one figure everybody looks for ──
  page.rectangle(left, cursor.y - 6, width, 24, 0.9);
  page.text(labels.sections.net, left + 8, cursor.y + 2, { size: SIZE.heading, bold: true });
  page.textRight(formatMoney(result.totals.net), right - 8, cursor.y + 2, { size: SIZE.heading + 1.5, bold: true });
  cursor.down(32);

  // ── Insurance (FR-PAY-11) ──
  page.text(labels.sections.insurance, left, cursor.y, { size: SIZE.heading, bold: true });
  cursor.down(13);
  if (result.insurance.covered) {
    const columns = [left + 6, left + width * 0.34, left + width * 0.62, right - 6];
    page.text(labels.columns.fund, columns[0], cursor.y, { size: SIZE.small, grey: 0.35 });
    page.textRight(labels.columns.base, columns[1], cursor.y, { size: SIZE.small, grey: 0.35 });
    page.textRight(labels.columns.employee, columns[2], cursor.y, { size: SIZE.small, grey: 0.35 });
    page.textRight(labels.columns.employer, columns[3], cursor.y, { size: SIZE.small, grey: 0.35 });
    cursor.down(12);
    for (const fund of ["bhxh", "bhyt", "bhtn"] as const) {
      page.text(labels.insurance.funds[fund], columns[0], cursor.y, { size: SIZE.body });
      page.textRight(formatMoney(fund === "bhtn" ? result.insurance.bhtnBase : result.insurance.bhxhBhytBase), columns[1], cursor.y, { size: SIZE.body });
      page.textRight(formatMoney(result.insurance.employee[fund]), columns[2], cursor.y, { size: SIZE.body });
      page.textRight(formatMoney(result.insurance.employer[fund]), columns[3], cursor.y, { size: SIZE.body, grey: 0.4 });
      cursor.down(12);
    }
  } else {
    page.text(fit(labels.insurance.notCovered, width), left + 6, cursor.y, { size: SIZE.body, grey: 0.4 });
    cursor.down(12);
  }
  cursor.down(8);

  // ── Tax (FR-PAY-13, 14) ──
  page.text(labels.sections.pit, left, cursor.y, { size: SIZE.heading, bold: true });
  cursor.down(13);
  page.text(fit(labels.pit.method, width - 12, SIZE.small), left + 6, cursor.y, { size: SIZE.small, grey: 0.4 });
  cursor.down(12);
  if (result.pit.method !== "none") {
    const rows: [string, number][] = [
      [labels.pit.taxableIncome, result.pit.taxableIncome],
      [labels.pit.insuranceDeduction, result.pit.insuranceDeduction],
      [labels.pit.personalDeduction, result.pit.personalDeduction],
      [`${labels.pit.dependentDeduction}${result.pit.dependents > 0 ? ` (${result.pit.dependents})` : ""}`, result.pit.dependentDeduction],
      [labels.pit.assessableIncome, result.pit.assessableIncome],
      [labels.pit.tax, result.pit.tax],
    ];
    for (const [label, amount] of rows) {
      page.text(label, left + 6, cursor.y, { size: SIZE.body, grey: label === labels.pit.tax ? 0 : 0.35 });
      page.textRight(formatMoney(amount), right - 6, cursor.y, { size: SIZE.body, bold: label === labels.pit.tax });
      cursor.down(12);
    }
  }

  // ── What the company paid on top ──
  const employerCosts = lines("employer_cost");
  if (employerCosts.length > 0) {
    cursor.down(8);
    page.text(labels.sections.employerCosts, left, cursor.y, { size: SIZE.heading, bold: true });
    cursor.down(13);
    for (const row of employerCosts) {
      page.text(fit(row.label, width - 140), left + 6, cursor.y, { size: SIZE.body, grey: 0.35 });
      page.textRight(formatMoney(row.amount), right - 6, cursor.y, { size: SIZE.body, grey: 0.35 });
      cursor.down(12);
    }
  }

  // ── A payslip is a statement, not a signed document: say so at the foot ──
  page.line(left, MARGIN + 22, right, MARGIN + 22, 0.85);
  page.text(fit(labels.footer, width, SIZE.small), left, MARGIN + 10, { size: SIZE.small, grey: 0.45 });

  return renderPdf([page], font, {
    title: `${labels.title} — ${input.person.fullName} — ${input.month}`,
    author: input.entity.legalName,
    subject: labels.title,
    createdAt: input.createdAt,
  });
}
