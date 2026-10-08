// Golden tests for the check-in reminder's timing.
import { describe, expect, it } from "vitest";
import { checkInCountsFrom, expectedCheckIn, reminderDue } from "./checkin-reminder";

const DATE = "2026-10-08";
const at = (time: string, date = DATE) => Date.parse(`${date}T${time}:00+07:00`);
const office = { date: DATE, kind: "working" as const, segments: [{ start: 510, end: 1050 }] };

describe("expected check-in", () => {
  it("is the start of the first segment, in Vietnam time", () => {
    expect(expectedCheckIn(office, [], [])).toBe(at("08:30"));
    expect(expectedCheckIn({ ...office, segments: [{ start: 960, end: 1200 }, { start: 300, end: 540 }] }, [], [])).toBe(at("05:00"));
  });

  it("asks nothing on a day that is not a tracked working day", () => {
    for (const kind of ["untracked", "rest", "holiday", "compensatory_off", "company_off", "unscheduled"] as const) expect(expectedCheckIn({ ...office, kind }, [], [])).toBeNull();
    expect(expectedCheckIn({ ...office, segments: [] }, [], [])).toBeNull();
  });

  it("asks nothing when the morning is off, and keeps the start with an afternoon off", () => {
    expect(expectedCheckIn(office, [{ portion: "full" }], [])).toBeNull();
    expect(expectedCheckIn(office, [{ portion: "am" }], [])).toBeNull();
    expect(expectedCheckIn(office, [{ portion: "hours" }], [])).toBeNull();
    expect(expectedCheckIn(office, [{ portion: "pm" }], [])).toBe(at("08:30"));
  });

  it("asks nothing of a morning at home or on a trip, but does of an off-site day checked in on site", () => {
    expect(expectedCheckIn(office, [], [{ portion: "full", requiresPunch: false }])).toBeNull();
    expect(expectedCheckIn(office, [], [{ portion: "am", requiresPunch: false }])).toBeNull();
    expect(expectedCheckIn(office, [], [{ portion: "pm", requiresPunch: false }])).toBe(at("08:30"));
    expect(expectedCheckIn(office, [], [{ portion: "full", requiresPunch: true }])).toBe(at("08:30"));
  });
});

describe("reminder window", () => {
  it("opens five minutes after the start and closes two hours after it", () => {
    const start = at("08:30");
    expect(reminderDue(start, at("08:34"))).toBe(false);
    expect(reminderDue(start, at("08:35"))).toBe(true);
    expect(reminderDue(start, at("10:29"))).toBe(true);
    expect(reminderDue(start, at("10:30"))).toBe(false);
  });

  it("follows a night shift past midnight", () => {
    const start = at("23:58");
    expect(reminderDue(start, at("00:03", "2026-10-09"))).toBe(true);
  });

  it("counts a check-in from four hours before the start", () => {
    expect(checkInCountsFrom(at("08:30"))).toBe(at("04:30"));
  });
});
