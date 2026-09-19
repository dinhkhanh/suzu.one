import { describe, expect, it } from "vitest";
import { addDays, todayInVietnam } from "./dates";

describe("todayInVietnam", () => {
  it("rolls over at midnight in Vietnam, not UTC", () => {
    expect(todayInVietnam(new Date("2026-09-19T16:59:59Z"))).toBe("2026-09-19");
    expect(todayInVietnam(new Date("2026-09-19T17:00:00Z"))).toBe("2026-09-20");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
