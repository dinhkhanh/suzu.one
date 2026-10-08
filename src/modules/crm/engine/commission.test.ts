// The commission statement against worked examples (FR-CRM-45): VAT taken out, a payment shared
// over an invoice's items, the split between deal owner and account manager, marginal tiers.
import { describe, expect, it } from "vitest";
import type { CommissionRule } from "../schema";
import { bandsOf, type Collection, commissionStatements, earnerShares, netOf, ruleProblem, tieredAmount } from "./commission";

const rule = (over: Partial<CommissionRule> = {}): CommissionRule => ({ base: "cash_collected", earner: "deal_owner", splitOwnerBp: 7000, tiers: [{ fromVnd: 0, rateBp: 300 }], ...over });

const payment = (over: Partial<Collection> = {}): Collection => ({
  paymentId: "p1",
  invoiceId: "i1",
  invoiceNumber: "0000123",
  accountName: "Vinamilk",
  receivedOn: "2026-10-05",
  paidVnd: 110_000_000,
  invoiceSubtotalVnd: 100_000_000,
  invoiceTotalVnd: 110_000_000,
  itemVnd: 100_000_000,
  itemsVnd: 100_000_000,
  dealOwnerId: "seller",
  accountManagerId: "am",
  ...over,
});

describe("the base", () => {
  it("takes the VAT out of the cash", () => {
    expect(netOf(payment())).toBe(100_000_000);
    // A part payment is net of VAT in the same proportion.
    expect(netOf(payment({ paidVnd: 55_000_000 }))).toBe(50_000_000);
  });

  it("shares a payment over the invoice's items by their amounts", () => {
    expect(netOf(payment({ itemVnd: 25_000_000 }))).toBe(25_000_000);
    expect(netOf(payment({ paidVnd: 33_000_000, itemVnd: 1, itemsVnd: 3 }))).toBe(10_000_000);
  });

  it("counts nothing from an empty invoice", () => {
    expect(netOf(payment({ invoiceTotalVnd: 0 }))).toBe(0);
  });
});

describe("who earns", () => {
  it("pays the deal owner, the account manager, or both at the split", () => {
    expect(earnerShares(rule(), payment())).toEqual([{ personId: "seller", shareBp: 10_000, as: "deal_owner" }]);
    expect(earnerShares(rule({ earner: "account_manager" }), payment())).toEqual([{ personId: "am", shareBp: 10_000, as: "account_manager" }]);
    expect(earnerShares(rule({ earner: "split" }), payment())).toEqual([
      { personId: "seller", shareBp: 7000, as: "deal_owner" },
      { personId: "am", shareBp: 3000, as: "account_manager" },
    ]);
  });

  it("gives one person both halves of a split when they hold both roles", () => {
    expect(earnerShares(rule({ earner: "split" }), payment({ accountManagerId: "seller" }))).toEqual([{ personId: "seller", shareBp: 10_000, as: "deal_owner" }]);
  });

  it("pays a missing earner's share to nobody", () => {
    expect(earnerShares(rule({ earner: "split" }), payment({ accountManagerId: null }))).toEqual([{ personId: "seller", shareBp: 7000, as: "deal_owner" }]);
    expect(earnerShares(rule(), payment({ dealOwnerId: null }))).toEqual([]);
  });
});

describe("tiers", () => {
  const tiers = [
    { fromVnd: 200_000_000, rateBp: 500 },
    { fromVnd: 0, rateBp: 300 },
    { fromVnd: 500_000_000, rateBp: 800 },
  ];

  it("orders the tiers into bands", () => {
    expect(bandsOf(tiers)).toEqual([
      { fromVnd: 0, toVnd: 200_000_000, rateBp: 300 },
      { fromVnd: 200_000_000, toVnd: 500_000_000, rateBp: 500 },
      { fromVnd: 500_000_000, toVnd: null, rateBp: 800 },
    ]);
  });

  it("pays each band at its own rate, so crossing a tier never lowers the amount", () => {
    // 200m × 3% + 100m × 5% = 6m + 5m.
    expect(tieredAmount(tiers, 300_000_000).amountVnd).toBe(11_000_000);
    // 200m × 3% + 300m × 5% + 100m × 8% = 6m + 15m + 8m.
    expect(tieredAmount(tiers, 600_000_000).amountVnd).toBe(29_000_000);
    expect(tieredAmount(tiers, 199_000_000).amountVnd).toBeLessThan(tieredAmount(tiers, 201_000_000).amountVnd);
  });

  it("pays nothing below a first tier that does not start at zero", () => {
    expect(tieredAmount([{ fromVnd: 100_000_000, rateBp: 1000 }], 150_000_000).amountVnd).toBe(5_000_000);
  });
});

describe("the month's statements", () => {
  it("adds up each earner's lines and keeps the trace", () => {
    const statements = commissionStatements({ id: "s", name: "2026", rule: rule({ earner: "split" }) }, "2026-10", [
      payment(),
      payment({ paymentId: "p2", invoiceNumber: "0000124", receivedOn: "2026-10-20", paidVnd: 22_000_000, invoiceSubtotalVnd: 20_000_000, invoiceTotalVnd: 22_000_000, itemVnd: 20_000_000, itemsVnd: 20_000_000, dealOwnerId: "other" }),
    ]);
    const seller = statements.get("seller")!;
    expect(seller.baseVnd).toBe(70_000_000);
    expect(seller.amountVnd).toBe(2_100_000);
    expect(seller.lines).toHaveLength(1);
    const am = statements.get("am")!;
    // 30% of 100m and 30% of 20m.
    expect(am.baseVnd).toBe(36_000_000);
    expect(am.amountVnd).toBe(1_080_000);
    expect(am.lines.map((line) => line.invoiceNumber)).toEqual(["0000123", "0000124"]);
    expect(statements.get("other")).toMatchObject({ baseVnd: 14_000_000, amountVnd: 420_000 });
  });

  it("leaves out whoever collected nothing", () => {
    expect(commissionStatements({ id: "s", name: "x", rule: rule() }, "2026-10", []).size).toBe(0);
  });
});

describe("a rule's problems", () => {
  it("refuses a rule it could not pay", () => {
    expect(ruleProblem(rule())).toBeNull();
    expect(ruleProblem(rule({ tiers: [] }))).toBe("commission_tiers");
    expect(ruleProblem(rule({ tiers: [{ fromVnd: 0, rateBp: 5000 }] }))).toBe("commission_tiers");
    expect(
      ruleProblem(
        rule({
          tiers: [
            { fromVnd: 0, rateBp: 100 },
            { fromVnd: 0, rateBp: 200 },
          ],
        }),
      ),
    ).toBe("commission_tiers");
    expect(ruleProblem(rule({ splitOwnerBp: 12_000 }))).toBe("commission_split");
  });
});
