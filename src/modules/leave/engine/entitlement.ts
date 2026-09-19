// Leave entitlement and accrual (FR-LVE-02, 03). Pure: no I/O. The caller loads the policy, the
// statutory numbers in force and the person's employment, and gets amounts with an explanation.
//
// Amounts are hundredths of a day. A leave year is a calendar year.
//
// The ledger is driven by *targets*: "by this date the person should have been given N days this
// year". A job posts the difference between the target and what was already posted, so running it
// twice adds nothing, and a late change (an end date, a corrected seniority date) corrects itself
// with the next run instead of needing a recalculation of history.

export type IsoDate = string;

export type PolicyRules = {
  accrualMethod: "none" | "monthly_accrual" | "yearly_grant";
  baseSource: "statutory_annual" | "fixed";
  fixedDaysCenti: number;
  extraDaysCenti: number;
  seniorityBonus: boolean;
  prorate: boolean;
  rounding: "none" | "half_day" | "full_day";
  probationRule: "accrue_and_use" | "accrue_no_use" | "no_accrual";
  carryOverCapCenti: number | null;
  carryOverExpiry: string | null;
  payoutOnTermination: boolean;
  allowNegativeCenti: number;
};

/** `leave.annual` from the statutory parameter store, as in force for the leave year. */
export type StatutoryAnnual = { baseDays: number; yearsOfServicePerExtraDay: number };

export type Interval = { start: IsoDate; end: IsoDate | null };
export type EmploymentFacts = { startDate: IsoDate; seniorityDate: IsoDate; endDate: IsoDate | null; probation: readonly Interval[] };

