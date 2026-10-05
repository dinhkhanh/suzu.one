import { describe, expect, it } from "vitest";
import { capitalizeWords, toSearchKey } from "./text";

describe("capitalizeWords", () => {
  it("capitalises every word and single-spaces the name", () => {
    expect(capitalizeWords("  problem   solving ")).toBe("Problem Solving");
    expect(capitalizeWords("teamwork")).toBe("Teamwork");
    expect(capitalizeWords("thuyết trình")).toBe("Thuyết Trình");
    expect(capitalizeWords("đàm phán")).toBe("Đàm Phán");
  });

  it("starts a word after a slash, a hyphen, a bracket, an ampersand or a plus", () => {
    expect(capitalizeWords("ui/ux")).toBe("Ui/Ux");
    expect(capitalizeWords("problem-solving")).toBe("Problem-Solving");
    expect(capitalizeWords("video (short form)")).toBe("Video (Short Form)");
    expect(capitalizeWords("research & development")).toBe("Research & Development");
  });

  it("leaves what was typed in capitals alone, and changes nothing but case and spacing", () => {
    expect(capitalizeWords("SEO")).toBe("SEO");
    expect(capitalizeWords("B2B marketing")).toBe("B2B Marketing");
    expect(capitalizeWords("Social Media")).toBe("Social Media");
    expect(capitalizeWords("   ")).toBe("");
    expect(toSearchKey(capitalizeWords("thuyết  trình"))).toBe(toSearchKey("thuyết trình"));
  });
});
