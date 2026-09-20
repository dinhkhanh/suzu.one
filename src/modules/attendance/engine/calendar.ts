// What a person is expected to do on a date (FR-ATT-01, 02, 17). Pure: no I/O.
//
// Inputs are plain data: the person's schedule pattern, the calendar rows of their entity for the
// date, and their roster entry if any. The answer — a DayPlan — is what the leave module counts
// working days with and what the timesheet engine compares punches against.
import type { IsoDate } from "@/lib/dates";

/** "HH:MM". An `end` that is not after `start` runs past midnight into the next day. */
export type Segment = { start: string; end: string };

export type DayRule =
  /** Hours to be present. `flexible`: the segments are core hours and `requiredMinutes` the daily total. */
  | { type: "working"; segments: Segment[]; breakMinutes: number; flexible?: boolean; requiredMinutes?: number }
  /** A working day without punches (Saturday WFH, FR-ATT-17): credited as worked unless leave or absence is recorded. */
  | { type: "untracked"; creditMinutes: number }
  | { type: "off" };

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SchedulePattern = {
  days: Record<Weekday, DayRule>;
  /** Alternate weeks: in weeks an odd number of weeks away from `anchor`, `weekday` follows `rule` instead. */
  alternate?: { weekday: Weekday; anchor: IsoDate; rule: DayRule }[];
};

export type CalendarDayKind = "public_holiday" | "compensatory_off" | "company_off" | "working_override";
export type CalendarDay = { date: IsoDate; entityId: string | null; kind: CalendarDayKind; name: string };
export type RosterEntry = { date: IsoDate; /** null = rostered off. */ shift: { id: string; segments: Segment[]; breakMinutes: number } | null };

export type PlannedSegment = { /** Minutes from the date's midnight; `end` is above 1440 when the segment runs into the next day. */ start: number; end: number };

export type DayPlanKind = "working" | "untracked" | "rest" | "holiday" | "compensatory_off" | "company_off" | "unscheduled";

export type DayExpectation = { kind: DayPlanKind; segments: PlannedSegment[]; breakMinutes: number; requiredMinutes: number; flexible: boolean };

export type DayPlan = DayExpectation & {
  date: IsoDate;
  /** The holiday's or day off's name, when the calendar decided the day. */
  name: string | null;
  shiftId: string | null;
  /** What the day would have been without the calendar row — for holiday pay and holiday work. */
  baseline: DayExpectation;
  /** Why, in order: for the timesheet's explanation trace. */
  trace: string[];
};

export const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export function isoWeekday(date: IsoDate): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function planSegments(segments: readonly Segment[]): PlannedSegment[] {
  return segments.map((segment) => {
    const start = minutesOf(segment.start);
    const end = minutesOf(segment.end);
    return { start, end: end > start ? end : end + 1440 };
  });
}

const NOTHING = (kind: DayPlanKind): DayExpectation => ({ kind, segments: [], breakMinutes: 0, requiredMinutes: 0, flexible: false });

function expectationOf(rule: DayRule): DayExpectation {
  if (rule.type === "off") return NOTHING("rest");
  if (rule.type === "untracked") return { kind: "untracked", segments: [], breakMinutes: 0, requiredMinutes: rule.creditMinutes, flexible: false };
  const segments = planSegments(rule.segments);
  const span = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
  return { kind: "working", segments, breakMinutes: rule.breakMinutes, requiredMinutes: rule.flexible && rule.requiredMinutes ? rule.requiredMinutes : Math.max(0, span - rule.breakMinutes), flexible: !!rule.flexible };
}

/** The weekly pattern's rule for a date, alternate weeks included. */
export function ruleFor(pattern: SchedulePattern, date: IsoDate): { rule: DayRule; alternate: boolean } {
  const weekday = isoWeekday(date);
  const alternate = pattern.alternate?.find((entry) => entry.weekday === weekday);
  // Counted in calendar weeks (Monday to Sunday), so the anchor may be any day of a "normal" week.
  if (alternate) {
    const weeks = (daysBetween(alternate.anchor, date) - (weekday - isoWeekday(alternate.anchor))) / 7;
    if (Math.abs(weeks) % 2 === 1) return { rule: alternate.rule, alternate: true };
  }
  return { rule: pattern.days[weekday], alternate: false };
}

/** The calendar row that applies to an entity on a date: its own, else the group's. */
export function calendarRowFor(rows: readonly CalendarDay[], date: IsoDate, entityId: string | null): CalendarDay | null {
  const onDate = rows.filter((row) => row.date === date && (row.entityId === null || row.entityId === entityId));
  return onDate.find((row) => row.entityId !== null) ?? onDate[0] ?? null;
}

export type DayPlanInput = { date: IsoDate; entityId: string | null; pattern: SchedulePattern | null; calendar: readonly CalendarDay[]; roster?: RosterEntry | null };

