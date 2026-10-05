// When a probation review opens and falls due (FR-PRF-03). Worked out by hand from the company's
// countdown of [10, 3] days.
import { describe, expect, it } from "vitest";
import { probationLookahead, probationReviewDates } from "./probation";

describe("probationReviewDates", () => {
  it("opens with HR's first countdown day, and has the manager done by the last", () => {
    // Probation ends Saturday 14 November 2026.
    expect(probationReviewDates("2026-11-14", [10, 3], "2026-11-04")).toEqual({ opensOn: "2026-11-04", selfDueOn: "2026-11-07", managerDueOn: "2026-11-11" });
    // The order of the countdown does not matter.
    expect(probationReviewDates("2026-11-14", [3, 10], "2026-11-04")).toEqual({ opensOn: "2026-11-04", selfDueOn: "2026-11-07", managerDueOn: "2026-11-11" });
    expect(probationLookahead([3, 10])).toBe(10);
  });

  it("never hands somebody enrolled late a deadline already past", () => {
    // Enrolled on the 9th: the person's own day (the 7th) has gone, so it is today; the manager keeps the 11th.
    expect(probationReviewDates("2026-11-14", [10, 3], "2026-11-09")).toMatchObject({ selfDueOn: "2026-11-09", managerDueOn: "2026-11-11" });
    // Enrolled on the 13th: both today.
    expect(probationReviewDates("2026-11-14", [10, 3], "2026-11-13")).toMatchObject({ selfDueOn: "2026-11-13", managerDueOn: "2026-11-13" });
  });

  it("works from a single countdown day", () => {
    expect(probationReviewDates("2026-11-14", [7], "2026-11-01")).toEqual({ opensOn: "2026-11-07", selfDueOn: "2026-11-07", managerDueOn: "2026-11-07" });
  });
});
