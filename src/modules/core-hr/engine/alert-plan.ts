// Which countdown alerts are due today (FR-CHR-05, FR-CHR-08). Pure; thresholds come from the
// "hr.alert_thresholds" parameter.
import type { IsoDate } from "@/lib/dates";
import { daysBetween } from "./contract-rules";

export type AlertSubject<Kind extends string> = { kind: Kind; subjectId: string; dueOn: IsoDate };
export type DueAlert<Kind extends string> = AlertSubject<Kind> & { thresholdDays: number; daysLeft: number };

/**
 * The tightest threshold each subject has reached. A contract entered 20 days before it ends gets
 * the "30 days" alert once — not 45 and 30 — and a job that missed a day still sends the next day.
 * Nothing is sent for dates already past: by then it is a report line, not a warning.
 */
export function dueAlerts<Kind extends string>(today: IsoDate, subjects: readonly AlertSubject<Kind>[], thresholds: Record<Kind, readonly number[]>): DueAlert<Kind>[] {
  const due: DueAlert<Kind>[] = [];
  for (const subject of subjects) {
    const daysLeft = daysBetween(today, subject.dueOn);
    if (daysLeft < 0) continue;
    const reached = thresholds[subject.kind].filter((threshold) => daysLeft <= threshold);
    if (reached.length) due.push({ ...subject, thresholdDays: Math.min(...reached), daysLeft });
  }
  return due;
}
