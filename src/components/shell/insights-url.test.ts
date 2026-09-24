import { describe, expect, it } from "vitest";
import { insightsUrl } from "./insights-url";

describe("insightsUrl", () => {
  it("replaces the credential in token paths", () => {
    expect(insightsUrl("https://suzu.one/preview/abc123")).toBe("https://suzu.one/preview/[token]");
    expect(insightsUrl("https://suzu.one/careers/assignment/abc/submit")).toBe("https://suzu.one/careers/assignment/[token]/submit");
    expect(insightsUrl("https://suzu.one/approvals/act/xyz")).toBe("https://suzu.one/approvals/act/[token]");
    expect(insightsUrl("https://suzu.one/assets/qr/q1")).toBe("https://suzu.one/assets/qr/[token]");
  });

  it("drops the query string and fragment", () => {
    expect(insightsUrl("https://suzu.one/people?q=Nguyen#top")).toBe("https://suzu.one/people");
  });

  it("leaves other paths alone", () => {
    expect(insightsUrl("https://suzu.one/careers/engineer/apply")).toBe("https://suzu.one/careers/engineer/apply");
    expect(insightsUrl("https://suzu.one/preview")).toBe("https://suzu.one/preview");
  });
});
