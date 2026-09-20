// Golden tests for the daily timesheet (FR-ATT-08, 09, 17): every case HR checks by hand.
import { describe, expect, it } from "vitest";
import { type CalendarDay, dayPlan, type DayRule, type RosterEntry, type SchedulePattern } from "./calendar";
import { assignPunchesToDays, type DayPunch, instantOf, mergePunches } from "./merge";
import { type ApprovedRequests, breakWindow, computeTimesheetDay, NO_REQUESTS, summariseDays, type TimesheetDayInput, type TimesheetPolicy } from "./timesheet";

const OFFICE: DayRule = { type: "working", segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
const FLEX: DayRule = { type: "working", segments: [{ start: "10:00", end: "16:00" }], breakMinutes: 60, flexible: true, requiredMinutes: 480 };
const pattern = (weekday: DayRule): SchedulePattern => ({ days: { 1: weekday, 2: weekday, 3: weekday, 4: weekday, 5: weekday, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } });
const HOLIDAY: CalendarDay = { date: "2026-09-02", entityId: null, kind: "public_holiday", name: "Quốc khánh" };

const POLICY: TimesheetPolicy = { mergeRule: "first_in_last_out", graceLateMinutes: 5, graceEarlyMinutes: 5, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: 720 };
const NIGHT = { start: 1320, end: 360 };

const at = (time: string, nextDay = false) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + (nextDay ? 1440 : 0);
const punch = (time: string, direction: "in" | "out", source: DayPunch["source"] = "device", nextDay = false): DayPunch => ({ at: at(time, nextDay), direction, source });
const inOut = (from: string, to: string): DayPunch[] => [punch(from, "in"), punch(to, "out")];

// 2026-08-03 is a Monday, 2026-08-08 a Saturday, 2026-08-09 a Sunday.
function day(date: string, punches: DayPunch[], extra: Partial<TimesheetDayInput> & { rule?: DayRule; roster?: RosterEntry } = {}) {
  const plan = dayPlan({ date, entityId: null, pattern: pattern(extra.rule ?? OFFICE), calendar: [HOLIDAY], roster: extra.roster });
  return computeTimesheetDay({ plan, punches, leave: [], requests: NO_REQUESTS, policy: POLICY, night: NIGHT, dayIsOver: true, ...extra });
}
const requests = (patch: Partial<ApprovedRequests>): ApprovedRequests => ({ ...NO_REQUESTS, ...patch });

describe("merge rules (FR-ATT-08)", () => {
  const both: DayPunch[] = [punch("08:20", "in", "app"), punch("08:31", "in", "device"), punch("17:32", "out", "device"), punch("18:40", "out", "app")];
  it("first in, last out across sources", () => {
    const merged = mergePunches(both, { rule: "first_in_last_out", duplicateWindowMinutes: 3, pairing: "span" });
    expect(merged.pairs).toEqual([{ in: at("08:20"), out: at("18:40") }]);
    expect(merged.trace).toContain("merge:first_in_last_out:across_sources");
  });
  it("prefer the device when it has punches, the app otherwise", () => {
    expect(mergePunches(both, { rule: "prefer_device", duplicateWindowMinutes: 3, pairing: "span" }).pairs).toEqual([{ in: at("08:31"), out: at("17:32") }]);
    const appOnly = both.filter((item) => item.source === "app");
    expect(mergePunches(appOnly, { rule: "prefer_device", duplicateWindowMinutes: 3, pairing: "span" }).pairs).toEqual([{ in: at("08:20"), out: at("18:40") }]);
  });
  it("prefer the app, but an approved correction always counts", () => {
    const merged = mergePunches([...both, punch("19:30", "out", "request")], { rule: "prefer_app", duplicateWindowMinutes: 3, pairing: "span" });
    expect(merged.pairs).toEqual([{ in: at("08:20"), out: at("19:30") }]);
    expect(merged.ignored).toBe(2);
  });
  it("collapses duplicates inside the window and keeps a lone punch as an open arrival", () => {
    const merged = mergePunches([punch("08:30", "in"), punch("08:31", "in"), punch("08:32", "in", "app")], { rule: "first_in_last_out", duplicateWindowMinutes: 3, pairing: "span" });
    expect(merged.duplicates).toBe(2);
    expect(merged.pairs).toEqual([{ in: at("08:30"), out: null }]);
  });
  it("pairs in sequence for split shifts", () => {
    const merged = mergePunches([punch("05:00", "in"), punch("09:02", "out"), punch("15:58", "in"), punch("20:00", "out")], { rule: "first_in_last_out", duplicateWindowMinutes: 3, pairing: "sequence" });
    expect(merged.pairs).toEqual([{ in: 300, out: 542 }, { in: 958, out: 1200 }]);
  });
});

describe("which day a punch belongs to", () => {
  const nightShift = [{ start: 1320, end: 1800 }];
  const office = [{ start: 510, end: 1050 }];
  it("a night shift's departure belongs to the day the shift started", () => {
    const days = [{ date: "2026-08-12", segments: nightShift }, { date: "2026-08-13", segments: nightShift }, { date: "2026-08-14", segments: [] }];
    const raw = [
      { at: instantOf("2026-08-12", at("21:50")), direction: "in" as const, source: "device" as const },
      // Clocks without a direction column: the import guessed "in" for the first punch of the calendar day.
      { at: instantOf("2026-08-13", at("06:05")), direction: "in" as const, source: "device" as const },
      { at: instantOf("2026-08-13", at("21:55")), direction: "in" as const, source: "device" as const },
      { at: instantOf("2026-08-14", at("06:10")), direction: "out" as const, source: "device" as const },
    ];
    const assigned = assignPunchesToDays(days, raw, 240);
    expect(assigned.get("2026-08-12")).toEqual([{ at: at("21:50"), direction: "in", source: "device" }, { at: at("06:05", true), direction: "out", source: "device" }]);
    expect(assigned.get("2026-08-13")).toEqual([{ at: at("21:55"), direction: "in", source: "device" }, { at: at("06:10", true), direction: "out", source: "device" }]);
    expect(assigned.get("2026-08-14")).toEqual([]);
  });
  it("leaving after midnight closes yesterday; arriving early does not", () => {
    const days = [{ date: "2026-08-03", segments: office }, { date: "2026-08-04", segments: office }];
    const raw = [
      { at: instantOf("2026-08-03", at("08:25")), direction: "in" as const, source: "app" as const },
      { at: instantOf("2026-08-04", at("00:40")), direction: "out" as const, source: "app" as const },
      { at: instantOf("2026-08-04", at("08:20")), direction: "in" as const, source: "app" as const },
    ];
    const assigned = assignPunchesToDays(days, raw, 240);
    expect(assigned.get("2026-08-03")!.map((item) => item.at)).toEqual([at("08:25"), at("00:40", true)]);
    expect(assigned.get("2026-08-04")!.map((item) => item.at)).toEqual([at("08:20")]);
  });
  it("a forgotten check-out is not closed by the next morning's arrival", () => {
    const days = [{ date: "2026-08-03", segments: office }, { date: "2026-08-04", segments: office }];
    const raw = [{ at: instantOf("2026-08-03", at("08:25")), direction: "in" as const, source: "app" as const }, { at: instantOf("2026-08-04", at("08:28")), direction: "in" as const, source: "app" as const }];
    expect(assignPunchesToDays(days, raw, 240).get("2026-08-03")).toHaveLength(1);
  });
});

describe("daily timesheet — office day 08:30–17:30, one hour break", () => {
  it("puts the break at noon", () => expect(breakWindow([{ start: 510, end: 1050 }], 60, 720)).toEqual({ start: 720, end: 780 }));

  it("on time", () => {
    const result = day("2026-08-03", inOut("08:25", "17:35"));
    expect(result).toMatchObject({ status: "present", requiredMinutes: 480, workedMinutes: 480, lateMinutes: 0, earlyMinutes: 0, absenceMinutes: 0, anomalies: [] });
    expect(result.otWeekday).toEqual({ day: 0, night: 0 });
  });
  it("late within grace counts as on time", () => {
    const result = day("2026-08-03", inOut("08:34", "17:30"));
    expect(result).toMatchObject({ status: "present", workedMinutes: 480, lateMinutes: 0, anomalies: [] });
    expect(result.trace).toContain("late:4min:within_grace_5");
  });
  it("late over grace", () => {
    const result = day("2026-08-03", inOut("08:52", "17:30"));
    expect(result).toMatchObject({ status: "partial", workedMinutes: 458, lateMinutes: 22, absenceMinutes: 22, anomalies: ["late"] });
  });
  it("early out", () => {
    const result = day("2026-08-03", inOut("08:30", "16:45"));
    expect(result).toMatchObject({ workedMinutes: 435, earlyMinutes: 45, absenceMinutes: 45, anomalies: ["early"] });
  });
  it("missing out-punch: time unknown until corrected", () => {
    const result = day("2026-08-03", [punch("08:29", "in")]);
    expect(result).toMatchObject({ status: "partial", missingPunch: true, workedMinutes: 0, absenceMinutes: 480, anomalies: ["missing_out"] });
  });
  it("no punches: absent", () => expect(day("2026-08-03", [])).toMatchObject({ status: "absent", absenceMinutes: 480, anomalies: ["absent"] }));
  it("the running day raises nothing yet", () => expect(day("2026-08-03", [punch("08:29", "in")], { dayIsOver: false })).toMatchObject({ status: "in_progress", anomalies: [], missingPunch: false }));

  it("half-day leave (morning) + afternoon worked", () => {
    const result = day("2026-08-05", inOut("12:55", "17:31"), { leave: [{ portion: "am", amountCenti: 50, minutes: null, isPaid: true, typeCode: "ANNUAL" }] });
    expect(result).toMatchObject({ status: "partial", leavePaidMinutes: 210, workedMinutes: 270, lateMinutes: 0, absenceMinutes: 0, anomalies: [] });
  });
  it("half-day leave (afternoon) but left before noon", () => {
    const result = day("2026-08-05", inOut("08:30", "11:30"), { leave: [{ portion: "pm", amountCenti: 50, minutes: null, isPaid: true, typeCode: "ANNUAL" }] });
    expect(result).toMatchObject({ leavePaidMinutes: 270, workedMinutes: 180, earlyMinutes: 30, absenceMinutes: 30 });
  });
  it("two hours of leave forgive a late arrival", () => {
    const result = day("2026-08-05", inOut("10:30", "17:30"), { leave: [{ portion: "hours", amountCenti: 25, minutes: 120, isPaid: true, typeCode: "ANNUAL" }] });
    expect(result).toMatchObject({ leavePaidMinutes: 120, workedMinutes: 360, lateMinutes: 0, absenceMinutes: 0, anomalies: [] });
  });
  it("full-day leave", () => {
    const result = day("2026-08-10", [], { leave: [{ portion: "full", amountCenti: 100, minutes: null, isPaid: true, typeCode: "ANNUAL" }] });
    expect(result).toMatchObject({ status: "leave", leavePaidMinutes: 480, workedMinutes: 0, absenceMinutes: 0, anomalies: [] });
  });
  it("unpaid full-day leave", () => {
    const result = day("2026-08-10", [], { leave: [{ portion: "full", amountCenti: 100, minutes: null, isPaid: false, typeCode: "UNPAID" }] });
    expect(result).toMatchObject({ status: "leave", leaveUnpaidMinutes: 480, leavePaidMinutes: 0 });
  });

  it("public holiday not worked: a paid day", () => {
    const result = day("2026-09-02", []);
    expect(result).toMatchObject({ status: "holiday", planKind: "holiday", holidayMinutes: 480, requiredMinutes: 0, absenceMinutes: 0, anomalies: [] });
  });
  it("public holiday worked with an approved request: holiday overtime on top of the paid day", () => {
    const result = day("2026-09-02", inOut("09:00", "16:00"), { requests: requests({ holidayWork: [{ requestId: "r1", from: null, to: null, confirmedMinutes: null, compensation: "pay" }] }) });
    expect(result).toMatchObject({ status: "holiday", holidayMinutes: 480, otHoliday: { day: 360, night: 0 }, otUnapprovedMinutes: 0, anomalies: [] });
  });
  it("public holiday worked without a request: shown, not counted", () => {
    const result = day("2026-09-02", inOut("09:00", "16:00"));
    expect(result).toMatchObject({ otHoliday: { day: 0, night: 0 }, otUnapprovedMinutes: 360 });
    expect(result.anomalies).toEqual(["ot_unapproved", "worked_on_day_off"]);
  });

  it("untracked Saturday is credited, punches or not (FR-ATT-17)", () => {
    expect(day("2026-08-08", [])).toMatchObject({ status: "untracked", creditedMinutes: 480, absenceMinutes: 0, anomalies: [], missingPunch: false });
    expect(day("2026-08-08", [punch("09:40", "in", "app")])).toMatchObject({ status: "untracked", creditedMinutes: 480, anomalies: [], missingPunch: false });
  });
  it("Saturday with unpaid leave is not credited", () => {
    const result = day("2026-08-08", [], { leave: [{ portion: "full", amountCenti: 100, minutes: null, isPaid: false, typeCode: "UNPAID" }] });
    expect(result).toMatchObject({ status: "leave", creditedMinutes: 0, leaveUnpaidMinutes: 480 });
  });
  it("Saturday overtime confirmed by the manager (no punches on an untracked day)", () => {
    const result = day("2026-08-08", [], { requests: requests({ overtime: [{ requestId: "r2", from: at("09:00"), to: at("12:00"), confirmedMinutes: 180, compensation: "pay" }] }) });
    expect(result).toMatchObject({ creditedMinutes: 480, otWeekday: { day: 180, night: 0 } });
  });
  it("rest-day work (Sunday) with an approved request, taken as time off", () => {
    const result = day("2026-08-09", inOut("08:00", "12:00"), { requests: requests({ holidayWork: [{ requestId: "r3", from: null, to: null, confirmedMinutes: null, compensation: "time_off" }] }) });
    expect(result).toMatchObject({ status: "rest", otRestDay: { day: 240, night: 0 }, otTimeOffMinutes: 240, anomalies: [] });
  });

  it("weekday overtime: approved", () => {
    const result = day("2026-08-04", inOut("08:30", "20:00"), { requests: requests({ overtime: [{ requestId: "r4", from: at("17:30"), to: at("20:00"), confirmedMinutes: null, compensation: "pay" }] }) });
    expect(result).toMatchObject({ workedMinutes: 480, otWeekday: { day: 150, night: 0 }, otUnapprovedMinutes: 0, anomalies: [] });
  });
  it("weekday overtime: only the approved window counts", () => {
    const result = day("2026-08-04", inOut("08:30", "21:00"), { requests: requests({ overtime: [{ requestId: "r4", from: at("17:30"), to: at("19:30"), confirmedMinutes: null, compensation: "pay" }] }) });
    expect(result).toMatchObject({ otWeekday: { day: 120, night: 0 }, otUnapprovedMinutes: 90, anomalies: ["ot_unapproved"] });
  });
  it("weekday overtime: unapproved", () => {
    const result = day("2026-08-04", inOut("08:30", "19:30"));
    expect(result).toMatchObject({ workedMinutes: 480, otWeekday: { day: 0, night: 0 }, otUnapprovedMinutes: 120, anomalies: ["ot_unapproved"] });
  });
  it("arriving early is not overtime — unless a request covers it", () => {
    expect(day("2026-08-04", inOut("07:15", "17:30"))).toMatchObject({ workedMinutes: 480, otWeekday: { day: 0, night: 0 }, otUnapprovedMinutes: 0, anomalies: [] });
    const approved = day("2026-08-04", inOut("07:15", "17:30"), { requests: requests({ overtime: [{ requestId: "r8", from: at("07:00"), to: at("08:30"), confirmedMinutes: null, compensation: "pay" }] }) });
    expect(approved.otWeekday).toEqual({ day: 75, night: 0 });
  });
  it("weekday overtime: below the minimum is nothing", () => {
    const result = day("2026-08-04", inOut("08:30", "17:50"), { requests: requests({ overtime: [{ requestId: "r4", from: at("17:30"), to: at("19:00"), confirmedMinutes: null, compensation: "pay" }] }) });
    expect(result).toMatchObject({ otWeekday: { day: 0, night: 0 }, otUnapprovedMinutes: 0, anomalies: [] });
    expect(result.trace).toContain("ot:below_minimum:20<30");
  });
  it("overtime without approval when the policy does not ask for one", () => {
    const result = day("2026-08-04", inOut("08:30", "19:00"), { policy: { ...POLICY, otRequiresApproval: false } });
    expect(result).toMatchObject({ otWeekday: { day: 90, night: 0 }, otUnapprovedMinutes: 0 });
  });
  it("night overtime is split from day overtime", () => {
    const result = day("2026-08-04", [punch("08:30", "in"), punch("23:30", "out")], { requests: requests({ overtime: [{ requestId: "r5", from: at("17:30"), to: at("23:30"), confirmedMinutes: null, compensation: "pay" }] }) });
    expect(result.otWeekday).toEqual({ day: 270, night: 90 });
  });

  it("rounding to the nearest 15 minutes", () => {
    const result = day("2026-08-03", inOut("08:37", "17:24"), { policy: { ...POLICY, roundingMinutes: 15, graceLateMinutes: 0, graceEarlyMinutes: 0 } });
    expect(result).toMatchObject({ workedMinutes: 480, lateMinutes: 0, earlyMinutes: 0 });
    expect(result.trace).toContain("rounding:nearest_15");
  });
  it("punches from both sources and duplicates", () => {
    const punches = [punch("08:28", "in", "app"), punch("08:29", "in", "device"), punch("17:31", "out", "device"), punch("17:33", "out", "app")];
    expect(day("2026-08-03", punches)).toMatchObject({ status: "present", workedMinutes: 480, firstIn: at("08:28"), lastOut: at("17:33") });
    expect(day("2026-08-03", punches, { policy: { ...POLICY, mergeRule: "prefer_device" } })).toMatchObject({ firstIn: at("08:29"), lastOut: at("17:31") });
    expect(day("2026-08-03", punches, { policy: { ...POLICY, mergeRule: "prefer_app" } })).toMatchObject({ firstIn: at("08:28"), lastOut: at("17:33") });
  });

  it("working from home is credited without punches", () => {
    const result = day("2026-08-06", [], { requests: requests({ remote: [{ requestId: "r6", kind: "wfh", portion: "full", requiresPunch: false }] }) });
    expect(result).toMatchObject({ status: "remote", creditedMinutes: 480, wfhMinutes: 480, absenceMinutes: 0, anomalies: [] });
  });
  it("off-site in the morning, office in the afternoon", () => {
    const result = day("2026-08-06", inOut("13:00", "17:30"), { requests: requests({ remote: [{ requestId: "r7", kind: "off_site", portion: "am", requiresPunch: false }] }) });
    expect(result).toMatchObject({ status: "present", creditedMinutes: 210, tripMinutes: 210, workedMinutes: 270, absenceMinutes: 0 });
  });
});

describe("daily timesheet — shifts and flexible hours", () => {
  const NIGHT_SHIFT: RosterEntry = { date: "2026-08-12", shift: { id: "night", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 45 } };
  const SPLIT: RosterEntry = { date: "2026-08-25", shift: { id: "split", segments: [{ start: "05:00", end: "09:00" }, { start: "16:00", end: "20:00" }], breakMinutes: 0 } };

  it("overnight shift across midnight", () => {
    const result = day("2026-08-12", [punch("21:50", "in"), punch("06:05", "out", "device", true)], { roster: NIGHT_SHIFT });
    expect(result).toMatchObject({ status: "present", requiredMinutes: 435, workedMinutes: 435, nightMinutes: 435, lateMinutes: 0, earlyMinutes: 0, anomalies: [] });
    expect(result.lastOut).toBe(at("06:05", true));
  });
  it("overnight shift left early", () => {
    const result = day("2026-08-12", [punch("22:00", "in"), punch("04:30", "out", "device", true)], { roster: NIGHT_SHIFT });
    expect(result).toMatchObject({ earlyMinutes: 90, workedMinutes: 345, anomalies: ["early"] });
  });
  it("split shift: both blocks worked, the gap is not overtime", () => {
    const result = day("2026-08-25", [punch("04:58", "in"), punch("09:00", "out"), punch("16:00", "in"), punch("20:03", "out")], { roster: SPLIT });
    expect(result).toMatchObject({ status: "present", requiredMinutes: 480, workedMinutes: 480, otUnapprovedMinutes: 0, anomalies: [] });
  });
  it("split shift: second block missed", () => {
    const result = day("2026-08-25", [punch("05:00", "in"), punch("09:00", "out")], { roster: SPLIT });
    expect(result).toMatchObject({ status: "partial", workedMinutes: 240, earlyMinutes: 660, absenceMinutes: 240 });
  });
  it("flexible hours: the daily total is met whenever it is worked", () => {
    const result = day("2026-08-03", inOut("09:40", "18:45"), { rule: FLEX });
    expect(result).toMatchObject({ status: "present", requiredMinutes: 480, workedMinutes: 480, lateMinutes: 0, anomalies: [] });
  });
  it("flexible hours short of the daily total", () => {
    const result = day("2026-08-03", inOut("09:55", "16:30"), { rule: FLEX });
    expect(result).toMatchObject({ status: "partial", workedMinutes: 335, absenceMinutes: 145, anomalies: ["short_hours"] });
  });
  it("flexible hours: arriving after core hours start is late", () => {
    const result = day("2026-08-03", inOut("10:30", "19:30"), { rule: FLEX });
    expect(result).toMatchObject({ lateMinutes: 30, workedMinutes: 480 });
    expect(result.anomalies).toEqual(["late"]);
  });
});

describe("month summary", () => {
  it("adds the month up for payroll", () => {
    const leave = [{ portion: "full" as const, amountCenti: 100, minutes: null, isPaid: true, typeCode: "ANNUAL" }];
    const days = [
      day("2026-08-31", inOut("08:30", "17:30")),
      day("2026-09-01", inOut("08:52", "17:30")),
      day("2026-09-02", []),
      day("2026-09-03", [], { leave }),
      day("2026-09-04", []),
      day("2026-09-05", []),
      day("2026-09-06", []),
      day("2026-09-07", inOut("08:30", "19:30"), { requests: requests({ overtime: [{ requestId: "r", from: at("17:30"), to: at("19:30"), confirmedMinutes: null, compensation: "pay" }] }) }),
    ];
    expect(summariseDays(days)).toMatchObject({
      days: 8, standardDays: 7, standardMinutes: 3360, workedMinutes: 1418, creditedMinutes: 480, leavePaidMinutes: 480, holidayMinutes: 480, absenceMinutes: 502,
      lateCount: 1, lateMinutes: 22, absentDays: 1, otWeekday: { day: 120, night: 0 }, otTotalMinutes: 120, paidDaysCenti: 595, unpaidDaysCenti: 105, anomalyDays: 2,
    });
  });
});
