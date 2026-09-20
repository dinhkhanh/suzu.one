// The daily timesheet (FR-ATT-09, 17): one person-day in, one result with an explanation out.
// Pure: no I/O. The service gathers the inputs — the day plan, the day's merged punches, approved
// leave, approved attendance requests, the entity's policy, the statutory night window — and stores
// what comes back. Everything is integer minutes.
//
// How the numbers relate (what payroll relies on):
//   paid time of a day   = worked + credited + leavePaid + holiday
//   absence              = required − (all of the above) − leaveUnpaid, never below 0;
//                          late and early minutes are *part of* the absence, not on top of it.
//   overtime             = time outside the plan, by day category, split into day and night
//                          minutes; only approved overtime is counted, the rest is `otUnapproved`.
import type { DayPlan, PlannedSegment } from "./calendar";
import { type DayPunch, type MergeRule, mergePunches, type Pair } from "./merge";

/** Part of every stored day's inputs hash: raise it when the rules below change, and the next recompute rewrites every unlocked day. */
export const ENGINE_VERSION = 3;

export type TimesheetPolicy = {
  mergeRule: MergeRule;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  /** 0 = to the minute. */
  roundingMinutes: number;
  otMinMinutes: number;
  otRequiresApproval: boolean;
  duplicateWindowMinutes: number;
  /** Minute of the day the unpaid break starts when the plan is one block and the break fits there. */
  breakStart: number;
};

/** The statutory night window in minutes of the day, e.g. 22:00–06:00 = { start: 1320, end: 360 }. null = not configured: no night minutes. */
export type NightWindow = { start: number; end: number } | null;

export type LeaveOnDayInput = { portion: "full" | "am" | "pm" | "hours"; /** Hundredths of a day. */ amountCenti: number; /** For `hours`. */ minutes: number | null; isPaid: boolean; typeCode: string };

/**
 * Approved attendance requests touching the day — filled by week 5's request types.
 * - `remote`: WFH, off-site (shooting, client visit) or a business trip. The covered part of the day
 *   is credited as worked without punches; `requiresPunch` = the person still checks in (off-site
 *   with a declared location), so punches decide like on an office day.
 * - `overtime`: a pre-approved window (minutes from the day's midnight, above 1440 = after midnight).
 *   `confirmedMinutes`: the manager confirmed the hours (untracked or off-site work without punches).
 * - `holidayWork`: work on a public holiday or rest day (FR-ATT-18); same fields, window optional.
 */
export type ApprovedRequests = {
  remote: { requestId: string; kind: "wfh" | "off_site" | "business_trip"; portion: "full" | "am" | "pm"; requiresPunch: boolean }[];
  overtime: { requestId: string; from: number; to: number; confirmedMinutes: number | null; compensation: "pay" | "time_off" }[];
  holidayWork: { requestId: string; from: number | null; to: number | null; confirmedMinutes: number | null; compensation: "pay" | "time_off" }[];
};

export const NO_REQUESTS: ApprovedRequests = { remote: [], overtime: [], holidayWork: [] };

export type TimesheetDayInput = {
  plan: DayPlan;
  /** The punches given to this day (see `assignPunchesToDays`), rejected ones already left out. */
  punches: readonly DayPunch[];
  leave: readonly LeaveOnDayInput[];
  requests: ApprovedRequests;
  policy: TimesheetPolicy;
  night: NightWindow;
  /** false while the day is still running: nothing is missing yet. */
  dayIsOver: boolean;
};

export type TimesheetStatus = "present" | "partial" | "absent" | "leave" | "holiday" | "day_off" | "rest" | "untracked" | "remote" | "unscheduled" | "in_progress";

export type Anomaly = "late" | "early" | "missing_in" | "missing_out" | "absent" | "short_hours" | "ot_unapproved" | "worked_on_leave" | "worked_on_day_off" | "no_schedule";

export type OtMinutes = { day: number; night: number };

export type TimesheetDayResult = {
  date: string;
  planKind: DayPlan["kind"];
  status: TimesheetStatus;
  requiredMinutes: number;
  workedMinutes: number;
  creditedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  absenceMinutes: number;
  missingPunch: boolean;
  leavePaidMinutes: number;
  leaveUnpaidMinutes: number;
  holidayMinutes: number;
  wfhMinutes: number;
  tripMinutes: number;
  /** Ordinary (non-overtime) minutes inside the night window. */
  nightMinutes: number;
  /** `day` + `night` = the category's overtime; night minutes are the part inside the night window. */
  otWeekday: OtMinutes;
  otRestDay: OtMinutes;
  otHoliday: OtMinutes;
  otUnapprovedMinutes: number;
  otTimeOffMinutes: number;
  /** Minutes from the day's midnight; above 1440 = after midnight. */
  firstIn: number | null;
  lastOut: number | null;
  anomalies: Anomaly[];
  trace: string[];
};

