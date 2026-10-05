// When a probation review opens and falls due (FR-PRF-03). Pure.
//
// The days are not decided here: they are the company's probation-ending countdown
// (`hr.alert_thresholds.probationEndDays`, the same days HR's own alert fires on; [10, 3] today),
// so the review and the reminder to decide the probation arrive together. The law wants the result
// announced before the probation ends (Labour Code 2019, art. 27), so the manager's deadline is the
// last of those days and the person's own review falls halfway between the opening and it:
//
//   opens        last day − the longest countdown        (10 days before)
//   self due     last day − ⌈(longest + shortest) / 2⌉   (7 days before)
//   manager due  last day − the shortest countdown       (3 days before)
//
// Somebody enrolled late — a cycle launched after their countdown began — is never given a
// deadline already past: both are moved up to today, the manager's never before the person's.
import { addDays, type IsoDate } from "@/lib/dates";

export type ProbationReviewDates = { opensOn: IsoDate; selfDueOn: IsoDate; managerDueOn: IsoDate };

export function probationReviewDates(lastDay: IsoDate, countdownDays: readonly number[], today: IsoDate): ProbationReviewDates {
  if (countdownDays.length === 0) throw new Error("probation countdown has no days");
  const longest = Math.max(...countdownDays);
  const shortest = Math.min(...countdownDays);
  const notBefore = (date: IsoDate, floor: IsoDate) => (date < floor ? floor : date);
  const selfDueOn = notBefore(addDays(lastDay, -Math.ceil((longest + shortest) / 2)), today);
  const managerDueOn = notBefore(addDays(lastDay, -shortest), selfDueOn);
  return { opensOn: addDays(lastDay, -longest), selfDueOn, managerDueOn };
}

/** The longest countdown: how far ahead of its last day a probation is looked for. */
export const probationLookahead = (countdownDays: readonly number[]): number => Math.max(...countdownDays);
