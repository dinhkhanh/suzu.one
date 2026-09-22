import { describe, expect, it } from "vitest";
import { capacity, capacityWeek, dayMinutes, isMonday, leaveMinutes, mondayOf, type PlannedDay, weeksFrom } from "./capacity";

// The week of Monday 31 August 2026: Wednesday 2 September is National Day.
const week = { start: "2026-08-31", end: "2026-09-06" };
const dates = ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"];
const fullTime: PlannedDay[] = dates.map((date, index) => (index === 2 ? { date, kind: "holiday", requiredMinutes: 0 } : index >= 5 ? { date, kind: "rest", requiredMinutes: 0 } : { date, kind: "working", requiredMinutes: 480 }));
// Mornings only, Monday to Friday.
const partTime: PlannedDay[] = fullTime.map((day) => (day.kind === "working" ? { ...day, requiredMinutes: 240 } : day));
const none = new Set<string>();

describe("weeks", () => {
  it("start on Mondays", () => {
    expect(mondayOf("2026-09-03")).toBe("2026-08-31");
    expect(mondayOf("2026-09-06")).toBe("2026-08-31");
    expect(isMonday("2026-08-31")).toBe(true);
    expect(isMonday("2026-09-01")).toBe(false);
    expect(weeksFrom("2026-09-02", 2)).toEqual([week, { start: "2026-09-07", end: "2026-09-13" }]);
  });
});

describe("available hours (FR-PJM-13)", () => {
  it("are the schedule's hours with the holiday already out", () => {
    const cell = capacityWeek({ week, days: fullTime, leave: [], bookings: [], daysOff: none });
    expect(cell).toMatchObject({ scheduledMinutes: 4 * 480, awayMinutes: 0, holidayDays: 1, availableMinutes: 1920, freeMinutes: 1920, over: false, atRisk: false });
  });
  it("follow a part-time schedule", () => {
    expect(capacityWeek({ week, days: partTime, leave: [], bookings: [], daysOff: none }).availableMinutes).toBe(4 * 240);
  });
  it("lose approved leave: a whole day, half a day, hours, never more than the day offers", () => {
    const cell = capacityWeek({
      week,
      days: fullTime,
      leave: [
        { date: "2026-08-31", days: 1, minutes: null },
        { date: "2026-09-01", days: 0.5, minutes: null },
        // Leave on the holiday or a Sunday takes nothing: those days offered nothing.
        { date: "2026-09-02", days: 1, minutes: null },
        { date: "2026-09-06", days: 1, minutes: null },
        { date: "2026-09-03", days: 0.25, minutes: 120 },
      ],
      bookings: [],
      daysOff: none,
    });
    expect(cell).toMatchObject({ awayMinutes: 480 + 240 + 120, awayDays: 1.75, availableMinutes: 1920 - 840 });
    expect(leaveMinutes(240, { date: "2026-09-01", days: 1, minutes: null })).toBe(240);
    expect(leaveMinutes(240, { date: "2026-09-01", days: 1, minutes: 600 })).toBe(240);
    // Two half days on one date take the day once.
    expect(capacityWeek({ week, days: fullTime, leave: [{ date: "2026-08-31", days: 0.5, minutes: null }, { date: "2026-08-31", days: 1, minutes: null }], bookings: [], daysOff: none }).awayMinutes).toBe(480);
  });
  it("fall back to 8 hours Monday–Friday for someone with no schedule, days off still off", () => {
    const unscheduled: PlannedDay[] = dates.map((date) => ({ date, kind: "unscheduled", requiredMinutes: 0 }));
    expect(dayMinutes(unscheduled[0], none)).toBe(480);
    expect(dayMinutes(unscheduled[5], none)).toBe(0);
    expect(capacityWeek({ week, days: unscheduled, leave: [], bookings: [], daysOff: new Set(["2026-09-02"]) })).toMatchObject({ availableMinutes: 1920, holidayDays: 1 });
  });
});

describe("bookings against capacity (FR-PJM-13)", () => {
  it("count confirmed hours as load; tentative hours are shown, never counted", () => {
    const cell = capacityWeek({ week, days: partTime, leave: [], bookings: [{ weekStart: week.start, minutes: 600, status: "confirmed" }, { weekStart: week.start, minutes: 300, status: "tentative" }, { weekStart: "2026-09-07", minutes: 2400, status: "confirmed" }], daysOff: none });
    expect(cell).toMatchObject({ availableMinutes: 960, confirmedMinutes: 600, tentativeMinutes: 300, freeMinutes: 360, over: false, atRisk: false });
  });
  it("warn when confirmed hours exceed what is available, and when tentative ones would", () => {
    const over = capacityWeek({ week, days: partTime, leave: [{ date: "2026-08-31", days: 1, minutes: null }], bookings: [{ weekStart: week.start, minutes: 900, status: "confirmed" }], daysOff: none });
    expect(over).toMatchObject({ availableMinutes: 720, freeMinutes: -180, over: true, atRisk: false });
    const risk = capacityWeek({ week, days: partTime, leave: [], bookings: [{ weekStart: week.start, minutes: 900, status: "confirmed" }, { weekStart: week.start, minutes: 120, status: "tentative" }], daysOff: none });
    expect(risk).toMatchObject({ over: false, atRisk: true });
  });
  it("lays people × weeks out and counts the weeks over", () => {
    const rows = capacity({
      people: [{ id: "an" }, { id: "binh" }],
      weeks: weeksFrom("2026-08-31", 2),
      days: (person) => (person.id === "an" ? fullTime : partTime),
      leave: [{ personId: "binh", date: "2026-09-01", days: 1, minutes: null }],
      bookings: [
        { personId: "an", weekStart: "2026-08-31", minutes: 2400, status: "confirmed" },
        { personId: "binh", weekStart: "2026-08-31", minutes: 600, status: "tentative" },
      ],
      daysOff: () => none,
    });
    expect(rows.map((row) => [row.person.id, row.overWeeks, row.cells[0].availableMinutes, row.cells[0].over, row.cells[0].atRisk])).toEqual([
      ["an", 1, 1920, true, false],
      ["binh", 0, 720, false, false],
    ]);
    // The second week has no day plans in this fixture: nothing is available, nothing is booked.
    expect(rows[1].cells[1]).toMatchObject({ availableMinutes: 0, confirmedMinutes: 0, over: false });
  });
});
