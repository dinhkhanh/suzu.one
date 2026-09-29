// The quote template (báo giá, FR-CRM-23) is seeded straight into the database, past the documents
// module's checks. These tests hold it to the rule an edit on Admin → Document templates meets:
// every placeholder is in the catalogue, and none lifts it above public_internal — a quote states
// the company's prices, never a person's pay, and names no contact.
import { describe, expect, it } from "vitest";
import { findPlaceholder, placeholdersIn, requiredTier, templateProblems, unknownPlaceholders } from "../documents/engine/template";
import { quoteLinesText } from "./quote-document";
import { QUOTE_TEMPLATE_BODY } from "./seed";

describe("the quote template", () => {
  it("names only placeholders the catalogue knows, and can be saved as a public_internal document", () => {
    expect(unknownPlaceholders(QUOTE_TEMPLATE_BODY)).toEqual([]);
    expect(templateProblems({ name: "Báo giá", body: QUOTE_TEMPLATE_BODY, tier: "public_internal" })).toEqual([]);
    expect(requiredTier(placeholdersIn(QUOTE_TEMPLATE_BODY))).toBe("public_internal");
  });

  it("keeps every quote fact in the sales group at public_internal", () => {
    for (const key of ["quote.number", "quote.title", "quote.validUntil", "quote.intro", "quote.lines", "quote.subtotal", "quote.discount", "quote.vat", "quote.total", "quote.terms"]) {
      expect(findPlaceholder(key)?.tier, key).toBe("public_internal");
      expect(findPlaceholder(key)?.group, key).toBe("sales");
    }
  });

  it("writes the lines with their quantity, months, discount and amount", () => {
    const words = { title: "Báo giá", months: (count: number) => `${count} tháng`, money: (amount: number) => `${amount}đ`, none: "—" };
    expect(
      quoteLinesText(
        [
          { title: "Bài đăng", description: null, quantity: 12, unit: "bài", unitPriceVnd: 1_500_000, discountBp: 1000, months: null },
          { title: "Quản lý fanpage", description: "Facebook", quantity: 1, unit: null, unitPriceVnd: 25_000_000, discountBp: 0, months: 3 },
        ],
        words,
      ),
    ).toBe("1. Bài đăng\n   12 bài × 1500000đ − 1800000đ (10%) = 16200000đ\n2. Quản lý fanpage — Facebook\n   1 × 25000000đ × 3 tháng = 75000000đ");
  });
});
