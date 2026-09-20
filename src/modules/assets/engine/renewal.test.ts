import { describe, expect, it } from "vitest";
import { addMonthsClamped, renewalsBetween } from "./renewal";

describe("addMonthsClamped", () => {
  it("adds whole months and rolls the year over", () => {
    expect(addMonthsClamped("2026-09-20", 1)).toBe("2026-10-20");
    expect(addMonthsClamped("2026-11-20", 3)).toBe("2027-02-20");
    expect(addMonthsClamped("2026-09-20", 12)).toBe("2027-09-20");
  });

  it("clamps into a shorter month instead of spilling into the next one", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
    // A leap February takes the 29th.
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("does not drift: clamping once does not shorten every later renewal", () => {
    // The anchor is what is added to each time, so the 31st comes back in a 31-day month.
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
  });
});

describe("renewalsBetween", () => {
  it("lists each renewal inside the window", () => {
    expect(renewalsBetween("2026-10-05", 1, "2026-09-01", "2027-01-10")).toEqual(["2026-10-05", "2026-11-05", "2026-12-05", "2027-01-05"]);
    // The window's end is inclusive but firm: a renewal four days past it is next time's problem.
    expect(renewalsBetween("2026-10-05", 1, "2026-09-01", "2027-01-01")).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
  });

  it("walks an annual licence forward to the next one it is due, not every one it has had", () => {
    // Bought in 2019 and renewed every year since: the tracker wants 2026, not eight rows.
    expect(renewalsBetween("2019-03-14", 12, "2026-01-01", "2026-12-31")).toEqual(["2026-03-14"]);
  });

  it("includes a renewal that falls exactly on either edge", () => {
    expect(renewalsBetween("2026-10-05", 12, "2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
  });

  it("is empty when nothing falls due in the window", () => {
    expect(renewalsBetween("2026-03-14", 12, "2026-06-01", "2026-12-31")).toEqual([]);
    expect(renewalsBetween("2026-03-14", 12, "2026-04-01", "2026-03-01")).toEqual([]);
  });

  it("yields an anchor that is still in the future when the window reaches it", () => {
    expect(renewalsBetween("2027-05-01", 12, "2026-01-01", "2027-12-31")).toEqual(["2027-05-01"]);
  });

  it("refuses a nonsensical cycle rather than looping", () => {
    expect(renewalsBetween("2026-03-14", 0, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(renewalsBetween("2026-03-14", -12, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("gives quarterly renewals every three months", () => {
    expect(renewalsBetween("2026-01-15", 3, "2026-01-01", "2026-12-31")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  });
});