// ── Intervals ───────────────────────────────────────────────────────────────────────────────

type Interval = { start: number; end: number };

const length = (intervals: readonly Interval[]) => intervals.reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0);

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const x of a) for (const y of b) if (Math.min(x.end, y.end) > Math.max(x.start, y.start)) result.push({ start: Math.max(x.start, y.start), end: Math.min(x.end, y.end) });
  return result.sort((p, q) => p.start - q.start);
}

function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  let result = [...a];
  for (const cut of b) result = result.flatMap((piece) => (cut.end <= piece.start || cut.start >= piece.end ? [piece] : [{ start: piece.start, end: Math.max(piece.start, cut.start) }, { start: Math.min(piece.end, cut.end), end: piece.end }].filter((part) => part.end > part.start)));
  return result;
}

/** The night window laid over two days, so that an interval running past midnight meets it. */
function nightIntervals(night: NightWindow): Interval[] {
  if (!night) return [];
  const span = night.end > night.start ? night.end - night.start : night.end + 1440 - night.start;
  return [-1, 0, 1].map((day) => ({ start: night.start + day * 1440, end: night.start + day * 1440 + span }));
}

const hhmm = (minute: number) => `${String(Math.floor((((minute % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((minute % 1440) + 1440) % 1440) % 60).padStart(2, "0")}${minute >= 1440 ? "+1" : ""}`;

/** Where the unpaid break sits: at the policy's hour when the day is one block containing it, else in the middle of the longest block. */
export function breakWindow(segments: readonly PlannedSegment[], breakMinutes: number, breakStart: number): Interval | null {
  if (breakMinutes <= 0 || segments.length === 0) return null;
  const longest = [...segments].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (breakStart > longest.start && breakStart + breakMinutes < longest.end) return { start: breakStart, end: breakStart + breakMinutes };
  const start = Math.floor((longest.start + longest.end - breakMinutes) / 2);
  return { start, end: start + breakMinutes };
}

const roundTo = (minute: number, step: number) => (step > 1 ? Math.round(minute / step) * step : minute);

// ── The engine ──────────────────────────────────────────────────────────────────────────────

