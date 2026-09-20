import { describe, expect, it } from "vitest";
import { daySpan, firstClash, layoutWeek, MAX_BOOKING_DAYS, overlaps, shiftWeeks, weekDays, weekStart, windowProblems } from "./booking";

const at = (iso: string) => new Date(iso);
const window = (start: string, end: string) => ({ startAt: at(start), endAt: at(end) });

// 2026-09-21 is a Monday. Vietnam is UTC+7, so its day begins at 17:00 UTC the day before.
const MONDAY = at("2026-09-20T17:00:00Z");
const NOW = at("2026-09-20T02:00:00Z");

describe("overlaps", () => {
  it("is half-open: a booking ending when the next begins does not clash", () => {
    expect(overlaps(window("2026-09-21T02:00:00Z", "2026-09-21T10:00:00Z"), window("2026-09-21T10:00:00Z", "2026-09-21T12:00:00Z"))).toBe(false);
  });

  it("catches a booking wholly inside another, either way round", () => {
    const outer = window("2026-09-21T02:00:00Z", "2026-09-21T12:00:00Z");
    const inner = window("2026-09-21T04:00:00Z", "2026-09-21T06:00:00Z");
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it("catches a partial overlap from either side", () => {
    const first = window("2026-09-21T02:00:00Z", "2026-09-21T10:00:00Z");
    expect(overlaps(first, window("2026-09-21T09:00:00Z", "2026-09-21T12:00:00Z"))).toBe(true);
    expect(overlaps(first, window("2026-09-21T00:00:00Z", "2026-09-21T03:00:00Z"))).toBe(true);
  });
});

describe("firstClash", () => {
  const taken = [window("2026-09-22T02:00:00Z", "2026-09-22T10:00:00Z"), window("2026-09-24T02:00:00Z", "2026-09-24T10:00:00Z")];

  it("names the booking that is in the way", () => {
    expect(firstClash(window("2026-09-24T08:00:00Z", "2026-09-24T12:00:00Z"), taken)).toBe(taken[1]);
  });

  it("is null when the slot is free", () => {
    expect(firstClash(window("2026-09-23T02:00:00Z", "2026-09-23T10:00:00Z"), taken)).toBeNull();
  });
});

describe("windowProblems", () => {
  it("passes an ordinary booking later today", () => {
    expect(windowProblems(window("2026-09-20T03:00:00Z", "2026-09-20T09:00:00Z"), NOW)).toEqual([]);
  });

  it("refuses an end before its start", () => {
    expect(windowProblems(window("2026-09-22T09:00:00Z", "2026-09-22T03:00:00Z"), NOW)).toContain("booking_end_before_start");
  });

  it("refuses a window that has already begun — gear taken out yesterday is a check-out, not a booking", () => {
    expect(windowProblems(window("2026-09-19T03:00:00Z", "2026-09-22T09:00:00Z"), NOW)).toContain("booking_in_the_past");
  });

  it("allows a few minutes' grace so a form filled on the hour is not refused", () => {
    expect(windowProblems(window("2026-09-20T01:58:00Z", "2026-09-20T09:00:00Z"), NOW)).toEqual([]);
  });

  it("refuses a booking longer than a fortnight, and one made more than a year ahead", () => {
    const tooLong = { startAt: NOW, endAt: new Date(NOW.getTime() + (MAX_BOOKING_DAYS + 1) * 86400000) };
    expect(windowProblems(tooLong, NOW)).toContain("booking_too_long");
    const tooFar = { startAt: new Date(NOW.getTime() + 400 * 86400000), endAt: new Date(NOW.getTime() + 401 * 86400000) };
    expect(windowProblems(tooFar, NOW)).toContain("booking_too_far_ahead");
  });
});

describe("the Vietnam week", () => {
  it("starts on Monday at 00:00 Vietnam time", () => {
    expect(weekStart(at("2026-09-23T06:00:00Z")).toISOString()).toBe("2026-09-20T17:00:00.000Z");
  });

  it("puts Sunday in the week that began the Monday before", () => {
    // 2026-09-27 is a Sunday; late UTC on the 26th is already Sunday in Vietnam.
    expect(weekStart(at("2026-09-26T18:00:00Z")).toISOString()).toBe("2026-09-20T17:00:00.000Z");
  });

  it("gives seven day-starts, Monday first", () => {
    const days = weekDays(at("2026-09-23T06:00:00Z"));
    expect(days).toHaveLength(7);
    expect(days[0].toISOString()).toBe("2026-09-20T17:00:00.000Z");
    expect(days[6].toISOString()).toBe("2026-09-26T17:00:00.000Z");
  });

  it("steps whole weeks forward and back", () => {
    expect(shiftWeeks(at("2026-09-23T06:00:00Z"), 1).toISOString()).toBe("2026-09-27T17:00:00.000Z");
    expect(shiftWeeks(at("2026-09-23T06:00:00Z"), -1).toISOString()).toBe("2026-09-13T17:00:00.000Z");
  });
});

describe("daySpan", () => {
  it("covers one column for a booking inside a single day", () => {
    expect(daySpan(window("2026-09-22T02:00:00Z", "2026-09-22T10:00:00Z"), MONDAY)).toEqual({ from: 1, to: 1 });
  });

  it("ends on the previous column when it ends exactly at a day boundary", () => {
    // Tuesday 00:00 → Wednesday 00:00 Vietnam time is Tuesday alone.
    expect(daySpan(window("2026-09-21T17:00:00Z", "2026-09-22T17:00:00Z"), MONDAY)).toEqual({ from: 1, to: 1 });
  });

  it("clips a booking that starts before the week and ends inside it", () => {
    expect(daySpan(window("2026-09-18T02:00:00Z", "2026-09-22T10:00:00Z"), MONDAY)).toEqual({ from: 0, to: 1 });
  });

  it("is null for a booking that misses the week entirely", () => {
    expect(daySpan(window("2026-10-05T02:00:00Z", "2026-10-06T10:00:00Z"), MONDAY)).toBeNull();
  });
});

describe("layoutWeek", () => {
  it("puts bookings that do not share a column in the same lane", () => {
    const laid = layoutWeek([window("2026-09-21T02:00:00Z", "2026-09-21T10:00:00Z"), window("2026-09-23T02:00:00Z", "2026-09-23T10:00:00Z")], MONDAY);
    expect(laid.map((entry) => entry.lane)).toEqual([0, 0]);
  });

  it("pushes a booking sharing a column into the next lane", () => {
    const laid = layoutWeek([window("2026-09-21T02:00:00Z", "2026-09-23T10:00:00Z"), window("2026-09-22T02:00:00Z", "2026-09-22T10:00:00Z")], MONDAY);
    expect(laid.map((entry) => entry.lane)).toEqual([0, 1]);
  });

  it("uses no more lanes than the busiest column needs", () => {
    const day = (from: string, to: string) => window(from, to);
    const laid = layoutWeek([day("2026-09-21T02:00:00Z", "2026-09-21T04:00:00Z"), day("2026-09-21T05:00:00Z", "2026-09-21T07:00:00Z"), day("2026-09-23T02:00:00Z", "2026-09-23T04:00:00Z")], MONDAY);
    // The first two share Monday's column, so two lanes; the third re-uses lane 0 on Wednesday.
    expect(Math.max(...laid.map((entry) => entry.lane))).toBe(1);
    expect(laid[2].lane).toBe(0);
  });

  it("drops what falls outside the week", () => {
    expect(layoutWeek([window("2026-10-05T02:00:00Z", "2026-10-06T10:00:00Z")], MONDAY)).toEqual([]);
  });

  it("gives the longer booking the top lane when two start on the same column", () => {
    const long = window("2026-09-21T02:00:00Z", "2026-09-24T10:00:00Z");
    const short = window("2026-09-21T03:00:00Z", "2026-09-21T09:00:00Z");
    const laid = layoutWeek([short, long], MONDAY);
    expect(laid[0].item).toBe(long);
    expect(laid[0].lane).toBe(0);
    expect(laid[1].lane).toBe(1);
  });
});
