import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("strips Vietnamese marks and joins words", () => {
    expect(slugify("Kỹ sư phần mềm (Đà Nẵng)")).toBe("ky-su-phan-mem-da-nang");
    expect(slugify("  Sổ tay   nhân viên!! ")).toBe("so-tay-nhan-vien");
  });

  it("takes an underscore separator", () => {
    expect(slugify("Biên bản họp", { separator: "_" })).toBe("bien_ban_hop");
  });

  it("cuts to length without leaving a trailing separator", () => {
    expect(slugify("abc def", { maxLength: 4 })).toBe("abc");
    expect(slugify("abcdef ghi", { maxLength: 6 })).toBe("abcdef");
  });

  it("returns empty for text with no letters or digits", () => {
    expect(slugify("—!?")).toBe("");
  });
});