export function dayPlan(input: DayPlanInput): DayPlan {
  const { date, pattern, roster } = input;
  const trace: string[] = [];
  let baseline: DayExpectation;
  let shiftId: string | null = null;

  if (roster) {
    // The roster is the most specific statement about the day.
    shiftId = roster.shift?.id ?? null;
    baseline = roster.shift ? expectationOf({ type: "working", segments: roster.shift.segments, breakMinutes: roster.shift.breakMinutes }) : NOTHING("rest");
    trace.push(roster.shift ? "roster:shift" : "roster:off");
  } else if (!pattern) {
    baseline = NOTHING("unscheduled");
    trace.push("no_schedule");
  } else {
    const { rule, alternate } = ruleFor(pattern, date);
    baseline = expectationOf(rule);
    trace.push(`pattern:${rule.type}${alternate ? ":alternate_week" : ""}`);
  }

  const row = calendarRowFor(input.calendar, date, input.entityId);
  if (!row) return { date, ...baseline, name: null, shiftId, baseline, trace };

  trace.push(`calendar:${row.kind}`);
  if (row.kind === "working_override") {
    // A make-up working day (the government swaps a weekday off for a Saturday): work like the
    // first ordinary working day of the pattern, unless the day is a working day already.
    if (baseline.kind === "working") return { date, ...baseline, name: row.name, shiftId, baseline, trace };
    const model = pattern ? ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => pattern.days[weekday]).find((rule) => rule.type === "working") : undefined;
    const expectation = model ? expectationOf(model) : baseline;
    return { date, ...expectation, name: row.name, shiftId, baseline, trace };
  }
  const kind: DayPlanKind = row.kind === "public_holiday" ? "holiday" : row.kind;
  return { date, ...NOTHING(kind), name: row.name, shiftId, baseline, trace };
}

export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let cursor = new Date(`${from}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

// ── Which schedule applies ──────────────────────────────────────────────────────────────────

export type AssignmentFact = { scope: "entity" | "department" | "person"; entityId: string | null; departmentId: string | null; personId: string | null; scheduleId: string; validFrom: IsoDate; validTo: IsoDate | null };
export type PersonPlace = { personId: string; entityId: string | null; departmentId: string | null };

/** The most specific assignment in force on a date: person › department in the entity › department › entity. */
export function assignmentFor(assignments: readonly AssignmentFact[], person: PersonPlace, date: IsoDate): AssignmentFact | null {
  const inForce = assignments.filter((row) => row.validFrom <= date && (row.validTo === null || row.validTo >= date));
  const rank = (row: AssignmentFact): number => {
    if (row.scope === "person") return row.personId === person.personId ? 4 : 0;
    if (row.scope === "department") {
      if (!person.departmentId || row.departmentId !== person.departmentId) return 0;
      if (row.entityId === null) return 2;
      return row.entityId === person.entityId ? 3 : 0;
    }
    return person.entityId && row.entityId === person.entityId ? 1 : 0;
  };
  let best: AssignmentFact | null = null;
  for (const row of inForce) if (rank(row) > (best ? rank(best) : 0)) best = row;
  return best;
}

// ── A pattern HR typed in ───────────────────────────────────────────────────────────────────

export type PatternProblem = "missing_weekday" | "bad_time" | "no_segments" | "segments_overlap" | "break_too_long" | "bad_credit" | "bad_required" | "no_working_day";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function ruleProblems(rule: DayRule | undefined): PatternProblem[] {
  if (!rule) return ["missing_weekday"];
  if (rule.type === "off") return [];
  if (rule.type === "untracked") return Number.isInteger(rule.creditMinutes) && rule.creditMinutes >= 0 && rule.creditMinutes <= 1440 ? [] : ["bad_credit"];
  if (rule.segments.length === 0) return ["no_segments"];
  if (rule.segments.some((segment) => !TIME.test(segment.start) || !TIME.test(segment.end))) return ["bad_time"];
  const planned = planSegments(rule.segments);
  const problems: PatternProblem[] = [];
  if (planned.some((segment, index) => index > 0 && segment.start < planned[index - 1].end) || planned.at(-1)!.end - planned[0].start > 1440) problems.push("segments_overlap");
  const span = planned.reduce((total, segment) => total + (segment.end - segment.start), 0);
  if (rule.breakMinutes < 0 || rule.breakMinutes >= span) problems.push("break_too_long");
  if (rule.flexible && (!rule.requiredMinutes || rule.requiredMinutes <= 0 || rule.requiredMinutes > 1440)) problems.push("bad_required");
  return problems;
}

export function patternProblems(pattern: SchedulePattern, kind: "fixed" | "flexible" | "shift"): PatternProblem[] {
  const problems = new Set<PatternProblem>();
  const weekdays = [1, 2, 3, 4, 5, 6, 7] as Weekday[];
  for (const weekday of weekdays) for (const problem of ruleProblems(pattern.days?.[weekday])) problems.add(problem);
  for (const entry of pattern.alternate ?? []) for (const problem of ruleProblems(entry.rule)) problems.add(problem);
  // A rostered schedule may be "off" all week: the roster says when people work.
  if (kind !== "shift" && problems.size === 0 && !weekdays.some((weekday) => pattern.days[weekday].type !== "off")) problems.add("no_working_day");
  return [...problems];
}
