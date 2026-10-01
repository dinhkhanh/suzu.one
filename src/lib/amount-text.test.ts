import { describe, expect, it } from "vitest";
import { caretAfter, formatAmount, formatPlaceholder, readAmount, separatorsFor } from "./amount-text";

const vi = separatorsFor("vi");
const en = separatorsFor("en");

describe("separatorsFor", () => {
  it("groups with a dot and marks decimals with a comma in Vietnamese, the other way round in English", () => {
    expect(vi).toEqual({ group: ".", decimal: "," });
    expect(en).toEqual({ group: ",", decimal: "." });
  });
});

describe("readAmount", () => {
  it("groups whole đồng in the reader's locale and submits the bare number", () => {
    expect(readAmount("1500000", vi)).toEqual({ display: "1.500.000", raw: "1500000" });
    expect(readAmount("1500000", en)).toEqual({ display: "1,500,000", raw: "1500000" });
  });

  it("regroups an amount already grouped, as it is being typed into", () => {
    expect(readAmount("1.500.0007", vi)).toEqual({ display: "15.000.007", raw: "15000007" });
    expect(readAmount("1,500,0007", en)).toEqual({ display: "15,000,007", raw: "15000007" });
  });

  it("drops what follows the decimal mark when the amount is in whole đồng", () => {
    expect(readAmount("1.500.000,00", vi)).toEqual({ display: "1.500.000", raw: "1500000" });
    expect(readAmount("1,500,000.99", en)).toEqual({ display: "1,500,000", raw: "1500000" });
    expect(readAmount("12,", vi)).toEqual({ display: "12", raw: "12" });
  });

  it("reads an amount pasted from the other locale by the later of its two marks", () => {
    expect(readAmount("1,500,000.00", vi)).toEqual({ display: "1.500.000", raw: "1500000" });
    expect(readAmount("1.500.000,00", en)).toEqual({ display: "1,500,000", raw: "1500000" });
  });

  it("keeps a fraction when decimals are allowed, the mark included while it is being typed", () => {
    expect(readAmount("1234,5", vi, { decimals: 2 })).toEqual({ display: "1.234,5", raw: "1234.5" });
    expect(readAmount("1234.567", en, { decimals: 2 })).toEqual({ display: "1,234.56", raw: "1234.56" });
    expect(readAmount("12,", vi, { decimals: 2 })).toEqual({ display: "12,", raw: "12" });
    expect(readAmount(",5", vi, { decimals: 2 })).toEqual({ display: "0,5", raw: "0.5" });
  });

  it("keeps a minus only where it is allowed", () => {
    expect(readAmount("-4000000", vi, { allowNegative: true })).toEqual({ display: "-4.000.000", raw: "-4000000" });
    expect(readAmount("-4000000", vi)).toEqual({ display: "4.000.000", raw: "4000000" });
    expect(readAmount("-", vi, { allowNegative: true })).toEqual({ display: "-", raw: "" });
    expect(readAmount("-0", vi, { allowNegative: true }).raw).toBe("0");
  });

  it("drops leading zeros, letters and anything past fifteen digits", () => {
    expect(readAmount("000120", vi)).toEqual({ display: "120", raw: "120" });
    expect(readAmount("0", vi)).toEqual({ display: "0", raw: "0" });
    expect(readAmount("12 tr đ", vi)).toEqual({ display: "12", raw: "12" });
    expect(readAmount("1234567890123456789", en).raw).toBe("123456789012345");
    expect(readAmount("", vi)).toEqual({ display: "", raw: "" });
  });
});

describe("formatAmount", () => {
  it("shows a stored value in the reader's locale", () => {
    expect(formatAmount(30000000, vi)).toBe("30.000.000");
    expect(formatAmount("30000000", en)).toBe("30,000,000");
    expect(formatAmount("-1500.5", vi, { decimals: 1, allowNegative: true })).toBe("-1.500,5");
    expect(formatAmount("1500.5", en, { decimals: 1 })).toBe("1,500.5");
    expect(formatAmount(null, vi)).toBe("");
    expect(formatAmount("", vi)).toBe("");
  });
});

describe("formatPlaceholder", () => {
  it("rewrites an example amount in the reader's grouping and leaves words alone", () => {
    expect(formatPlaceholder("60.000.000", en)).toBe("60,000,000");
    expect(formatPlaceholder("+15.000.000", en)).toBe("+15,000,000");
    expect(formatPlaceholder("120000000", vi)).toBe("120.000.000");
    expect(formatPlaceholder("Số tiền", vi)).toBe("Số tiền");
    expect(formatPlaceholder(undefined, vi)).toBeUndefined();
  });
});

describe("caretAfter", () => {
  it("stays after the digit just typed when a group mark appears before it", () => {
    // "100.000" with a 0 typed at the end: "100.0000" becomes "1.000.000".
    expect(caretAfter("100.0000", 8, "1.000.000", vi)).toBe(9);
    // A 5 typed after the first digit of "1.000": "15.000" stays "15.000", caret after the 5.
    expect(caretAfter("15.000", 2, "15.000", vi)).toBe(2);
    // The same typed into "1,000" in English: "15,000", caret after the 5.
    expect(caretAfter("15,000", 2, "15,000", en)).toBe(2);
  });

  it("moves back across a group mark when a digit is deleted", () => {
    // "1.000.000" with its last 0 deleted: "1.000.00" becomes "100.000", caret at the end.
    expect(caretAfter("1.000.00", 8, "100.000", vi)).toBe(7);
  });

  it("follows the decimal mark and the sign", () => {
    expect(caretAfter("12,", 3, "12,", vi, { decimals: 2 })).toBe(3);
    expect(caretAfter("-5", 1, "-5", vi, { allowNegative: true })).toBe(1);
    expect(caretAfter("5", 0, "5", vi)).toBe(0);
  });
});