export function computeTimesheetDay(input: TimesheetDayInput): TimesheetDayResult {
  const { plan, policy } = input;
  const trace: string[] = [...plan.trace.map((line) => `plan:${line}`)];
  const anomalies: Anomaly[] = [];
  const result: TimesheetDayResult = {
    date: plan.date,
    planKind: plan.kind,
    status: "rest",
    requiredMinutes: plan.requiredMinutes,
    workedMinutes: 0,
    creditedMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    absenceMinutes: 0,
    missingPunch: false,
    leavePaidMinutes: 0,
    leaveUnpaidMinutes: 0,
    holidayMinutes: 0,
    wfhMinutes: 0,
    tripMinutes: 0,
    nightMinutes: 0,
    otWeekday: { day: 0, night: 0 },
    otRestDay: { day: 0, night: 0 },
    otHoliday: { day: 0, night: 0 },
    otUnapprovedMinutes: 0,
    otTimeOffMinutes: 0,
    firstIn: null,
    lastOut: null,
    anomalies,
    trace,
  };

  // Presence: what the punches say.
  const merged = mergePunches(input.punches, { rule: policy.mergeRule, duplicateWindowMinutes: policy.duplicateWindowMinutes, pairing: plan.segments.length > 1 ? "sequence" : "span" });
  trace.push(...merged.trace);
  const pairs: Pair[] = merged.pairs.map((pair) => ({ in: pair.in === null ? null : roundTo(pair.in, policy.roundingMinutes), out: pair.out === null ? null : roundTo(pair.out, policy.roundingMinutes) }));
  if (policy.roundingMinutes > 1 && merged.pairs.length > 0) trace.push(`rounding:nearest_${policy.roundingMinutes}`);
  const presence: Interval[] = pairs.flatMap((pair) => (pair.in !== null && pair.out !== null && pair.out > pair.in ? [{ start: pair.in, end: pair.out }] : []));
  const ins = pairs.flatMap((pair) => (pair.in === null ? [] : [pair.in]));
  const outs = pairs.flatMap((pair) => (pair.out === null ? [] : [pair.out]));
  result.firstIn = ins.length ? Math.min(...ins) : null;
  result.lastOut = outs.length ? Math.max(...outs) : null;
  const hasPunches = merged.used.length > 0;
  if (hasPunches) trace.push(`punches:${pairs.map((pair) => `${pair.in === null ? "?" : hhmm(pair.in)}→${pair.out === null ? "?" : hhmm(pair.out)}`).join(",")}`);
  const nights = nightIntervals(input.night);
  if (!input.night && hasPunches) trace.push("night_window:not_configured");

  // Leave on the day, in minutes of the day's required time.
  const required = plan.requiredMinutes;
  const fullLeave = input.leave.find((leave) => leave.portion === "full");
  const halfLeaves = input.leave.filter((leave) => leave.portion === "am" || leave.portion === "pm");
  // A half day of leave is the half of the plan it covers (the morning before the break may be
  // shorter than the afternoon); on flexible and untracked days it is half of the day's total.
  const blocks: Interval[] = plan.segments.map((segment) => ({ start: segment.start, end: segment.end }));
  const pause = plan.kind === "working" ? breakWindow(plan.segments, plan.breakMinutes, policy.breakStart) : null;
  const splitAt = pause ? pause.start : blocks.length > 1 ? blocks[0].end : blocks.length === 1 ? Math.floor((blocks[0].start + blocks[0].end) / 2) : 0;
  const resumeAt = pause ? pause.end : blocks.length > 1 ? blocks[1].start : splitAt;
  const half = (portion: "am" | "pm"): Interval => (portion === "am" ? { start: blocks[0]?.start ?? 0, end: splitAt } : { start: resumeAt, end: blocks.at(-1)?.end ?? 0 });
  const workable = subtract(blocks, pause ? [pause] : []);
  let leaveMinutes = 0;
  for (const leave of input.leave) {
    const share = leave.portion === "hours" ? (leave.minutes ?? 0) : (leave.portion === "am" || leave.portion === "pm") && plan.kind === "working" && !plan.flexible ? length(intersect(workable, [half(leave.portion)])) : Math.round((required * Math.min(100, leave.amountCenti)) / 100);
    const minutes = Math.min(required - leaveMinutes, share);
    if (minutes <= 0) continue;
    leaveMinutes += minutes;
    if (leave.isPaid) result.leavePaidMinutes += minutes;
    else result.leaveUnpaidMinutes += minutes;
    trace.push(`leave:${leave.typeCode}:${leave.portion}:${minutes}min:${leave.isPaid ? "paid" : "unpaid"}`);
  }

  // Overtime: time outside the plan, by the day's category.
  const category: "otWeekday" | "otRestDay" | "otHoliday" = plan.kind === "holiday" ? "otHoliday" : plan.kind === "working" || plan.kind === "untracked" ? "otWeekday" : "otRestDay";
  const approvals = [...input.requests.overtime.map((request) => ({ ...request, from: request.from as number | null, to: request.to as number | null })), ...(plan.kind === "working" || plan.kind === "untracked" ? [] : input.requests.holidayWork)];
  // `extra`: presence outside the plan. `unasked`: the part of it that counts without a request when
  // the policy asks for none, and that is reported when it does — on a working day only what comes
  // after the planned end (arriving early is not overtime unless a request says so).
  const countOvertime = (extra: Interval[], unasked: Interval[] = extra) => {
    const extraMinutes = length(extra);
    let counted: Interval[] = [];
    let confirmed = 0;
    let timeOff = 0;
    if (!policy.otRequiresApproval) counted = unasked;
    for (const approval of approvals) {
      if (approval.confirmedMinutes !== null && extraMinutes === 0) {
        // No punches to go by (untracked or off-site work): the manager's confirmation is the record.
        confirmed += approval.confirmedMinutes;
        if (approval.compensation === "time_off") timeOff += approval.confirmedMinutes;
        trace.push(`ot:confirmed_by_manager:${approval.confirmedMinutes}min`);
        continue;
      }
      const window: Interval[] = approval.from !== null && approval.to !== null ? [{ start: approval.from, end: approval.to }] : [{ start: -1440, end: 2880 }];
      const covered = subtract(intersect(extra, window), counted);
      if (approval.compensation === "time_off") timeOff += length(covered);
      counted = [...counted, ...covered];
    }
    let minutes = length(counted);
    let nightPart = length(intersect(counted, nights));
    if (minutes > 0 && minutes < policy.otMinMinutes) {
      trace.push(`ot:below_minimum:${minutes}<${policy.otMinMinutes}`);
      minutes = 0;
      nightPart = 0;
      timeOff = 0;
    }
    const unapproved = length(subtract(unasked, counted));
    if (unapproved >= policy.otMinMinutes && policy.otRequiresApproval) {
      result.otUnapprovedMinutes = unapproved;
      anomalies.push("ot_unapproved");
      trace.push(`ot:unapproved:${unapproved}min`);
    }
    result[category] = { day: minutes - nightPart + confirmed, night: nightPart };
    result.otTimeOffMinutes = timeOff;
    if (minutes + confirmed > 0) trace.push(`ot:${category}:${minutes + confirmed}min(night ${nightPart})`);
  };

  // ── Days nobody is expected at work ─────────────────────────────────────────────────────────
  if (plan.kind !== "working") {
    const baselineMinutes = plan.baseline.kind === "working" || plan.baseline.kind === "untracked" ? plan.baseline.requiredMinutes : 0;
    if (plan.kind === "holiday" || plan.kind === "company_off" || plan.kind === "compensatory_off") {
      // A paid day off for those who would have worked it.
      result.status = plan.kind === "holiday" ? "holiday" : "day_off";
      result.holidayMinutes = baselineMinutes;
      result.requiredMinutes = 0;
      trace.push(`${plan.kind}:${plan.name ?? ""}:paid_${baselineMinutes}min`);
    } else if (plan.kind === "untracked") {
      // FR-ATT-17: credited as worked unless leave or unpaid absence is recorded; never late, early or missing.
      result.status = fullLeave ? "leave" : "untracked";
      result.creditedMinutes = Math.max(0, required - leaveMinutes);
      trace.push(`untracked:credited_${result.creditedMinutes}min`);
      if (hasPunches) trace.push("untracked:punches_not_needed");
    } else if (plan.kind === "unscheduled") {
      result.status = "unscheduled";
      if (hasPunches) anomalies.push("no_schedule");
    } else result.status = "rest";

    if (plan.kind !== "untracked" || approvals.length > 0) {
      const breakOf = breakWindow(plan.baseline.segments, plan.baseline.breakMinutes, policy.breakStart);
      const extra = plan.kind === "untracked" ? [] : subtract(presence, breakOf && length(presence) >= 360 ? [breakOf] : []);
      countOvertime(extra);
      if (plan.kind !== "untracked" && hasPunches && length(extra) > 0 && result[category].day + result[category].night === 0 && result.otUnapprovedMinutes === 0) trace.push("presence:too_short_to_count");
      // Once the day is over: someone who has only just checked in on a Sunday is not an anomaly yet.
      if (plan.kind !== "untracked" && hasPunches && approvals.length === 0 && input.dayIsOver) anomalies.push("worked_on_day_off");
    }
    if (hasPunches && plan.kind !== "untracked" && input.dayIsOver && pairs.some((pair) => pair.in === null || pair.out === null)) {
      result.missingPunch = true;
      anomalies.push(pairs.some((pair) => pair.out === null) ? "missing_out" : "missing_in");
    }
    return result;
  }

  // ── A working day ───────────────────────────────────────────────────────────────────────────
  const breakOf = pause;
  const planned = blocks;
  const planEnd = planned.at(-1)!.end;
  let windows = workable;

  if (fullLeave) {
    result.status = "leave";
    if (hasPunches) {
      anomalies.push("worked_on_leave");
      trace.push("leave:full_day_but_punches_exist");
    }
    return result;
  }
  for (const leave of halfLeaves) windows = subtract(windows, [half(leave.portion as "am" | "pm")]);

  // Remote work: the covered part is credited; punches are only needed when the request says so.
  let remoteMinutes = 0;
  for (const remote of input.requests.remote) {
    if (remote.requiresPunch) {
      trace.push(`remote:${remote.kind}:${remote.portion}:punches_decide`);
      continue;
    }
    const covered = remote.portion === "full" ? windows : intersect(windows, [half(remote.portion)]);
    const minutes = plan.flexible ? Math.round((Math.max(0, required - leaveMinutes) * (remote.portion === "full" ? 100 : 50)) / 100) : length(covered);
    windows = subtract(windows, covered);
    remoteMinutes += minutes;
    if (remote.kind === "wfh") result.wfhMinutes += minutes;
    else result.tripMinutes += minutes;
    trace.push(`remote:${remote.kind}:${remote.portion}:credited_${minutes}min`);
  }
  result.creditedMinutes = remoteMinutes;
  const expected = Math.max(0, required - leaveMinutes - remoteMinutes);

  if (!input.dayIsOver) {
    result.status = "in_progress";
    if (plan.flexible) result.workedMinutes = Math.min(expected, length(subtract(presence, breakOf ? [breakOf] : [])));
    else result.workedMinutes = length(intersect(presence, windows));
    return result;
  }

  const hoursLeave = input.leave.filter((leave) => leave.portion === "hours").reduce((total, leave) => total + (leave.minutes ?? 0), 0);
  if (expected > 0 && windows.length > 0) {
    const expectedStart = windows[0].start;
    const expectedEnd = windows.at(-1)!.end;
    if (pairs.some((pair) => pair.in === null || pair.out === null)) {
      result.missingPunch = true;
      anomalies.push(pairs.some((pair) => pair.out === null) ? "missing_out" : "missing_in");
      trace.push("punches:incomplete:worked_time_unknown");
    }

    if (!hasPunches) {
      anomalies.push("absent");
      trace.push("no_punches");
    } else {
      // Late and early, measured against the expected block; hours of leave forgive as much.
      let forgiven = hoursLeave;
      const forgive = (minutes: number) => {
        const used = Math.min(forgiven, minutes);
        forgiven -= used;
        return minutes - used;
      };
      let graceIn = 0;
      let graceOut = 0;
      if (result.firstIn !== null && result.firstIn > expectedStart) {
        const late = forgive(result.firstIn - expectedStart);
        if (late > 0 && late <= policy.graceLateMinutes) {
          graceIn = late;
          trace.push(`late:${late}min:within_grace_${policy.graceLateMinutes}`);
        } else if (late > 0) {
          result.lateMinutes = late;
          anomalies.push("late");
          trace.push(`late:${late}min:in_${hhmm(result.firstIn)}_expected_${hhmm(expectedStart)}`);
        }
      }
      if (result.lastOut !== null && result.lastOut < expectedEnd && !result.missingPunch) {
        const early = forgive(expectedEnd - result.lastOut);
        if (early > 0 && early <= policy.graceEarlyMinutes) {
          graceOut = early;
          trace.push(`early:${early}min:within_grace_${policy.graceEarlyMinutes}`);
        } else if (early > 0) {
          result.earlyMinutes = early;
          anomalies.push("early");
          trace.push(`early:${early}min:out_${hhmm(result.lastOut)}_expected_${hhmm(expectedEnd)}`);
        }
      }

      if (plan.flexible) {
        // Core hours give late and early; the day's total is what has to be worked.
        const total = length(subtract(presence, breakOf ? [breakOf] : []));
        result.workedMinutes = Math.min(expected, total + graceIn + graceOut);
        if (!result.missingPunch && result.workedMinutes < expected) {
          anomalies.push("short_hours");
          trace.push(`flexible:worked_${total}min_of_${expected}`);
        }
        // Whatever exceeds the day's total is extra time, taken from the end of the day.
        countOvertime(total > expected && result.lastOut !== null ? [{ start: result.lastOut - (total - expected), end: result.lastOut }] : []);
      } else {
        result.workedMinutes = Math.min(expected, length(intersect(presence, windows)) + graceIn + graceOut);
        // Before the first block, after the last, and between the blocks of a split shift is extra time; the break is not.
        const extra = subtract(presence, [...planned, ...(breakOf ? [breakOf] : [])]);
        countOvertime(extra, intersect(extra, [{ start: planEnd, end: planEnd + 1440 }]));
      }
      result.nightMinutes = length(intersect(intersect(presence, windows), nights));
    }
  } else if (hasPunches) countOvertime(subtract(presence, planned), intersect(subtract(presence, planned), [{ start: planEnd, end: planEnd + 1440 }]));
  else if (approvals.length > 0) countOvertime([]);

  result.absenceMinutes = Math.max(0, expected - result.workedMinutes);
  if (expected === 0) result.status = halfLeaves.length > 0 && remoteMinutes === 0 ? "leave" : "remote";
  else if (!hasPunches) result.status = leaveMinutes + remoteMinutes > 0 ? "partial" : "absent";
  else result.status = leaveMinutes > 0 || result.absenceMinutes > 0 || result.missingPunch ? "partial" : "present";
  if (result.status === "present" && remoteMinutes > 0 && result.workedMinutes === 0) result.status = "remote";
  return result;
}

