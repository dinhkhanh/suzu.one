import { describe, expect, it } from "vitest";
import { MAX_NAV_PINS, navPinsOf, preferencesOf } from "./preferences";

describe("preferencesOf", () => {
  it("reads a chosen language, theme and pins off the account row", () => {
    expect(preferencesOf({ locale: "en", theme: "dark", navPins: ["payslips", "leave"] })).toEqual({ locale: "en", theme: "dark", navPins: ["payslips", "leave"] });
    expect(preferencesOf({ locale: "vi", theme: "system" })).toEqual({ locale: "vi", theme: "system", navPins: [] });
  });

  it("treats an empty, missing or unrecognised value as never chosen", () => {
    expect(preferencesOf({ locale: null, theme: null, navPins: null })).toEqual({ locale: null, theme: null, navPins: [] });
    expect(preferencesOf({})).toEqual({ locale: null, theme: null, navPins: [] });
    expect(preferencesOf(null)).toEqual({ locale: null, theme: null, navPins: [] });
    expect(preferencesOf({ locale: "fr", theme: "sepia", navPins: "leave" })).toEqual({ locale: null, theme: null, navPins: [] });
    expect(preferencesOf({ locale: 1, theme: {} })).toEqual({ locale: null, theme: null, navPins: [] });
  });
});

describe("navPinsOf", () => {
  it("keeps the order pinned, once each, and only names", () => {
    expect(navPinsOf(["leave", "payslips", "leave", "../admin", 3, "", "kb"])).toEqual(["leave", "payslips", "kb"]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: MAX_NAV_PINS + 5 }, (_, index) => `k${"x".repeat(index)}`);
    expect(navPinsOf(many)).toHaveLength(MAX_NAV_PINS);
  });
});
