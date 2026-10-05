import { describe, expect, it } from "vitest";
import { addDays, todayInVietnam, vietnamDayStart, vietnamYearInstants } from "./dates";

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

describe("vietnamYearInstants", () => {
  // A kudos sent at 06:30 on New Year's Day in Hà Nội is 23:30 UTC on 31 December: it belongs to the new year.
  it("cuts the year at midnight in Vietnam, not UTC", () => {
    const { from, to } = vietnamYearInstants(2026);
    expect(from.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    expect(to.toISOString()).toBe("2026-12-31T16:59:59.999Z");
    expect(vietnamDayStart("2026-01-01")).toEqual(from);
    expect(todayInVietnam(from)).toBe("2026-01-01");
    expect(todayInVietnam(to)).toBe("2026-12-31");
  });
});
