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

export type PastPeriodPlan =
  // A new closed row; neighbours it runs into give way at the edge they share with it.
  | { kind: "insert"; shortenId: string | null; shortenTo: IsoDate | null; delayId: string | null; delayFrom: IsoDate | null }
  // Exactly the dates of a closed row already on file: that row is corrected.
  | { kind: "replace"; id: string }
  | { kind: "rejected"; reason: "not_ended" | "before_employment_start" | "after_employment_end" | "covers_recorded_period" | "inside_recorded_period" | "moves_recorded_event" };

/**
 * Where a period that has already ended goes into an employment's history — for writing down, at
 * roll-out, where someone sat before the system knew them. The new period wins the days it
 * covers: a row it starts inside ends the day before it, and a row it ends inside starts the day
 * after it. It never splits a row in two or swallows one whole (that is a correction of that row),
 * and never moves the start of a row whose start is a transfer or promotion on the timeline
 * (`pinned`). Periods are best entered oldest first. Pure.
 */
export function planPastPeriod(
  employment: { startDate: IsoDate; endDate: IsoDate | null },
  existing: readonly Period[],
  period: { validFrom: IsoDate; validTo: IsoDate },
  today: IsoDate,
  pinned: ReadonlySet<string> = new Set(),
): PastPeriodPlan {
  const { validFrom, validTo } = period;
  if (validTo >= today) return { kind: "rejected", reason: "not_ended" };
  if (validFrom < employment.startDate) return { kind: "rejected", reason: "before_employment_start" };
  if (employment.endDate && validTo > employment.endDate) return { kind: "rejected", reason: "after_employment_end" };

  const same = existing.find((row) => row.validFrom === validFrom && row.validTo === validTo);
  if (same) return { kind: "replace", id: same.id };

  const plan = { kind: "insert" as const, shortenId: null as string | null, shortenTo: null as IsoDate | null, delayId: null as string | null, delayFrom: null as IsoDate | null };
  for (const row of existing) {
    const rowEnd = row.validTo ?? "9999-12-31";
    if (rowEnd < validFrom || row.validFrom > validTo) continue;
    const startsBefore = row.validFrom < validFrom;
    const endsAfter = rowEnd > validTo;
    if (startsBefore && endsAfter) return { kind: "rejected", reason: "inside_recorded_period" };
    if (!startsBefore && !endsAfter) return { kind: "rejected", reason: "covers_recorded_period" };
    if (startsBefore) Object.assign(plan, { shortenId: row.id, shortenTo: addDays(validFrom, -1) });
    else if (pinned.has(row.id)) return { kind: "rejected", reason: "moves_recorded_event" };
    else Object.assign(plan, { delayId: row.id, delayFrom: addDays(validTo, 1) });
  }
  return plan;
}
