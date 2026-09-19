// How a new primary assignment fits into an employment's effective-dated history. Pure.
import { addDays, type IsoDate } from "@/lib/dates";

export type Period = { id: string; validFrom: IsoDate; validTo: IsoDate | null };

export type AssignmentPlan =
  // Nothing to touch: the new row starts after every existing one.
  | { kind: "insert" }
  // Same start date as the open row: a correction, so that row is rewritten rather than closed.
  | { kind: "replace"; id: string }
  // The open row ends the day before the new one starts.
  | { kind: "succeed"; closeId: string; closeOn: IsoDate }
  | { kind: "rejected"; reason: "before_employment_start" | "after_employment_end" | "before_current_assignment" };

export function planAssignmentChange(
  employment: { startDate: IsoDate; endDate: IsoDate | null },
  existing: readonly Period[],
  validFrom: IsoDate,
): AssignmentPlan {
  if (validFrom < employment.startDate) return { kind: "rejected", reason: "before_employment_start" };
  if (employment.endDate && validFrom > employment.endDate) return { kind: "rejected", reason: "after_employment_end" };

  const latest = existing.reduce<Period | null>((best, period) => (!best || period.validFrom > best.validFrom ? period : best), null);
  if (!latest) return { kind: "insert" };

  // History is only ever extended or corrected at its tip; rewriting the middle would silently
  // change what past timesheets and payslips were based on.
  if (validFrom < latest.validFrom) return { kind: "rejected", reason: "before_current_assignment" };
  if (validFrom === latest.validFrom) return { kind: "replace", id: latest.id };
  if (latest.validTo !== null && latest.validTo < validFrom) return { kind: "insert" };
  return { kind: "succeed", closeId: latest.id, closeOn: addDays(validFrom, -1) };
}

/** The period in force on `date`, if any. */
export function periodOn<T extends Period>(periods: readonly T[], date: IsoDate): T | undefined {
  return periods.find((period) => period.validFrom <= date && (period.validTo === null || period.validTo >= date));
}
