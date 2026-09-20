import { describe, expect, it } from "vitest";
import { divideDown, divideHalfUp, divideUp, isRoundingRule, percentBp, ratio, ROUNDING_RULES, toVnd } from "./rounding";

describe("rounding rules", () => {
  it("half_up rounds halves away from zero, exactly, on integers", () => {
    expect(divideHalfUp(5, 2)).toBe(3n);
    expect(divideHalfUp(-5, 2)).toBe(-3n);
    expect(divideHalfUp(7, 3)).toBe(2n);
    expect(divideHalfUp(8, 3)).toBe(3n);
    expect(divideHalfUp(5, -2)).toBe(-3n);
    expect(divideHalfUp(0, 7)).toBe(0n);
    // Beyond what a double can hold exactly.
    expect(divideHalfUp(9_007_199_254_740_993n * 3n, 3)).toBe(9_007_199_254_740_993n);
  });

  it("down goes towards zero and up away from it", () => {
    expect(divideDown(29, 10)).toBe(2n);
    expect(divideDown(-29, 10)).toBe(-2n);
    expect(divideUp(21, 10)).toBe(3n);
    expect(divideUp(-21, 10)).toBe(-3n);
    expect(divideUp(20, 10)).toBe(2n);
  });

  it("rounds to a step", () => {
    expect(ROUNDING_RULES.half_up_to_thousand(1_234_500, 1)).toBe(1_235_000n);
    expect(ROUNDING_RULES.half_up_to_thousand(1_234_499, 1)).toBe(1_234_000n);
    expect(ROUNDING_RULES.half_up_to_hundred(1_234_550, 1)).toBe(1_234_600n);
    expect(ROUNDING_RULES.down_to_thousand(1_234_999, 1)).toBe(1_234_000n);
    expect(ROUNDING_RULES.up_to_thousand(1_234_001, 1)).toBe(1_235_000n);
    expect(ROUNDING_RULES.up_to_thousand(1_234_000, 1)).toBe(1_234_000n);
  });

  it("pro-rates and takes percentages without floats", () => {
    // 20,000,000 × 17.5 / 22 = 15,909,090.909… → 15,909,091
    expect(ratio(20_000_000, 1750, 2200, "half_up")).toBe(15_909_091);
    expect(ratio(20_000_000, 1750, 2200, "down")).toBe(15_909_090);
    // 8% of 50,600,000 = 4,048,000
    expect(percentBp(50_600_000, 800, "half_up")).toBe(4_048_000);
    // 1.5% of 12,345,678 = 185,185.17 → 185,185
    expect(percentBp(12_345_678, 150, "half_up")).toBe(185_185);
  });

  it("refuses division by zero, non-integers and amounts out of range", () => {
    expect(() => divideHalfUp(1, 0)).toThrow(RangeError);
    expect(() => divideDown(1, 0)).toThrow(RangeError);
    expect(() => divideUp(1, 0)).toThrow(RangeError);
    expect(() => ratio(1.5, 1, 1, "half_up")).toThrow(RangeError);
    expect(() => toVnd(2n ** 60n)).toThrow(RangeError);
  });

  it("knows its own names and nothing inherited", () => {
    expect(isRoundingRule("half_up")).toBe(true);
    expect(isRoundingRule("constructor")).toBe(false);
    expect(isRoundingRule("toString")).toBe(false);
  });
});
