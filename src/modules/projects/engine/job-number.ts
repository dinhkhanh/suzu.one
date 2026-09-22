// Job numbers (FR-PJM-02): "SZM-26-042" — the entity's code, the year, a running number per
// prefix and year. Pure. The scheme is a function of its parts so it can become configuration per
// entity later (SRS Q20) without touching the counter that hands the numbers out.
import type { IsoDate } from "@/lib/dates";

/** A project of the whole group (no entity) numbers under the group's own prefix. */
export const GROUP_JOB_PREFIX = "SZ";

/** The entity's code as a prefix: upper-case letters and digits only, so a number is safe in a file name. */
export function jobPrefix(entityCode: string | null | undefined): string {
  const cleaned = (entityCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || GROUP_JOB_PREFIX;
}

/** The calendar year a project is numbered in: the Vietnam date it was numbered on. */
export const jobYear = (date: IsoDate): number => Number(date.slice(0, 4));

/** At least three digits; the thousandth project of a year simply gets a fourth. */
export function formatJobNumber(parts: { prefix: string; year: number; sequence: number }): string {
  return `${parts.prefix}-${String(parts.year % 100).padStart(2, "0")}-${String(parts.sequence).padStart(3, "0")}`;
}
