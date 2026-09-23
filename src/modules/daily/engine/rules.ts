// The rules of a person's day (FR-PJM-21, 22, 24): each work team sets its own, a person in several
// teams follows the strictest, and a day off is a day off. Pure: the service reads the team rows,
// the working calendar and approved leave, and asks these functions.
import type { RuleMode } from "../enums";

type IsoDate = string;

export type TeamRules = {
  planMode: RuleMode;
  reportMode: RuleMode;
  /**
   * The ISO weekdays a lead narrowed the report down to. Empty — the default — means no narrowing:
   * every day the person's own working calendar says they work (Q18, 2026-09-23).
   */
  reportDays: readonly number[];
  /** "HH:MM", Vietnam time. */
  planCutoff: string;
  reportDeadline: string;
  timeMode: RuleMode;
  timesheetApproval: boolean;
  coverMinDays: number;
  cycleWeeks: number | null;
  cycleStart: IsoDate | null;
};

/**
 * The owner's answers to Q17 and Q18 (2026-09-23): the morning plan and the end-of-day report are
 * required of everyone, every working day, the report by 23:00; time is logged in every team and
 * the week is approved by a lead. A team that never set its own rules follows these.
 */
export const DEFAULT_TEAM_RULES: TeamRules = { planMode: "required", reportMode: "required", reportDays: [], planCutoff: "09:30", reportDeadline: "23:00", timeMode: "required", timesheetApproval: true, coverMinDays: 2, cycleWeeks: null, cycleStart: null };

/** What one person follows: a team's rules without the team's own calendar (cycles). */
export type PersonRules = Omit<TeamRules, "cycleWeeks" | "cycleStart">;

/**
 * Someone in no work team follows the same company rules as everyone else (Q18): the day is asked
 * of the person, not of the team, and their line manager reads it and approves their week.
 */
export const NO_TEAM_RULES: PersonRules = { planMode: DEFAULT_TEAM_RULES.planMode, reportMode: DEFAULT_TEAM_RULES.reportMode, reportDays: DEFAULT_TEAM_RULES.reportDays, planCutoff: DEFAULT_TEAM_RULES.planCutoff, reportDeadline: DEFAULT_TEAM_RULES.reportDeadline, timeMode: DEFAULT_TEAM_RULES.timeMode, timesheetApproval: DEFAULT_TEAM_RULES.timesheetApproval, coverMinDays: DEFAULT_TEAM_RULES.coverMinDays };

const RANK: Record<RuleMode, number> = { off: 0, optional: 1, required: 2 };
const strictest = (modes: readonly RuleMode[]): RuleMode => modes.reduce<RuleMode>((best, mode) => (RANK[mode] > RANK[best] ? mode : best), "off");
const earliest = (times: readonly string[]): string => [...times].sort()[0];

/**
 * The strictest of several teams' rules. A mode is the strictest of the teams'; the report days
 * and the deadline come from the teams that *require* the report (a team where it is optional
 * does not make its days mandatory), the earliest deadline winning; the same for the plan's
 * cut-off. Timesheet approval is on if any team approves; a cover plan is asked for from the
 * shortest leave any team asks it for.
 *
 * The days merge the other way round from a list of allowed values: a team that narrowed the week
 * asks for fewer days than one that did not, so one team reporting every working day (the empty
 * list) leaves the person reporting every working day.
 */
