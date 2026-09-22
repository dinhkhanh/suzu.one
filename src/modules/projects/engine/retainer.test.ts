import { describe, expect, it } from "vitest";
import { addMonths, carryFrom, hoursUsage, lastDayOf, monthsBetween, monthsDue, monthShare, monthsToClose, planPeriod, quotaAlertsDue, type RetainerTerms, totalUsage, usage } from "./retainer";

const lines = [
  { title: "Bài đăng Facebook", quantity: 12, format: "post", channel: "facebook" },
  { title: "Video ngắn TikTok", quantity: 4, format: "short_video", channel: "tiktok" },
];
const terms = (overrides: Partial<RetainerTerms> = {}): RetainerTerms => ({ startMonth: "2026-10", endMonth: "2027-03", lines, minutesPerMonth: 7200, feePerMonthVnd: 60_000_000, rollover: "rollover", ...overrides });

describe("months (FR-PJM-06)", () => {
  it("counts months across a year end and knows their last day", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2027-02", "2026-11")).toEqual([]);
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });

  it("makes every month from the start to this month, and none after the end month", () => {
    expect(monthsDue(terms(), "2026-09-30")).toEqual([]);
    expect(monthsDue(terms(), "2026-10-01")).toEqual(["2026-10"]);
    // A job that missed some nights catches up.
    expect(monthsDue(terms(), "2026-12-15")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthsDue(terms(), "2027-06-01")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(monthsDue(terms({ endMonth: null }), "2027-06-01")).toHaveLength(9);
  });

  it("closes the open months that are over", () => {
    expect(monthsToClose([{ month: "2026-10", status: "closed" }, { month: "2026-11", status: "open" }, { month: "2026-12", status: "open" }], "2026-12-01")).toEqual(["2026-11"]);
  });
});

describe("part months", () => {
  it("covers a month in calendar days from the project's start or to its due date", () => {
    expect(monthShare("2026-10", null, null)).toBe(1);
    expect(monthShare("2026-10", "2026-10-17", null)).toBeCloseTo(15 / 31);
    expect(monthShare("2027-03", null, "2027-03-15")).toBeCloseTo(15 / 31);
    expect(monthShare("2026-10", "2026-09-01", "2027-01-01")).toBe(1);
    expect(monthShare("2026-10", "2026-11-01", null)).toBe(0);
  });

  it("gives a part month its share of the quota, the hours and the fee", () => {
    const first = planPeriod(terms({ startDate: "2026-10-17" }), "2026-10", null);
    expect(first.lines.map((line) => line.quantity)).toEqual([6, 2]);
    expect(first.minutesAllowance).toBe(3484);
    expect(first.feeVnd).toBe(29_032_258);
    const last = planPeriod(terms({ endDate: "2027-03-15" }), "2027-03", null);
    expect(last.lines.map((line) => line.quantity)).toEqual([6, 2]);
    const full = planPeriod(terms({ startDate: "2026-10-17" }), "2026-11", null);
    expect(full).toMatchObject({ share: 1, minutesAllowance: 7200, feeVnd: 60_000_000 });
    expect(full.lines.map((line) => line.quantity)).toEqual([12, 4]);
  });
});

describe("rollover", () => {
  const october = { lines: [{ title: "Bài đăng Facebook", quantity: 12, consumed: 9 }, { title: "Video ngắn TikTok", quantity: 4, consumed: 5 }, { title: "Dropped line", quantity: 3, consumed: 0 }] };

  it("carries unused units forward and over-delivery back, by title", () => {
    expect(carryFrom("rollover", october, ["Bài đăng Facebook", "Video ngắn TikTok"])).toEqual({ "Bài đăng Facebook": 3, "Video ngắn TikTok": -1 });
    const november = planPeriod(terms(), "2026-11", october);
    expect(november.carried).toEqual({ "Bài đăng Facebook": 3, "Video ngắn TikTok": -1 });
    expect(november.lines).toEqual([
      { title: "Bài đăng Facebook", quantity: 15, format: "post", channel: "facebook" },
      { title: "Video ngắn TikTok", quantity: 3, format: "short_video", channel: "tiktok" },
    ]);
  });

  it("starts every month from the template under reset", () => {
    const november = planPeriod(terms({ rollover: "reset" }), "2026-11", october);
    expect(november.carried).toEqual({});
    expect(november.lines.map((line) => line.quantity)).toEqual([12, 4]);
  });

  it("never takes a quota below zero: a huge over-delivery is written off after one month", () => {
    const heavy = { lines: [{ title: "Video ngắn TikTok", quantity: 4, consumed: 11 }] };
    const november = planPeriod(terms(), "2026-11", heavy);
    expect(november.carried["Video ngắn TikTok"]).toBe(-7);
    expect(november.lines[1].quantity).toBe(0);
    // December carries from November's zero quota only what November itself used.
    expect(carryFrom("rollover", { lines: [{ title: "Video ngắn TikTok", quantity: 0, consumed: 0 }] }, ["Video ngắn TikTok"])).toEqual({});
  });

  it("carries into the first month nothing", () => {
    expect(planPeriod(terms(), "2026-10", null).carried).toEqual({});
  });
});

describe("overservicing and quota alerts", () => {
  it("is consumed ÷ contracted, with warning, full and over", () => {
    expect(usage(12, 6)).toEqual({ contracted: 12, consumed: 6, remaining: 6, percent: 50, level: "ok" });
    expect(usage(12, 10)).toMatchObject({ percent: 83, level: "warning" });
    expect(usage(12, 12)).toMatchObject({ percent: 100, level: "full", remaining: 0 });
    expect(usage(12, 15)).toMatchObject({ percent: 125, level: "over", remaining: 0 });
    expect(usage(0, 0)).toMatchObject({ percent: null, level: "ok" });
    expect(usage(0, 2)).toMatchObject({ percent: 100, level: "over" });
  });

  it("adds a month's lines up", () => {
    expect(totalUsage([{ contracted: 12, consumed: 15 }, { contracted: 4, consumed: 1 }])).toMatchObject({ contracted: 16, consumed: 16, percent: 100, level: "full" });
  });

  it("alerts at 80% and 100% of a line, once each", () => {
    expect(quotaAlertsDue("l1", 79, [])).toEqual([]);
    expect(quotaAlertsDue("l1", 80, [])).toEqual(["l1:80"]);
    expect(quotaAlertsDue("l1", 90, ["l1:80"])).toEqual([]);
    expect(quotaAlertsDue("l1", 125, [])).toEqual(["l1:80", "l1:100"]);
    expect(quotaAlertsDue("l1", 125, ["l1:80", "l1:100"])).toEqual([]);
    // Another line's marks are not this line's.
    expect(quotaAlertsDue("l2", 100, ["l1:80", "l1:100"])).toEqual(["l2:80", "l2:100"]);
    expect(quotaAlertsDue("l1", null, [])).toEqual([]);
  });

  it("measures hours against the allowance", () => {
    expect(hoursUsage(7200, 6000)).toMatchObject({ percent: 83, level: "warning" });
    expect(hoursUsage(null, 6000)).toBeNull();
  });
});
