// A period as the HR, money and report tools take it: two optional days, defaulting to a stretch
// that ends today. The model is told today's date in the turn's context, so "last quarter" or
// "năm nay" becomes two days it writes; a period written backwards is read the right way round.
import { z } from "zod";
import { addDays, type IsoDate } from "@/lib/dates";

export const PERIOD_INPUT = {
  from: z.iso.date().optional().describe("First day, YYYY-MM-DD. Default: see the tool."),
  to: z.iso.date().optional().describe("Last day, YYYY-MM-DD. Default: today."),
};

export type PeriodInput = { from?: string; to?: string };

/** The longest period a tool reads at once: two years, so one question cannot ask Postgres for a decade. */
const MAX_DAYS = 731;

export type DefaultStart = "month" | "year" | { daysBack: number };

const startOf = (today: IsoDate, start: DefaultStart): IsoDate => (start === "month" ? `${today.slice(0, 8)}01` : start === "year" ? `${today.slice(0, 4)}-01-01` : addDays(today, -start.daysBack));

/** The period asked for, or the default one; never longer than two years (the start moves up). */
export function periodOf(input: PeriodInput, today: IsoDate, start: DefaultStart): { from: IsoDate; to: IsoDate } {
  const to = (input.to ?? today) as IsoDate;
  const from = (input.from ?? startOf(to < today ? to : today, start)) as IsoDate;
  const [first, last] = from <= to ? [from, to] : [to, from];
  const earliest = addDays(last, -MAX_DAYS);
  return { from: first < earliest ? earliest : first, to: last };
}

/** Basis points (1234) as a percentage with two decimals (12.34); null stays null. */
export const percentOf = (basisPoints: number | null): number | null => (basisPoints === null ? null : Math.round(basisPoints) / 100);
