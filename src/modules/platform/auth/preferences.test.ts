import { describe, expect, it } from "vitest";
import { preferencesOf } from "./preferences";

describe("preferencesOf", () => {
  it("reads a chosen language and theme off the account row", () => {
    expect(preferencesOf({ locale: "en", theme: "dark" })).toEqual({ locale: "en", theme: "dark" });
    expect(preferencesOf({ locale: "vi", theme: "system" })).toEqual({ locale: "vi", theme: "system" });
  });

  it("treats an empty, missing or unrecognised value as never chosen", () => {
    expect(preferencesOf({ locale: null, theme: null })).toEqual({ locale: null, theme: null });
    expect(preferencesOf({})).toEqual({ locale: null, theme: null });
    expect(preferencesOf(null)).toEqual({ locale: null, theme: null });
    expect(preferencesOf({ locale: "fr", theme: "sepia" })).toEqual({ locale: null, theme: null });
    expect(preferencesOf({ locale: 1, theme: {} })).toEqual({ locale: null, theme: null });
  });
});
