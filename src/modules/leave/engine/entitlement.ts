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
  // The trace ends up as the reason of a ledger row, read by HR: Vietnamese, the source language.
  const trace = [`cơ sở ${base / 100} ngày (${policy.baseSource === "statutory_annual" ? "theo luật" : "cố định"})`];
  if (policy.extraDaysCenti) trace.push(`công ty thêm ${policy.extraDaysCenti / 100}`);
  let bonus = 0;
  if (policy.seniorityBonus && statutory.yearsOfServicePerExtraDay > 0) {
    const reference = employment.endDate ? earlier(employment.endDate, `${year}-12-31`) : `${year}-12-31`;
    const years = completedYears(employment.seniorityDate, reference);
    bonus = Math.floor(years / statutory.yearsOfServicePerExtraDay) * 100;
    trace.push(`thâm niên ${years} năm tính đến ${reference} → +${bonus / 100}`);
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
  if (policy.accrualMethod === "none") return { targetCenti: 0, entitlementCenti: 0, trace: ["không tự cấp: số dư chỉ thay đổi qua bút toán"] };

  const full = fullYearDays(year, policy, input.statutory, employment);
  const trace = [...full.trace];
  const months = countedMonths(year, policy, employment);
  const opening = input.openingDate ?? null;
  const coveredByOpening = (month: number) => opening !== null && monthStart(year, month) < opening;
  const countable = months.map((counts, index) => counts && !coveredByOpening(index + 1));
  const yearMonths = countable.filter(Boolean).length;
  // Without pro-rating anyone employed in the year gets the whole year.
  const entitlement = policy.prorate ? roundDays((full.centi * yearMonths) / 12, policy.rounding) : months.some(Boolean) ? full.centi : 0;
  trace.push(`${yearMonths}/12 tháng được tính${opening ? ` (số dư đầu kỳ ngày ${opening})` : ""} → hưởng ${entitlement / 100} ngày`);

  if (policy.accrualMethod === "yearly_grant") {
    const grantDay = later(`${year}-01-01`, employment.startDate);
    if (opening !== null && opening > grantDay) return { targetCenti: 0, entitlementCenti: 0, trace: [...trace, "số dư đầu kỳ đã gồm phần cấp của năm"] };
    const due = asOf >= grantDay && (!employment.endDate || employment.endDate >= grantDay);
    return { targetCenti: due ? entitlement : 0, entitlementCenti: entitlement, trace: [...trace, due ? `cấp ngày ${grantDay}` : `sẽ cấp ngày ${grantDay}`] };
  }

  // A month's share is due on its first day — for a joiner's first month, on their first day.
  const dueOn = (month: number) => later(monthStart(year, month), employment.startDate);
  const reached = countable.filter((counts, index) => counts && dueOn(index + 1) <= asOf).length;
  const lastCountable = countable.lastIndexOf(true) + 1;
  const complete = lastCountable > 0 && dueOn(lastCountable) <= asOf;
  const share = policy.prorate ? full.centi : yearMonths > 0 ? (full.centi * 12) / yearMonths : 0;
  const target = complete ? entitlement : Math.floor((share * reached) / 12);
  trace.push(`đến ${asOf}: ${reached} tháng → ${target / 100} ngày`);
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

export type AccrualPosting = { effectiveDate: IsoDate; amountCenti: number; kind: "accrual" | "grant"; trace: string[] };

/**
 * The ledger rows that bring a year's accruals up to `asOf`: one per checkpoint (the first of each
 * month, the first day of employment, `asOf` itself) that lies after the last row already given
 * and at which the target differs from what was given. History is never re-posted: a re-run finds
 * nothing due, and a late change of facts (an end date, a corrected seniority date) is settled
 * in one row at the next checkpoint.
 */
export function accrualPostings(input: Omit<TargetInput, "policy"> & { policyAt: (date: IsoDate) => PolicyRules | null; given: readonly { effectiveDate: IsoDate; amountCenti: number }[] }): AccrualPosting[] {
  const { year, asOf, employment } = input;
  const lastGiven =
    input.given
      .map((row) => row.effectiveDate)
      .sort()
      .at(-1) ?? "";
  const checkpoints = [...new Set([...Array.from({ length: 12 }, (_, index) => monthStart(year, index + 1)), employment.startDate, asOf])].filter((date) => date <= asOf && date > lastGiven && date.startsWith(`${year}-`)).sort();
  let given = input.given.reduce((sum, row) => sum + row.amountCenti, 0);
  const postings: AccrualPosting[] = [];
  for (const checkpoint of checkpoints) {
    const policy = input.policyAt(checkpoint);
    if (!policy) continue;
    const { targetCenti, trace } = accrualTarget({ year, asOf: checkpoint, policy, statutory: input.statutory, employment, openingDate: input.openingDate });
    const due = targetCenti - given;
    if (due === 0) continue;
    postings.push({ effectiveDate: checkpoint, amountCenti: due, kind: policy.accrualMethod === "yearly_grant" ? "grant" : "accrual", trace });
    given += due;
  }
  return postings;
}

// ── Booking ahead (LVE-01) ──────────────────────────────────────────────────────────────────
//
// The ledger holds what has been given *so far*; a request is for days ahead. With monthly accrual
// a day in December is earned on 1 December, and next year's days — Tết leave asked for in
// December — have no ledger row at all until 1 January. So a request is checked against what the
// policy *will* have given by the leave date, and never against more:
//
//  · this year: the accrual target on the last day asked for, less what was already given;
//  · next year: that year's own accrual or grant by the leave date, plus what this year's balance
//    is projected to carry over (capped by the policy) — the carried days only while they have not
//    lapsed on the leave date;
//  · and the other way round: whatever next year's bookings already lean on this year's carry is
//    no longer free to spend this year.
//
// A year further ahead, or one already closed, gets nothing projected: the ledger alone decides.

export type AheadYear = {
  /** Accrual and grant rows already in the ledger for that year. */
  givenCenti: number;
  /** The ledger's balance less what open requests already ask for. */
  availableCenti: number;
  /** The last day of leave booked or asked for in that year; null = none. */
  lastDate: IsoDate | null;
};

export type BookingAheadInput = {
  /** Which year is "this year". */
  today: IsoDate;
  employment: EmploymentFacts;
  /** The policy of the type in force on a date (the entity's own, else the group's). */
  policyAt: (date: IsoDate) => PolicyRules | null;
  /** `leave.annual` in force for a leave year; null = not configured, and nothing is projected. */
  statutoryFor: (year: number) => StatutoryAnnual | null;
  openingDateFor?: (year: number) => IsoDate | null;
  thisYear: AheadYear;
  nextYear: AheadYear;
};

/** What a leave year will have given by `asOf` that the ledger does not hold yet. */
function stillToCome(year: number, asOf: IsoDate, input: BookingAheadInput, givenCenti: number): number {
  const policy = input.policyAt(asOf);
  const statutory = input.statutoryFor(year);
  if (!policy || !statutory) return 0;
  const { targetCenti } = accrualTarget({ year, asOf, policy, statutory, employment: input.employment, openingDate: input.openingDateFor?.(year) ?? null });
  return Math.max(0, targetCenti - givenCenti);
}

/**
 * Days to add to the ledger's available figure of a leave year when booking leave whose last day
 * in that year is `asOf`. Negative when this year gives up what next year has already leaned on.
 * Every year other than this one and the next gets 0.
 */
export function bookingAhead(input: BookingAheadInput, year: number, asOf: IsoDate): { centi: number; trace: string[] } {
  const current = Number(input.today.slice(0, 4));
  const yearEnd = `${current}-12-31`;
  // This year as it will close: what is free now and what the rest of the year still brings.
  const closing = input.thisYear.availableCenti + stillToCome(current, yearEnd, input, input.thisYear.givenCenti);
  const closingPolicy = input.policyAt(yearEnd);
  const carry = closingPolicy ? Math.max(0, yearEndCarryOver(closing, closingPolicy).carryCenti) : 0;

  if (year === current + 1) {
    const own = stillToCome(year, asOf, input, input.nextYear.givenCenti);
    const expiresOn = carryOverExpiryDate(year, input.policyAt(asOf)?.carryOverExpiry ?? null);
    const carried = expiresOn && asOf > expiresOn ? 0 : carry;
    return { centi: own + carried, trace: [`năm ${year}: +${own / 100} ngày được hưởng đến ${asOf}`, `+${carried / 100} ngày dự kiến chuyển từ năm ${current}`] };
  }
  if (year !== current) return { centi: 0, trace: [] };

  const own = stillToCome(current, asOf, input, input.thisYear.givenCenti);
  // Next year's bookings beyond what next year itself gives by their last day come out of the carry.
  const next = input.nextYear;
  const nextOwn = next.lastDate ? stillToCome(current + 1, next.lastDate, input, next.givenCenti) : 0;
  const leaning = Math.max(0, -(next.availableCenti + nextOwn));
  return { centi: own - leaning, trace: [`năm ${current}: +${own / 100} ngày được hưởng đến ${asOf}`, ...(leaning ? [`−${leaning / 100} ngày đã dùng trước cho năm ${current + 1}`] : [])] };
}
