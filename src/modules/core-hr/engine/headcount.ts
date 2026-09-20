// Headcount figures (FR-RPT-02): pure counting over employment spans. The service decides which
// spans the viewer may count; nothing here knows about people beyond the facts being grouped.
import { addDays, type IsoDate } from "@/lib/dates";

/** One employment period with the placement that was in force (on the report date, or when it ended). */
export type Span = {
  personId: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  seniorityDate: IsoDate;
  entity: string | null;
  department: string | null;
  workforceType: string | null;
  gender: string | null;
  dateOfBirth: IsoDate | null;
};

export const AGE_BANDS = ["under_25", "25_34", "35_44", "45_54", "55_plus", "unknown"] as const;
export const SENIORITY_BANDS = ["under_1", "1_3", "3_5", "5_10", "10_plus"] as const;

/** Whole years from `from` to `on`, the way birthdays and work anniversaries count. */
export function yearsBetween(from: IsoDate, on: IsoDate): number {
  const years = Number(on.slice(0, 4)) - Number(from.slice(0, 4));
  return on.slice(5) < from.slice(5) ? years - 1 : years;
}

export function ageBand(dateOfBirth: IsoDate | null, on: IsoDate): (typeof AGE_BANDS)[number] {
  if (!dateOfBirth) return "unknown";
  const age = yearsBetween(dateOfBirth, on);
  return age < 25 ? "under_25" : age < 35 ? "25_34" : age < 45 ? "35_44" : age < 55 ? "45_54" : "55_plus";
}

export function seniorityBand(seniorityDate: IsoDate, on: IsoDate): (typeof SENIORITY_BANDS)[number] {
  const years = yearsBetween(seniorityDate, on);
  return years < 1 ? "under_1" : years < 3 ? "1_3" : years < 5 ? "3_5" : years < 10 ? "5_10" : "10_plus";
}

/** On the books on that day: started, and not past the last day (which is inclusive). */
export const employedOn = (span: Pick<Span, "startDate" | "endDate">, on: IsoDate): boolean => span.startDate <= on && (span.endDate === null || span.endDate >= on);

export type Count = { key: string; count: number };

/** Largest group first; ties by key so the output is stable. `order` fixes the order instead (bands). */
export function countBy<T>(rows: readonly T[], keyOf: (row: T) => string | null, order?: readonly string[]): Count[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row) ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const list = [...counts].map(([key, count]) => ({ key, count }));
  if (order) return order.filter((key) => counts.has(key)).map((key) => ({ key, count: counts.get(key)! }));
  return list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export type HeadcountSnapshot = { asOf: IsoDate; total: number; byEntity: Count[]; byDepartment: Count[]; byWorkforceType: Count[]; byGender: Count[]; byAge: Count[]; bySeniority: Count[] };

export function headcountSnapshot(spans: readonly Span[], asOf: IsoDate): HeadcountSnapshot {
  const present = spans.filter((span) => employedOn(span, asOf));
  return {
    asOf,
    total: present.length,
    byEntity: countBy(present, (span) => span.entity),
    byDepartment: countBy(present, (span) => span.department),
    byWorkforceType: countBy(present, (span) => span.workforceType),
    byGender: countBy(present, (span) => span.gender),
    byAge: countBy(present, (span) => ageBand(span.dateOfBirth, asOf), AGE_BANDS),
    bySeniority: countBy(present, (span) => seniorityBand(span.seniorityDate, asOf), SENIORITY_BANDS),
  };
}

export type Movement = { from: IsoDate; to: IsoDate; opening: number; closing: number; joiners: number; leavers: number; /** Leavers ÷ average headcount, in basis points (1234 = 12.34%). null when nobody was employed. */ turnoverBp: number | null; joinersByDepartment: Count[]; leaversByDepartment: Count[] };

/**
 * Joiners start within the period; leavers have their last day within it. Opening headcount is
 * the day before the period, closing its last day; turnover uses their average, the usual HR
 * convention. Integer basis points: no floats in reported figures.
 */
export function movement(spans: readonly Span[], from: IsoDate, to: IsoDate): Movement {
  const within = (date: IsoDate | null) => date !== null && date >= from && date <= to;
  const joiners = spans.filter((span) => within(span.startDate));
  const leavers = spans.filter((span) => within(span.endDate));
  const opening = spans.filter((span) => employedOn(span, addDays(from, -1))).length;
  // The last day is a working day, so "closing" counts people still there the day after.
  const closing = spans.filter((span) => employedOn(span, addDays(to, 1)) && span.startDate <= to).length;
  const doubledAverage = opening + closing;
  return {
    from,
    to,
    opening,
    closing,
    joiners: joiners.length,
    leavers: leavers.length,
    turnoverBp: doubledAverage === 0 ? null : Math.round((leavers.length * 2 * 10_000) / doubledAverage),
    joinersByDepartment: countBy(joiners, (span) => span.department),
    leaversByDepartment: countBy(leavers, (span) => span.department),
  };
}
