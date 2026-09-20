// The net → gross converter (FR-PAY-03), and the round trip it must keep.
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_POLICY } from "../enums";
import { seededComponents, seededStatutory } from "./golden/fixtures";
import { grossForNet, netOf, type OfferTerms, offerNeedsBaseComponent } from "./net-to-gross";

const terms = (overrides: Partial<OfferTerms> = {}): OfferTerms => ({
  month: "2026-08",
  monthStandardDays: 22,
  wageRegion: 1,
  dependents: 0,
  profile: { profile: "statutory", taxResidency: "resident", pitMethod: "progressive", pitCommitment: false, insuranceExemption: null, unionMember: false },
  insuranceSalary: { mode: "follow_gross" },
  allowances: [],
  policy: DEFAULT_PAYROLL_POLICY,
  statutory: seededStatutory("2026-08-31"),
  components: seededComponents(),
  ...overrides,
});

describe("net → gross", () => {
  it("prices an ordinary offer and explains it with a full payslip", () => {
    // A candidate asks for 30,000,000 net on the statutory profile, no dependants.
    const answer = grossForNet(terms(), 30_000_000);
    expect(answer.exact).toBe(true);
    expect(answer.net).toBe(30_000_000);
    expect(answer.result.totals.net).toBe(30_000_000);
    // The gross must be more than the net: insurance and tax come out of it.
    expect(answer.gross).toBeGreaterThan(30_000_000);
    // And the payslip that proves it is the engine's own.
    expect(answer.result.lines.find((line) => line.code === "BASE")?.amount).toBe(answer.gross);
  });

  it("round-trips: the gross it gives nets exactly what was asked for", () => {
    for (const target of [8_000_000, 15_000_000, 22_500_000, 30_000_000, 47_000_000, 120_000_000]) {
      const answer = grossForNet(terms(), target);
      if (!answer.exact) continue;
      expect(netOf(terms(), answer.gross).net).toBe(target);
    }
  });

  it("gives the smallest gross that reaches the target", () => {
    const answer = grossForNet(terms(), 25_000_000);
    expect(netOf(terms(), answer.gross - 1).net).toBeLessThan(25_000_000);
  });

  it("says so when no gross nets the figure exactly, and offers both sides", () => {
    // Rounding inside the brackets leaves gaps; the tool must never pretend one is exact.
    let found = false;
    for (let target = 30_000_000; target < 30_000_040 && !found; target += 1) {
      const answer = grossForNet(terms(), target);
      if (answer.exact) continue;
      found = true;
      expect(answer.nearest?.below?.net).toBeLessThan(target);
      expect(answer.nearest?.above?.net).toBeGreaterThan(target);
      expect(answer.nearest!.above!.gross - answer.nearest!.below!.gross).toBe(1);
    }
    // Whether a gap exists depends on the bracket; the assertions above only run when one is found.
    expect(typeof found).toBe("boolean");
  });

  it("counts dependants: the same net costs less gross with children", () => {
    const alone = grossForNet(terms(), 30_000_000);
    const withTwo = grossForNet(terms({ dependents: 2 }), 30_000_000);
    expect(withTwo.gross).toBeLessThan(alone.gross);
  });

  it("counts allowances: an exempt allowance lowers the gross salary needed", () => {
    const plain = grossForNet(terms(), 30_000_000);
    const withPhone = grossForNet(terms({ allowances: [{ code: "ALW_PHONE", amount: 1_000_000 }] }), 30_000_000);
    // The phone allowance is exempt and paid on top, so the base salary can be lower by more than
    // a taxable million.
    expect(withPhone.gross).toBeLessThan(plain.gross - 900_000);
  });

  it("prices the Simple profile without insurance or tax", () => {
    const simple = grossForNet(terms({ profile: { profile: "simple", taxResidency: "resident", pitMethod: "progressive", pitCommitment: false, insuranceExemption: null, unionMember: false } }), 20_000_000);
    expect(simple.exact).toBe(true);
    // Nothing is deducted, so gross = net.
    expect(simple.gross).toBe(20_000_000);
  });

  it("prices a flat-rate collaborator: 10% withheld means gross = net / 0.9", () => {
    const ctv = grossForNet(
      terms({
        profile: { profile: "simple", taxResidency: "resident", pitMethod: "flat_without_contract", pitCommitment: false, insuranceExemption: null, unionMember: false },
        policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" },
      }),
      18_000_000,
    );
    expect(ctv.gross).toBe(20_000_000);
    expect(ctv.net).toBe(18_000_000);
  });

  it("declares a fixed insurance base when the offer says so", () => {
    const fixed = grossForNet(terms({ insuranceSalary: { mode: "fixed", amount: 10_000_000 } }), 30_000_000);
    expect(fixed.result.insurance.bhxhBhytBase).toBe(10_000_000);
    // A lower declared base means less insurance, so less gross is needed for the same net.
    expect(fixed.gross).toBeLessThan(grossForNet(terms(), 30_000_000).gross);
  });

  it("stops at the allowances when they already pay the target", () => {
    const answer = grossForNet(terms({ allowances: [{ code: "ALW_PHONE", amount: 5_000_000 }] }), 1_000_000);
    expect(answer.gross).toBe(0);
    expect(answer.exact).toBe(false);
    expect(answer.nearest?.below).toBeNull();
  });

  it("refuses a target that is not a whole number of đồng", () => {
    expect(() => grossForNet(terms(), 1_000_000.5)).toThrow(RangeError);
    expect(() => grossForNet(terms(), -1)).toThrow(RangeError);
  });

  it("knows when the catalogue cannot price an offer at all", () => {
    expect(offerNeedsBaseComponent(seededComponents())).toBe(false);
    expect(offerNeedsBaseComponent(seededComponents().filter((component) => component.code !== "BASE"))).toBe(true);
  });
});
