// The rules of a person's day (FR-PJM-21, 22, 24): each work team sets its own, a person in several
// teams follows the strictest, and a day off is a day off. Pure: the service reads the team rows,
// the working calendar and approved leave, and asks these functions.
import type { RuleMode } from "../enums";

type IsoDate = string;

export type TeamRules = {
  planMode: RuleMode;
  reportMode: RuleMode;
  /** ISO weekdays the report is required on. */
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

/** SRS A10, A11: plan optional, report required Monday–Friday by 18:30, time logging optional. */
export const DEFAULT_TEAM_RULES: TeamRules = { planMode: "optional", reportMode: "required", reportDays: [1, 2, 3, 4, 5], planCutoff: "09:30", reportDeadline: "18:30", timeMode: "optional", timesheetApproval: false, coverMinDays: 2, cycleWeeks: null, cycleStart: null };

/** What one person follows: a team's rules without the team's own calendar (cycles). */
export type PersonRules = Omit<TeamRules, "cycleWeeks" | "cycleStart">;

/**
 * Someone in no work team has nobody to report to on a board: they may plan and report, nothing
 * asks them to (A11 turns the report on for every *team*).
 */
export const NO_TEAM_RULES: PersonRules = { planMode: "optional", reportMode: "optional", reportDays: [1, 2, 3, 4, 5], planCutoff: "09:30", reportDeadline: "18:30", timeMode: "optional", timesheetApproval: false, coverMinDays: 2 };

const RANK: Record<RuleMode, number> = { off: 0, optional: 1, required: 2 };
const strictest = (modes: readonly RuleMode[]): RuleMode => modes.reduce<RuleMode>((best, mode) => (RANK[mode] > RANK[best] ? mode : best), "off");
const earliest = (times: readonly string[]): string => [...times].sort()[0];

/**
 * The strictest of several teams' rules. A mode is the strictest of the teams'; the report days
 * and the deadline come from the teams that *require* the report (a team where it is optional
 * does not make its days mandatory), the earliest deadline winning; the same for the plan's
 * cut-off. Timesheet approval is on if any team approves; a cover plan is asked for from the
 * shortest leave any team asks it for.
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
    reportDays: [...new Set(reporting.flatMap((team) => team.reportDays))].sort((a, b) => a - b),
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
 * Is the end-of-day report required on this day (FR-PJM-22, A11)? Never on a holiday, a day of
 * full leave or a rest day. Otherwise on the weekdays the rules list: untracked Saturdays (D15)
 * are off because the default list stops at Friday — a team that lists Saturday asks for it.
 * Half a day of leave still leaves half a day to report on.
 */
export function reportRequirement(rules: PersonRules, day: DayFacts): Requirement {
  const off = dayOffReason(day);
  if (off) return { required: false, reason: off };
  if (rules.reportMode !== "required") return { required: false, reason: rules.reportMode };
  if (!rules.reportDays.includes(isoWeekday(day.date))) return { required: false, reason: day.kind === "untracked" ? "untracked" : "not_a_report_day" };
  return { required: true, reason: null };
}

/** The morning plan follows the report's days: there is no plan to make on a day nobody reports on. */
export function planRequirement(rules: PersonRules, day: DayFacts): Requirement {
  const off = dayOffReason(day);
  if (off) return { required: false, reason: off };
  if (rules.planMode !== "required") return { required: false, reason: rules.planMode };
  if (!rules.reportDays.includes(isoWeekday(day.date))) return { required: false, reason: day.kind === "untracked" ? "untracked" : "not_a_report_day" };
  return { required: true, reason: null };
}

/** The Today page says "enjoy your day off" instead of asking for a plan: holidays, leave, rest days and untracked days that nobody reports on. */
export function isDayOff(rules: PersonRules, day: DayFacts): boolean {
  if (dayOffReason(day)) return true;
  return day.kind === "untracked" && !rules.reportDays.includes(isoWeekday(day.date));
}
