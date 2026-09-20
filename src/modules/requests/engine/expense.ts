// What an expense claim is, and what makes one payable (FR-REQ-03). Pure: no I/O, no database,
// no translation — every problem is a message key the form puts into the reader's language.
//
// A claim is a request like any other (the form, the flow, the inbox, the SLA clock all come from
// the builder), plus the one thing a generic form cannot express: a list of lines, each with its
// own date, category, amount and receipt. The claim's figure is the lines added up — never typed —
// so what the approver signs and what payroll pays are the same arithmetic.
//
// Money is whole đồng. Two rules below are the *company's*, not the law's, and are named so they
// can be argued with: how old a receipt may be, and above what figure one is required at all.

import type { IsoDate } from "@/lib/dates";

/** How a line is classified. Reporting groups by these; nothing in the payment depends on them. */
export const EXPENSE_CATEGORIES = ["travel", "accommodation", "transport", "meals", "supplies", "equipment", "client", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseLine = {
  /** The day the money was spent, not the day the claim was filed. */
  lineDate: IsoDate;
  category: ExpenseCategory;
  description: string;
  /** Whole đồng, always positive: a claim is money out, and a negative line is a different claim. */
  amount: number;
  /** A stored-file id. Required above `RECEIPT_REQUIRED_ABOVE`. */
  receiptFileId: string | null;
  /** Free text: the project, client or job the spend belongs to. */
  projectTag: string | null;
};

export const MAX_LINES = 30;
export const MAX_DESCRIPTION = 200;
export const MAX_PROJECT_TAG = 60;
/** 999,999,999 đồng on one line: past anything anybody buys out of pocket, and safely an integer. */
export const MAX_LINE_AMOUNT = 999_999_999;

/**
 * A receipt is required above this figure. Small out-of-pocket items — parking, a motorbike taxi,
 * a printout — rarely come with one, and demanding it would only teach people to attach a photo of
 * nothing. **The owner confirms this figure**; it is company policy, not law.
 */
export const RECEIPT_REQUIRED_ABOVE = 500_000;

/**
 * How far back a claim may reach. Anything older is not refused outright — it is refused *here*,
 * so it goes to finance as a conversation rather than into a payroll run by itself.
 * **The owner confirms this figure.**
 */
export const MAX_CLAIM_AGE_DAYS = 90;

export type ExpenseProblem =
  | "no_lines"
  | "too_many_lines"
  | "no_description"
  | "description_too_long"
  | "project_tag_too_long"
  | "bad_category"
  | "amount_not_positive"
  | "amount_not_integer"
  | "amount_too_large"
  | "bad_date"
  | "date_in_future"
  | "date_too_old"
  | "receipt_required";

/** A problem and the line it is on; `line` is -1 for a problem about the claim as a whole. */
export type ExpenseLineProblem = { line: number; problem: ExpenseProblem };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real day, not merely a well-shaped string. `Date.parse` happily rolls 2026-02-31 over into
 * March, which would silently move somebody's receipt into another month — so the day is built and
 * read back, and only a date that survives the round trip is a date.
 */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Days from `from` to `to`, both ISO dates. Negative when `to` is earlier. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
}

export type ExpenseRules = {
  today: IsoDate;
  /** Defaults to the constants above; a test — or, one day, a policy row — may say otherwise. */
  maxAgeDays?: number;
  receiptRequiredAbove?: number;
};

/**
 * Everything wrong with a claim, in the order a reader would find it. An empty array means the
 * claim may be filed; it says nothing about whether anybody will approve it.
 */
export function expenseProblems(lines: readonly ExpenseLine[], rules: ExpenseRules): ExpenseLineProblem[] {
  const problems: ExpenseLineProblem[] = [];
  if (lines.length === 0) return [{ line: -1, problem: "no_lines" }];
  if (lines.length > MAX_LINES) problems.push({ line: -1, problem: "too_many_lines" });

  const maxAgeDays = rules.maxAgeDays ?? MAX_CLAIM_AGE_DAYS;
  const receiptRequiredAbove = rules.receiptRequiredAbove ?? RECEIPT_REQUIRED_ABOVE;

  for (const [index, line] of lines.slice(0, MAX_LINES).entries()) {
    const add = (problem: ExpenseProblem) => problems.push({ line: index, problem });

    const description = line.description?.trim() ?? "";
    if (description.length === 0) add("no_description");
    else if (description.length > MAX_DESCRIPTION) add("description_too_long");
    if ((line.projectTag?.trim().length ?? 0) > MAX_PROJECT_TAG) add("project_tag_too_long");
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(line.category)) add("bad_category");

    if (typeof line.amount !== "number" || !Number.isFinite(line.amount)) add("amount_not_positive");
    else if (!Number.isInteger(line.amount)) add("amount_not_integer");
    else if (line.amount <= 0) add("amount_not_positive");
    else if (line.amount > MAX_LINE_AMOUNT) add("amount_too_large");

    if (typeof line.lineDate !== "string" || !isRealDate(line.lineDate)) add("bad_date");
    else {
      const age = daysBetween(line.lineDate, rules.today);
      if (age < 0) add("date_in_future");
      else if (age > maxAgeDays) add("date_too_old");
    }

    // Checked last: a line that is wrong in other ways should say so before it asks for paperwork.
    if (Number.isInteger(line.amount) && line.amount > receiptRequiredAbove && !line.receiptFileId) add("receipt_required");
  }
  return problems;
}

/** What the claim asks for. Integer đồng; an empty claim asks for nothing. */
export function expenseTotal(lines: readonly ExpenseLine[]): number {
  return lines.reduce((total, line) => total + (Number.isInteger(line.amount) && line.amount > 0 ? line.amount : 0), 0);
}

/** The same total, split the way finance reads it. Categories with nothing in them are left out. */
export function totalsByCategory(lines: readonly ExpenseLine[]): { category: ExpenseCategory; amount: number }[] {
  const totals = new Map<ExpenseCategory, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.amount) || line.amount <= 0) continue;
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(line.category)) continue;
    totals.set(line.category, (totals.get(line.category) ?? 0) + line.amount);
  }
  return EXPENSE_CATEGORIES.filter((category) => totals.has(category)).map((category) => ({ category, amount: totals.get(category)! }));
}

/** The receipts a claim carries, for the vault's owner look-up. Order kept, duplicates dropped. */
export function receiptFileIds(lines: readonly ExpenseLine[]): string[] {
  return [...new Set(lines.map((line) => line.receiptFileId).filter((id): id is string => !!id))];
}
