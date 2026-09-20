import { describe, expect, it } from "vitest";
import { type ExpenseLine, expenseProblems, expenseTotal, MAX_LINE_AMOUNT, MAX_LINES, RECEIPT_REQUIRED_ABOVE, receiptFileIds, totalsByCategory } from "./expense";

const TODAY = "2026-09-20";

const line = (overrides: Partial<ExpenseLine> = {}): ExpenseLine => ({
  lineDate: "2026-09-15",
  category: "transport",
  description: "Taxi từ sân bay về khách sạn",
  amount: 250_000,
  receiptFileId: null,
  projectTag: null,
  ...overrides,
});

const problemsOf = (lines: ExpenseLine[]) => expenseProblems(lines, { today: TODAY }).map((problem) => problem.problem);

describe("expenseProblems", () => {
  it("accepts a plain small line with no receipt", () => {
    expect(expenseProblems([line()], { today: TODAY })).toEqual([]);
  });

  it("refuses a claim with no lines at all", () => {
    expect(expenseProblems([], { today: TODAY })).toEqual([{ line: -1, problem: "no_lines" }]);
  });

  it("refuses more lines than it will read", () => {
    const many = Array.from({ length: MAX_LINES + 1 }, () => line());
    expect(expenseProblems(many, { today: TODAY })).toContainEqual({ line: -1, problem: "too_many_lines" });
  });

  it("names the line a problem is on", () => {
    expect(expenseProblems([line(), line({ description: "  " })], { today: TODAY })).toEqual([{ line: 1, problem: "no_description" }]);
  });

  describe("the amount", () => {
    it("must be positive", () => {
      expect(problemsOf([line({ amount: 0 })])).toEqual(["amount_not_positive"]);
      expect(problemsOf([line({ amount: -5_000 })])).toEqual(["amount_not_positive"]);
    });

    it("must be whole đồng", () => {
      expect(problemsOf([line({ amount: 1_000.5 })])).toEqual(["amount_not_integer"]);
    });

    it("must be a number at all", () => {
      expect(problemsOf([line({ amount: Number.NaN })])).toEqual(["amount_not_positive"]);
    });

    it("has a ceiling", () => {
      expect(problemsOf([line({ amount: MAX_LINE_AMOUNT })])).not.toContain("amount_too_large");
      expect(problemsOf([line({ amount: MAX_LINE_AMOUNT + 1 })])).toContain("amount_too_large");
    });
  });

  describe("the date", () => {
    it("refuses a day that has not happened", () => {
      expect(problemsOf([line({ lineDate: "2026-09-21" })])).toEqual(["date_in_future"]);
    });

    it("accepts today", () => {
      expect(problemsOf([line({ lineDate: TODAY })])).toEqual([]);
    });

    it("accepts the oldest day still in range and refuses the one before it", () => {
      expect(problemsOf([line({ lineDate: "2026-06-22" })])).toEqual([]); // exactly 90 days
      expect(problemsOf([line({ lineDate: "2026-06-21" })])).toEqual(["date_too_old"]);
    });

    it("takes the age limit from the rules when one is given", () => {
      expect(expenseProblems([line({ lineDate: "2026-09-10" })], { today: TODAY, maxAgeDays: 5 }).map((p) => p.problem)).toEqual(["date_too_old"]);
    });

    it("refuses something that is not a date", () => {
      expect(problemsOf([line({ lineDate: "15/09/2026" })])).toEqual(["bad_date"]);
      expect(problemsOf([line({ lineDate: "2026-02-31" })])).toEqual(["bad_date"]);
    });

    it("leaves the age unchecked when the date is unreadable", () => {
      expect(problemsOf([line({ lineDate: "" })])).toEqual(["bad_date"]);
    });
  });

  describe("the receipt", () => {
    it("is not asked for at the threshold", () => {
      expect(problemsOf([line({ amount: RECEIPT_REQUIRED_ABOVE })])).toEqual([]);
    });

    it("is asked for above it", () => {
      expect(problemsOf([line({ amount: RECEIPT_REQUIRED_ABOVE + 1 })])).toEqual(["receipt_required"]);
    });

    it("is satisfied by a file", () => {
      expect(problemsOf([line({ amount: 3_000_000, receiptFileId: "f1" })])).toEqual([]);
    });

    it("is asked for last, so a broken line explains itself first", () => {
      expect(problemsOf([line({ amount: 2_000_000, description: "" })])).toEqual(["no_description", "receipt_required"]);
    });

    it("follows the threshold the rules give", () => {
      expect(expenseProblems([line({ amount: 100_000 })], { today: TODAY, receiptRequiredAbove: 50_000 }).map((p) => p.problem)).toEqual(["receipt_required"]);
    });
  });

  it("refuses a category nobody defined", () => {
    expect(problemsOf([line({ category: "bribes" as never })])).toEqual(["bad_category"]);
  });

  it("refuses text longer than it will store", () => {
    expect(problemsOf([line({ description: "x".repeat(201) })])).toEqual(["description_too_long"]);
    expect(problemsOf([line({ projectTag: "y".repeat(61) })])).toEqual(["project_tag_too_long"]);
  });
});

describe("expenseTotal", () => {
  it("adds the lines up in whole đồng", () => {
    expect(expenseTotal([line({ amount: 250_000 }), line({ amount: 1_300_000 })])).toBe(1_550_000);
  });

  it("is zero for no lines", () => {
    expect(expenseTotal([])).toBe(0);
  });

  it("ignores a line that could never be filed, so a broken claim never asks for money", () => {
    expect(expenseTotal([line({ amount: 250_000 }), line({ amount: -9_000_000 }), line({ amount: 1.5 })])).toBe(250_000);
  });
});

describe("totalsByCategory", () => {
  it("groups in the catalogue's order and leaves empty categories out", () => {
    const lines = [line({ category: "meals", amount: 120_000 }), line({ category: "travel", amount: 2_000_000, receiptFileId: "f" }), line({ category: "meals", amount: 80_000 })];
    expect(totalsByCategory(lines)).toEqual([
      { category: "travel", amount: 2_000_000 },
      { category: "meals", amount: 200_000 },
    ]);
  });

  it("adds up to the claim's total", () => {
    const lines = [line({ amount: 250_000 }), line({ category: "meals", amount: 120_000 }), line({ category: "supplies", amount: 45_000 })];
    expect(totalsByCategory(lines).reduce((sum, row) => sum + row.amount, 0)).toBe(expenseTotal(lines));
  });
});

describe("receiptFileIds", () => {
  it("keeps the order and drops repeats and blanks", () => {
    expect(receiptFileIds([line({ receiptFileId: "b" }), line({ receiptFileId: null }), line({ receiptFileId: "a" }), line({ receiptFileId: "b" })])).toEqual(["b", "a"]);
  });
});