const pad = (value: number) => String(value).padStart(2, "0");
const monthStart = (year: number, month: number): IsoDate => `${year}-${pad(month)}-01`;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthEnd = (year: number, month: number): IsoDate => `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
const dayNumber = (date: IsoDate) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
const earlier = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

/** Days of [from, to] covered by the interval; 0 when they do not meet. */
function overlapDays(from: IsoDate, to: IsoDate, interval: Interval): number {
  const start = later(from, interval.start);
  const end = interval.end ? earlier(to, interval.end) : to;
  return end < start ? 0 : dayNumber(end) - dayNumber(start) + 1;
}

/** Whole years between two dates (an anniversary counts on its day). */
export function completedYears(from: IsoDate, to: IsoDate): number {
  if (to < from) return 0;
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return to.slice(5) >= from.slice(5) ? years : years - 1;
}

export function isOnProbation(employment: EmploymentFacts, date: IsoDate): boolean {
  return employment.probation.some((interval) => interval.start <= date && (interval.end === null || date <= interval.end));
}

export function roundDays(centi: number, rounding: PolicyRules["rounding"]): number {
  const unit = rounding === "full_day" ? 100 : rounding === "half_day" ? 50 : 1;
  return Math.floor(centi / unit + 0.5) * unit;
}

/**
 * What a whole year of service is worth: base + company extra + seniority bonus. Seniority is
 * measured on the last day the year counts for this person (31 December, or the last day of
 * employment), so the extra day arrives in the year the fifth year of service is completed.
 */
export function fullYearDays(year: number, policy: PolicyRules, statutory: StatutoryAnnual, employment: EmploymentFacts): { centi: number; trace: string[] } {
  const base = policy.baseSource === "statutory_annual" ? statutory.baseDays * 100 : policy.fixedDaysCenti;
  const trace = [`base ${base / 100} (${policy.baseSource})`];
  if (policy.extraDaysCenti) trace.push(`company extra ${policy.extraDaysCenti / 100}`);
  let bonus = 0;
  if (policy.seniorityBonus && statutory.yearsOfServicePerExtraDay > 0) {
    const reference = employment.endDate ? earlier(employment.endDate, `${year}-12-31`) : `${year}-12-31`;
    const years = completedYears(employment.seniorityDate, reference);
    bonus = Math.floor(years / statutory.yearsOfServicePerExtraDay) * 100;
    trace.push(`seniority ${years}y on ${reference} → +${bonus / 100}`);
  }
  return { centi: base + policy.extraDaysCenti + bonus, trace };
}

/**
 * Which months of the year count towards leave: the person is employed for at least half of the
 * month's days (Nghị định 145/2020, Điều 66, simplified to calendar days). Under "no_accrual",
 * days on probation do not count as employed.
 */
export function countedMonths(year: number, policy: PolicyRules, employment: EmploymentFacts): boolean[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const from = monthStart(year, month);
    const to = monthEnd(year, month);
    let employed = overlapDays(from, to, { start: employment.startDate, end: employment.endDate });
    if (policy.probationRule === "no_accrual") for (const interval of employment.probation) employed -= overlapDays(later(from, employment.startDate), employment.endDate ? earlier(to, employment.endDate) : to, interval);
    return employed * 2 >= daysInMonth(year, month);
  });
}

export type TargetInput = {
  year: number;
  /** The target is "what should have been posted by this date". */
  asOf: IsoDate;
  policy: PolicyRules;
  statutory: StatutoryAnnual;
  employment: EmploymentFacts;
  /**
   * The date of an imported opening balance for this year, if any. An opening balance already
   * contains whatever was earned in the months that started before it, so those months are left out.
   */
  openingDate?: IsoDate | null;
};

/**
 * Days that should have been given by `asOf`. Monthly accrual gives a month's share on the first
 * day of that month; a yearly grant gives the (pro-rated) year at once. The year's last share
 * applies the policy's rounding, so that the twelve shares add up to the rounded entitlement.
 */
export function accrualTarget(input: TargetInput): { targetCenti: number; entitlementCenti: number; trace: string[] } {
  const { year, asOf, policy, employment } = input;
  if (policy.accrualMethod === "none") return { targetCenti: 0, entitlementCenti: 0, trace: ["no accrual: balance comes from postings only"] };

  const full = fullYearDays(year, policy, input.statutory, employment);
  const trace = [...full.trace];
  const months = countedMonths(year, policy, employment);
  const opening = input.openingDate ?? null;
  const coveredByOpening = (month: number) => opening !== null && monthStart(year, month) < opening;
  const countable = months.map((counts, index) => counts && !coveredByOpening(index + 1));
  const yearMonths = countable.filter(Boolean).length;
  // Without pro-rating anyone employed in the year gets the whole year.
  const entitlement = policy.prorate ? roundDays((full.centi * yearMonths) / 12, policy.rounding) : months.some(Boolean) ? full.centi : 0;
  trace.push(`${yearMonths}/12 months count${opening ? ` (opening balance on ${opening})` : ""} → entitlement ${entitlement / 100}`);

  if (policy.accrualMethod === "yearly_grant") {
    const grantDay = later(`${year}-01-01`, employment.startDate);
    if (opening !== null && opening > grantDay) return { targetCenti: 0, entitlementCenti: 0, trace: [...trace, "the opening balance already contains this year's grant"] };
    const due = asOf >= grantDay && (!employment.endDate || employment.endDate >= grantDay);
    return { targetCenti: due ? entitlement : 0, entitlementCenti: entitlement, trace: [...trace, due ? `granted on ${grantDay}` : `grant due on ${grantDay}`] };
  }

  const reached = countable.filter((counts, index) => counts && monthStart(year, index + 1) <= asOf).length;
  const lastCountable = countable.lastIndexOf(true) + 1;
  const complete = lastCountable > 0 && monthStart(year, lastCountable) <= asOf;
  const share = policy.prorate ? full.centi : yearMonths > 0 ? (full.centi * 12) / yearMonths : 0;
  const target = complete ? entitlement : Math.floor((share * reached) / 12);
  trace.push(`${reached} month(s) reached by ${asOf} → ${target / 100}`);
  return { targetCenti: target, entitlementCenti: entitlement, trace };
}

/** Closing a leave year: what moves to the next year and what lapses. A negative balance is carried as a debt. */
export function yearEndCarryOver(closingCenti: number, policy: Pick<PolicyRules, "carryOverCapCenti">): { carryCenti: number; expireCenti: number } {
  if (closingCenti <= 0) return { carryCenti: closingCenti, expireCenti: 0 };
  const carry = policy.carryOverCapCenti === null ? closingCenti : Math.min(closingCenti, policy.carryOverCapCenti);
  return { carryCenti: carry, expireCenti: closingCenti - carry };
}

/** The day after which carried-over days lapse, in the year they were carried into. */
export function carryOverExpiryDate(intoYear: number, expiry: string | null): IsoDate | null {
  return expiry && /^\d{2}-\d{2}$/.test(expiry) ? `${intoYear}-${expiry}` : null;
}

/** Carried days are used first; what is left of them on the expiry date lapses (never more than the balance). */
export function carryOverLapse(input: { carriedCenti: number; usedByExpiryCenti: number; balanceCenti: number }): number {
  return Math.max(0, Math.min(input.carriedCenti - input.usedByExpiryCenti, input.balanceCenti));
}

/** Unused days paid out when employment ends (FR-LVE-03) — payroll reads the ledger's `payout` rows. */
export function terminationPayout(balanceCenti: number, policy: Pick<PolicyRules, "payoutOnTermination">): number {
  return policy.payoutOnTermination && balanceCenti > 0 ? balanceCenti : 0;
}
