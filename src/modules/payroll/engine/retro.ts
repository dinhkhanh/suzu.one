// Retroactive adjustments (FR-PAY-17). Pure.
//
// A month that has been paid is never re-opened (DR-07): its payslips, its insurance declaration
// and its PIT withholding stand. What a late-approved raise or a correction to a locked timesheet
// produces is a **difference**, carried into the next open run as its own line, taxed in the month
// it is paid. The rules this file follows, each one a decision an accountant must be able to read:
//
//   1. The difference is the difference in **gross earnings** of the source month, recomputed with
//      the same engine, the same statutory versions and the same catalogue as the original run
//      (`recalculate`). Employee insurance and PIT of the source month are not recomputed here.
//   2. Retro pay is **taxable income of the month it is paid** — the usual Vietnamese practice of
//      taxing on payment. It is not added to the insurance contribution base of either month.
//   3. When the source month's *insurance base* would have been different (a backdated raise),
//      payroll cannot put that right — it is a BHXH adjustment declaration. The item is flagged
//      `insuranceBaseChanged` so the statutory export (FR-PAY-35) can list it.
//
// Positive is money owed to the person (`RETRO_PAY`), negative is money to recover
// (`RETRO_RECOVERY`); both are lines of their own so a payslip never hides one inside a total.
import type { AdjustmentDeltas } from "@/modules/attendance/service";
import { findComponent, taxablePart } from "./components";
import type { PayLine, PersonPayInput, PersonPayResult, RetroItem, TraceStep } from "./types";

export const RETRO_PAY_CODE = "RETRO_PAY";
export const RETRO_RECOVERY_CODE = "RETRO_RECOVERY";

/**
 * One line per source month and direction, so a payslip shows "July: +1,200,000" rather than a
 * single figure nobody can check. Items of the same month and direction are added together.
 */
export function calculateRetroLines(input: PersonPayInput): { lines: PayLine[]; trace: TraceStep[] } {
  const lines: PayLine[] = [];
  const trace: TraceStep[] = [];
  const groups = new Map<string, { sourceMonth: string; amount: number; kinds: Set<string>; insuranceBaseChanged: boolean }>();

  for (const item of input.retro) {
    if (item.amount === 0) continue;
    const key = `${item.sourceMonth}:${item.amount > 0 ? "pay" : "recover"}`;
    const group = groups.get(key) ?? { sourceMonth: item.sourceMonth, amount: 0, kinds: new Set<string>(), insuranceBaseChanged: false };
    group.amount += item.amount;
    group.kinds.add(item.kind);
    group.insuranceBaseChanged ||= item.insuranceBaseChanged === true;
    groups.set(key, group);
  }

  for (const group of [...groups.values()].sort((a, b) => a.sourceMonth.localeCompare(b.sourceMonth) || b.amount - a.amount)) {
    if (group.amount === 0) continue;
    const owed = group.amount > 0;
    const component = findComponent(input.components, owed ? RETRO_PAY_CODE : RETRO_RECOVERY_CODE);
    if (!component) continue;
    const amount = Math.abs(group.amount);
    lines.push({
      code: component.code,
      kind: owed ? "earning" : "deduction",
      category: component.category,
      amount,
      // Taxed in the month it is paid; never part of this month's insurance base.
      taxable: owed ? taxablePart(component, amount) : 0,
      insurable: 0,
      rule: owed ? "retro_pay" : "retro_recovery",
      roundingRule: component.roundingRule,
      inputs: { amount, sourceMonthCount: 1 },
    });
    trace.push({ stage: "retro", rule: owed ? "retro_pay" : "retro_recovery", detail: { sourceMonth: group.sourceMonth, amount: group.amount, kinds: [...group.kinds].sort().join(","), insuranceBaseChanged: group.insuranceBaseChanged } });
  }

  return { lines, trace };
}

/** Does this run carry a difference whose insurance base the BHXH declaration must catch up on? */
export const insuranceAdjustmentNeeded = (items: readonly RetroItem[]): boolean => items.some((item) => item.insuranceBaseChanged === true && item.amount !== 0);

// ── Deriving a difference ───────────────────────────────────────────────────────────────────

export type RetroDifference = {
  sourceMonth: string;
  /** Gross earnings after − gross earnings before. Signed. */
  amount: number;
  /** Per component code, for the explanation: what changed and by how much. */
  byCode: { code: string; amount: number }[];
  /** The declared insurance base of the source month changed too — payroll cannot fix that here. */
  insuranceBaseChanged: boolean;
  /** How the two sides differ in employee insurance and PIT, for the note on the item. */
  employeeInsurance: number;
  pit: number;
};