// ── A month of days ─────────────────────────────────────────────────────────────────────────

export type MonthSummary = {
  days: number;
  /** Days the month asks of the person: working and untracked days, holidays that fell on one included. */
  standardDays: number;
  standardMinutes: number;
  workedMinutes: number;
  creditedMinutes: number;
  leavePaidMinutes: number;
  leaveUnpaidMinutes: number;
  holidayMinutes: number;
  absenceMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  lateCount: number;
  earlyCount: number;
  missingPunchDays: number;
  absentDays: number;
  wfhMinutes: number;
  tripMinutes: number;
  nightMinutes: number;
  otWeekday: OtMinutes;
  otRestDay: OtMinutes;
  otHoliday: OtMinutes;
  otTotalMinutes: number;
  otUnapprovedMinutes: number;
  otTimeOffMinutes: number;
  /** Hundredths of a day: each day's paid minutes over what that day asked. */
  paidDaysCenti: number;
  unpaidDaysCenti: number;
  anomalyDays: number;
};

export type SummaryDay = Pick<
  TimesheetDayResult,
  "requiredMinutes" | "workedMinutes" | "creditedMinutes" | "leavePaidMinutes" | "leaveUnpaidMinutes" | "holidayMinutes" | "absenceMinutes" | "lateMinutes" | "earlyMinutes" | "missingPunch" | "wfhMinutes" | "tripMinutes" | "nightMinutes" | "otWeekday" | "otRestDay" | "otHoliday" | "otUnapprovedMinutes" | "otTimeOffMinutes" | "status" | "anomalies"