export function mergeRules(teams: readonly TeamRules[]): PersonRules {
  if (teams.length === 0) return NO_TEAM_RULES;
  const reportMode = strictest(teams.map((team) => team.reportMode));
  const planMode = strictest(teams.map((team) => team.planMode));
  const reporting = teams.filter((team) => team.reportMode === reportMode);
  const planning = teams.filter((team) => team.planMode === planMode);
  return {
    planMode,
    reportMode,
    reportDays: reporting.some((team) => team.reportDays.length === 0) ? [] : [...new Set(reporting.flatMap((team) => team.reportDays))].sort((a, b) => a - b),
    planCutoff: earliest(planning.map((team) => team.planCutoff)),
    reportDeadline: earliest(reporting.map((team) => team.reportDeadline)),
    timeMode: strictest(teams.map((team) => team.timeMode)),
    timesheetApproval: teams.some((team) => team.timesheetApproval),
    coverMinDays: Math.min(...teams.map((team) => team.coverMinDays)),
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────────────────────

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the date's week. */
export function weekStartOf(date: IsoDate): IsoDate {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - (isoWeekday(date) - 1));
  return result.toISOString().slice(0, 10);
}

/** A time of day ("HH:MM", Vietnam) on a date, as an instant. */
export const instantOf = (date: IsoDate, time: string): Date => new Date(`${date}T${time}:00+07:00`);

/** Submitted after the deadline of the report's own day — or on any later day. */
export const isLate = (submittedAt: Date, date: IsoDate, deadline: string): boolean => submittedAt.getTime() > instantOf(date, deadline).getTime();

// ── Is anything asked of the person today? ──────────────────────────────────────────────────

/** Attendance's day kinds (DayPlanKind), repeated so this engine stays free of other modules. */
export type DayKind = "working" | "untracked" | "rest" | "holiday" | "compensatory_off" | "company_off" | "unscheduled";

export type DayFacts = {
  date: IsoDate;
  kind: DayKind;
  /** The holiday's or day off's name. */
  name: string | null;
  /** Approved leave: the whole day, or part of it (half a day, some hours). */
  leave: "full" | "part" | null;
};

export type NotRequiredReason = "holiday" | "leave" | "rest" | "untracked" | "not_a_report_day" | "optional" | "off";
export type Requirement = { required: boolean; reason: NotRequiredReason | null };

const CALENDAR_OFF: readonly DayKind[] = ["holiday", "compensatory_off", "company_off"];

/** A day the daily loop leaves alone, whatever the rules: a holiday, a day off, a rest day, a day of leave. */
export function dayOffReason(day: DayFacts): Extract<NotRequiredReason, "holiday" | "leave" | "rest"> | null {
  if (CALENDAR_OFF.includes(day.kind)) return "holiday";
  if (day.leave === "full") return "leave";
  if (day.kind === "rest") return "rest";
  return null;
}

/**
 * Does the person work on this day, as their own working calendar has it? A scheduled working day
 * does, and so does an untracked Saturday — D15 makes it a day of work from home, not a day off,
 * and Q18 asks for the day's report on it. A rest day, a holiday and a day off do not. When nobody
 * scheduled the person at all there is no calendar to follow, and the plain five-day week decides.
 */
export function worksOn(day: DayFacts): boolean {
  if (dayOffReason(day)) return false;
  if (day.kind === "unscheduled") return isoWeekday(day.date) <= 5;
  return true;
}

/** A lead narrowed the week down and this day is not in it (`reportDays` empty = no narrowing). */
const narrowedAway = (rules: PersonRules, day: DayFacts) => rules.reportDays.length > 0 && !rules.reportDays.includes(isoWeekday(day.date));

/**
 * Is the end-of-day report required on this day (FR-PJM-22, Q18)? Never on a holiday, a day of
 * full leave or a rest day. Otherwise on every day the person's own working calendar has them
 * working, an untracked Saturday (D15) included — unless a lead narrowed the team's week down to
 * certain weekdays. Half a day of leave still leaves half a day to report on.
 */
export function reportRequirement(rules: PersonRules, day: DayFacts): Requirement {
  const off = dayOffReason(day);
  if (off) return { required: false, reason: off };
  if (rules.reportMode !== "required") return { required: false, reason: rules.reportMode };
  if (!worksOn(day)) return { required: false, reason: "not_a_report_day" };
  if (narrowedAway(rules, day)) return { required: false, reason: day.kind === "untracked" ? "untracked" : "not_a_report_day" };
  return { required: true, reason: null };
}

/** The morning plan follows the report's days: there is no plan to make on a day nobody reports on. */
export function planRequirement(rules: PersonRules, day: DayFacts): Requirement {
  const off = dayOffReason(day);
  if (off) return { required: false, reason: off };
  if (rules.planMode !== "required") return { required: false, reason: rules.planMode };
  if (!worksOn(day)) return { required: false, reason: "not_a_report_day" };
  if (narrowedAway(rules, day)) return { required: false, reason: day.kind === "untracked" ? "untracked" : "not_a_report_day" };
  return { required: true, reason: null };
}

/** The Today page says "enjoy your day off" instead of asking for a plan: holidays, leave, rest days, and days the person's calendar or their team's narrowed week leaves alone. */
export function isDayOff(rules: PersonRules, day: DayFacts): boolean {
  if (!worksOn(day)) return true;
  return day.kind === "untracked" && narrowedAway(rules, day);
}