/**
 * What changed between the result a month was paid on and the same month recomputed. Both sides
 * must be the **same person and month**, computed by the same engine version — the caller checks
 * that against the stored run context before trusting the figure.
 */
export function differenceBetween(before: PersonPayResult, after: PersonPayResult): RetroDifference {
  const sum = (result: PersonPayResult, code: string) => result.lines.filter((line) => line.code === code && line.kind === "earning").reduce((total, line) => total + line.amount, 0);
  const codes = [...new Set([...before.lines, ...after.lines].filter((line) => line.kind === "earning").map((line) => line.code))].sort();
  const byCode = codes.map((code) => ({ code, amount: sum(after, code) - sum(before, code) })).filter((entry) => entry.amount !== 0);
  return {
    sourceMonth: before.month,
    amount: after.totals.grossEarnings - before.totals.grossEarnings,
    byCode,
    insuranceBaseChanged: after.insurance.declaredBase !== before.insurance.declaredBase || after.insurance.covered !== before.insurance.covered,
    employeeInsurance: after.totals.employeeInsurance - before.totals.employeeInsurance,
    pit: after.totals.pit - before.totals.pit,
  };
}

/**
 * The input a locked month was calculated from, with a timesheet correction applied
 * (`timesheet_adjustment`, FR-ATT-14). Recalculating from this and comparing with what was paid
 * gives the money the correction is worth — exactly, by the same rules, without reading anything.
 *
 * Minutes and hundredths of a day are the attendance module's own units; `paidDaysCenti` also
 * moves the single segment the month was paid on, so a corrected day is paid as well as counted.
 */
export function applyAdjustmentDeltas(input: PersonPayInput, deltas: AdjustmentDeltas): PersonPayInput {
  const timesheet = input.timesheet;
  const add = (value: number, delta: number | undefined) => Math.max(0, value + (delta ?? 0));
  const paidDaysCenti = add(timesheet.paidDaysCenti, deltas.paidDaysCenti);
  const paidDelta = paidDaysCenti - timesheet.paidDaysCenti;

  return {
    ...input,
    timesheet: {
      ...timesheet,
      paidDaysCenti,
      workedMinutes: add(timesheet.workedMinutes, deltas.workedMinutes),
      nightMinutes: add(timesheet.nightMinutes, deltas.nightMinutes),
      unpaidDaysCenti: timesheet.unpaidDaysCenti,
      overtime: {
        weekday: { day: add(timesheet.overtime.weekday.day, deltas.otWeekdayMinutes), night: add(timesheet.overtime.weekday.night, deltas.otWeekdayNightMinutes) },
        restDay: { day: add(timesheet.overtime.restDay.day, deltas.otRestDayMinutes), night: add(timesheet.overtime.restDay.night, deltas.otRestDayNightMinutes) },
        holiday: { day: add(timesheet.overtime.holiday.day, deltas.otHolidayMinutes), night: add(timesheet.overtime.holiday.night, deltas.otHolidayNightMinutes) },
      },
    },
    // The corrected paid days land in the segment they belong to; with one segment (the ordinary
    // month) that is the whole month, and with several the last one in force.
    segments: spreadPaidDays(input.segments, paidDelta),
    // A recalculation of a past month carries no retro of its own and is never an off-cycle run.
    retro: [],
    priorInMonth: null,
    runKind: "regular",
  };
}

/**
 * The input a month was paid on, with different salary terms — how a raise approved after the
 * month was paid is valued (FR-PAY-17).
 *
 * Everything else is the input **exactly as it was paid**: the same attendance, the same leave,
 * the same dependants, the same bonuses and advances typed into that run. So the difference that
 * comes out is the change to the salary and nothing else — not a bonus counted twice, not a
 * deduction quietly dropped.
 */
export function withSegments(input: PersonPayInput, segments: PersonPayInput["segments"]): PersonPayInput {
  return { ...input, segments: segments.length > 0 ? segments : input.segments };
}

/** Adds a correction's paid days to the segment covering the corrected time — the last, without a date. */
function spreadPaidDays(segments: PersonPayInput["segments"], deltaCenti: number): PersonPayInput["segments"] {
  if (deltaCenti === 0 || segments.length === 0) return segments;
  return segments.map((segment, index) => (index === segments.length - 1 ? { ...segment, paidDaysCenti: Math.max(0, segment.paidDaysCenti + deltaCenti) } : segment));
}