>;

export function summariseDays(days: readonly SummaryDay[]): MonthSummary {
  const summary: MonthSummary = {
    days: days.length, standardDays: 0, standardMinutes: 0, workedMinutes: 0, creditedMinutes: 0, leavePaidMinutes: 0, leaveUnpaidMinutes: 0, holidayMinutes: 0, absenceMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
    lateCount: 0, earlyCount: 0, missingPunchDays: 0, absentDays: 0, wfhMinutes: 0, tripMinutes: 0, nightMinutes: 0, otWeekday: { day: 0, night: 0 }, otRestDay: { day: 0, night: 0 }, otHoliday: { day: 0, night: 0 },
    otTotalMinutes: 0, otUnapprovedMinutes: 0, otTimeOffMinutes: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, anomalyDays: 0,
  };
  for (const day of days) {
    // What the day asked: its required minutes, or the paid day off that replaced them.
    const asked = day.requiredMinutes + day.holidayMinutes;
    if (asked > 0) {
      summary.standardDays += 1;
      summary.standardMinutes += asked;
      const paid = day.workedMinutes + day.creditedMinutes + day.leavePaidMinutes + day.holidayMinutes;
      summary.paidDaysCenti += Math.round((Math.min(asked, paid) * 100) / asked);
      summary.unpaidDaysCenti += Math.round((Math.min(asked, day.leaveUnpaidMinutes + day.absenceMinutes) * 100) / asked);
    }
    for (const key of ["workedMinutes", "creditedMinutes", "leavePaidMinutes", "leaveUnpaidMinutes", "holidayMinutes", "absenceMinutes", "lateMinutes", "earlyMinutes", "wfhMinutes", "tripMinutes", "nightMinutes", "otUnapprovedMinutes", "otTimeOffMinutes"] as const) summary[key] += day[key];
    for (const key of ["otWeekday", "otRestDay", "otHoliday"] as const) {
      summary[key] = { day: summary[key].day + day[key].day, night: summary[key].night + day[key].night };
      summary.otTotalMinutes += day[key].day + day[key].night;
    }
    if (day.lateMinutes > 0) summary.lateCount += 1;
    if (day.earlyMinutes > 0) summary.earlyCount += 1;
    if (day.missingPunch) summary.missingPunchDays += 1;
    if (day.status === "absent") summary.absentDays += 1;
    if (day.anomalies.length > 0) summary.anomalyDays += 1;
  }
  return summary;
}
