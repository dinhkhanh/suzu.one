import { describe, expect, it } from "vitest";
import { defaultCodeScheme, formatEmployeeCode, normalizeEmployeeCode } from "./employee-code";

describe("employee codes", () => {
  it("pads the counter and keeps counting past the padding width", () => {
    const scheme = defaultCodeScheme("SZM");
    expect(formatEmployeeCode(scheme, 42)).toBe("SZM-0042");
    expect(formatEmployeeCode(scheme, 12345)).toBe("SZM-12345");
  });

  it("normalizes codes typed by hand", () => {
    expect(normalizeEmployeeCode("  szm-0007 ")).toBe("SZM-0007");
  });
});
