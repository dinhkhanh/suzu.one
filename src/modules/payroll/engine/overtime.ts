// Stage 3 — overtime and night work (FR-PAY-15). Pure.
//
// The Labour Code sets the multipliers (150 / 200 / 300% and the night additions); they live in
// the statutory store, never here. What the company chooses is the *rate* they multiply: the base
// salary alone, or the base plus the allowances that count as salary (`payroll_policy`).
//
// Vietnamese practice, and the shape this follows:
//   hourly rate   = monthly pay rate ÷ (standard days × hours per day)
//   ordinary OT   = hours × rate × multiplier%
//   night work    = hours × rate × night premium% (ordinary hours worked at night)
//   night OT      = the OT multiplier, plus the night premium, plus the extra for OT at night
import { type ComponentDefinition, ENGINE_CODES, findComponent, taxablePart } from "./components";
import { ratio } from "./rounding";
import type { PayLine, PersonPayInput, TraceStep } from "./types";

export type OvertimeResult = {
  lines: PayLine[];
  hourlyRate: number;
  /** The part of overtime and night pay that equals ordinary-hours pay — taxable even when the premium is exempt. */
  ordinaryEquivalent: number;
  trace: TraceStep[];
};

/**
 * The hourly rate overtime is paid on. `standardDays × hoursPerDay` is the month's ordinary
 * working time; a month with no working days has no overtime to pay either.
 */
export function hourlyRate(monthlyPay: number, standardDays: number, hoursPerDay: number): number {
  const hours = standardDays * hoursPerDay;
  return hours > 0 ? ratio(monthlyPay, 1, hours, "half_up") : 0;
}

type Category = "weekday" | "restDay" | "holiday";

const CATEGORY_CODES: Record<Category, string> = { weekday: ENGINE_CODES.overtimeWeekday, restDay: ENGINE_CODES.overtimeRestDay, holiday: ENGINE_CODES.overtimeHoliday };

export function calculateOvertime(input: PersonPayInput, monthlyPayRate: number): OvertimeResult {
  const { statutory, policy, timesheet, components } = input;
  const multipliers = statutory.overtimeMultipliers;
  // The month's ordinary hours, not the person's: a joiner's overtime hour is worth the same
  // as everyone else's.
  const rate = hourlyRate(monthlyPayRate, input.period.standardDays, policy.hoursPerDay);
  const lines: PayLine[] = [];
  const trace: TraceStep[] = [];
  let ordinaryEquivalent = 0;
  if (rate === 0) return { lines, hourlyRate: rate, ordinaryEquivalent, trace };

  const categoryMultiplier: Record<Category, number> = { weekday: multipliers.weekday, restDay: multipliers.restDay, holiday: multipliers.holiday };

  for (const category of ["weekday", "restDay", "holiday"] as Category[]) {
    const minutes = timesheet.overtime[category];
    if (minutes.day + minutes.night === 0) continue;
    const component = findComponent(components, CATEGORY_CODES[category]);
    if (!component) continue;
    const multiplier = categoryMultiplier[category];
    // Day overtime: rate × multiplier. Night overtime adds the night premium and the extra that
    // the Code gives for overtime worked at night — all three percentages on the same hourly rate.
    const nightMultiplier = multiplier + multipliers.nightPremium + multipliers.nightOvertimeExtra;
    const dayPay = payFor(rate, minutes.day, multiplier, component);
    const nightPay = payFor(rate, minutes.night, nightMultiplier, component);
    const amount = dayPay + nightPay;
    if (amount === 0) continue;
    // What the same hours would have cost at the ordinary rate — the taxable part when the law
    // exempts only the premium (`pit.overtime_exemption` = premium_only).
    ordinaryEquivalent += payFor(rate, minutes.day + minutes.night, 100, component);
    lines.push({
      code: component.code,
      kind: "earning",
      category: component.category,
      amount,
      taxable: taxablePart(component, amount),
      insurable: 0,
      rule: "overtime_multiplier",
      roundingRule: component.roundingRule,
      inputs: { hourlyRate: rate, dayMinutes: minutes.day, nightMinutes: minutes.night, multiplierPercent: multiplier, nightMultiplierPercent: nightMultiplier, dayPay, nightPay },
    });
    trace.push({ stage: "overtime", rule: "overtime_multiplier", detail: { category, dayMinutes: minutes.day, nightMinutes: minutes.night, multiplierPercent: multiplier, amount } });
  }

  // Ordinary hours worked inside the statutory night window earn the night premium on top of the
  // salary already paid for them (the salary itself is in the structure lines).
  const nightComponent = findComponent(components, ENGINE_CODES.nightPremium);
  if (nightComponent && timesheet.nightMinutes > 0 && multipliers.nightPremium > 0) {
    const amount = payFor(rate, timesheet.nightMinutes, multipliers.nightPremium, nightComponent);
    if (amount > 0) {
      lines.push({
        code: nightComponent.code,
        kind: "earning",
        category: nightComponent.category,
        amount,
        taxable: taxablePart(nightComponent, amount),
        insurable: 0,
        rule: "night_premium",
        roundingRule: nightComponent.roundingRule,
        inputs: { hourlyRate: rate, nightMinutes: timesheet.nightMinutes, premiumPercent: multipliers.nightPremium },
      });
      trace.push({ stage: "overtime", rule: "night_premium", detail: { nightMinutes: timesheet.nightMinutes, premiumPercent: multipliers.nightPremium, amount } });
    }
  }

  return { lines, hourlyRate: rate, ordinaryEquivalent, trace };
}

/** hours × rate × percent, from minutes, under the component's rule. Minutes stay integers: rate × minutes × percent ÷ (60 × 100). */
const payFor = (rate: number, minutes: number, percent: number, component: Pick<ComponentDefinition, "roundingRule">): number => (minutes === 0 ? 0 : ratio(rate, minutes * percent, 60 * 100, component.roundingRule));
