// Golden cases for netting a trip's advances against its payments (REQ-01).
import { describe, expect, it } from "vitest";
import { settleAdvances } from "./settlement";

describe("settling advances", () => {
  it("pays the rest when more was spent than advanced", () => {
    expect(settleAdvances(3_000_000, [{ id: "pay", amount: 5_500_000, paidAmount: null }]).get("pay")).toEqual({ nettedAdvance: 3_000_000, toPay: 2_500_000 });
  });

  it("asks for the rest back when less was spent than advanced", () => {
    expect(settleAdvances(3_000_000, [{ id: "pay", amount: 1_200_000, paidAmount: null }]).get("pay")).toEqual({ nettedAdvance: 3_000_000, toPay: -1_800_000 });
  });

  it("nets nothing without a paid advance", () => {
    expect(settleAdvances(0, [{ id: "pay", amount: 900_000, paidAmount: null }]).get("pay")).toEqual({ nettedAdvance: 0, toPay: 900_000 });
  });

  it("takes from the advance in filing order, the last open payment taking what is left", () => {
    const settled = settleAdvances(4_000_000, [
      { id: "first", amount: 1_000_000, paidAmount: null },
      { id: "second", amount: 2_000_000, paidAmount: null },
      { id: "third", amount: 500_000, paidAmount: null },
    ]);
    expect([...settled.values()]).toEqual([
      { nettedAdvance: 1_000_000, toPay: 0 },
      { nettedAdvance: 2_000_000, toPay: 0 },
      { nettedAdvance: 1_000_000, toPay: -500_000 },
    ]);
  });

  it("keeps what a paid payment netted and offers the remainder to the next", () => {
    const settled = settleAdvances(3_000_000, [
      { id: "paid", amount: 2_000_000, paidAmount: 0 },
      { id: "open", amount: 1_500_000, paidAmount: null },
    ]);
    expect(settled.get("paid")).toEqual({ nettedAdvance: 2_000_000, toPay: 0 });
    expect(settled.get("open")).toEqual({ nettedAdvance: 1_000_000, toPay: 500_000 });
  });
});
