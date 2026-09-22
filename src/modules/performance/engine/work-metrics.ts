// KPI actuals measured from work (FR-PJM-62). Pure: the job reads one person's month (or quarter)
// of PJM data as counts and asks these functions for the figure it proposes. Nothing here scores:
// the proposal waits for the KPI's scorer, who confirms it or types their own.
//
// Figures come back in the stored scale of their unit (`scaleOf`): hundredths for numbers and
// percentages, so 87.5 % is 8750 and 2.25 revision rounds is 225. A metric with no basis in the
// period — no dated task finished, no working day, no report asked for — proposes nothing rather
// than a zero nobody earned.
import { type WorkMetric } from "../enums";

type IsoDate = string;

export type WorkFacts = {
  /** Tasks the person was assigned that were completed in the period and had a due date. */
  completedDated: number;
  /** Of those, completed on or before the due date. */
  completedOnTime: number;
  /** Tasks the person was assigned that were completed in the period (dated or not). */
  completedTasks: number;
  /** Revision rounds over those completed tasks. */
  revisionRounds: number;
  /** Distinct tasks of the person whose deliverable was approved (internally or by the client) in the period. */
  deliverablesAccepted: number;
  /** Minutes the person logged in the period. */
  loggedMinutes: number;
  /** Minutes the person's schedule made available in the period, less leave (`availableMinutesOf`). */
  availableMinutes: number;
  /** Days an end-of-day report was required of the person, and of those, days one was submitted. */
  reportsRequired: number;
  reportsSubmitted: number;
};

export const EMPTY_WORK_FACTS: WorkFacts = { completedDated: 0, completedOnTime: 0, completedTasks: 0, revisionRounds: 0, deliverablesAccepted: 0, loggedMinutes: 0, availableMinutes: 0, reportsRequired: 0, reportsSubmitted: 0 };

/** part ÷ whole as a percentage in hundredths (87.5 % → 8750); null when there is no whole. */
const percentHundredths = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 10_000) : null);

/** The figure a work metric proposes, in the stored scale of its unit; null = nothing to propose. */
export function workMetricValue(metric: WorkMetric, facts: WorkFacts): number | null {
  switch (metric) {
    case "on_time_rate":
      return percentHundredths(facts.completedOnTime, facts.completedDated);
    case "deliverables_accepted":
      // A count is always a figure: a month with nothing accepted is a real zero, not a gap.
      return facts.deliverablesAccepted * 100;
    case "utilisation":
      return percentHundredths(facts.loggedMinutes, facts.availableMinutes);
    case "revision_rounds_avg":
      return facts.completedTasks > 0 ? Math.round((facts.revisionRounds / facts.completedTasks) * 100) : null;
    case "eod_compliance":
      return percentHundredths(Math.min(facts.reportsSubmitted, facts.reportsRequired), facts.reportsRequired);
  }
}

/** Attendance's day kinds, repeated so this engine stays free of other modules. */
export type DayKind = "working" | "untracked" | "rest" | "holiday" | "compensatory_off" | "company_off" | "unscheduled";

const isWeekday = (date: IsoDate) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/**
 * Minutes available for work over some days, the utilisation rule of FR-PJM-61: a working day's
 * scheduled minutes (already less any leave), an unscheduled weekday as a working day, and nothing
 * for untracked Saturdays, rest days and the calendar's days off.
 */
export function availableMinutesOf(days: readonly { date: IsoDate; kind: DayKind; minutes: number }[]): number {
  return days.reduce((sum, day) => sum + (day.kind === "working" || (day.kind === "unscheduled" && isWeekday(day.date)) ? Math.max(0, day.minutes) : 0), 0);
}

/** The first and last day of a KPI period: a month ("2026-09") or a quarter ("2026-Q3"). */
export function periodRange(periodKey: string): { from: IsoDate; to: IsoDate } {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  const [year, firstMonth, lastMonth] = quarter ? [Number(quarter[1]), (Number(quarter[2]) - 1) * 3 + 1, Number(quarter[2]) * 3] : [Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)), Number(periodKey.slice(5, 7))];
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return { from: `${year}-${pad(firstMonth)}-01`, to: `${year}-${pad(lastMonth)}-${pad(lastDay)}` };
}

/** The month before today's ("2026-10-02" → "2026-09"): the month the job proposes for. */
export function previousMonth(today: IsoDate): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** The job's window: the 1st to the 3rd of a month, so a missed morning is caught up and the rest of the month is quiet. */
export const isProposalDay = (today: IsoDate): boolean => Number(today.slice(8, 10)) <= 3;
