// Golden tests for the leave entitlement and accrual engine (FR-LVE-02, 03).
import { describe, expect, it } from "vitest";
import { accrualPostings, accrualTarget, carryOverExpiryDate, carryOverLapse, completedYears, countedMonths, type EmploymentFacts, fullYearDays, isOnProbation, type PolicyRules, roundDays, terminationPayout, yearEndCarryOver } from "./entitlement";

const STATUTORY = { baseDays: 12, yearsOfServicePerExtraDay: 5 };
const ANNUAL: PolicyRules = {
  accrualMethod: "monthly_accrual",
  baseSource: "statutory_annual",
  fixedDaysCenti: 0,
  extraDaysCenti: 0,
  seniorityBonus: true,
  prorate: true,
  rounding: "half_day",
  probationRule: "accrue_no_use",
  carryOverCapCenti: 500,
  carryOverExpiry: "03-31",
  payoutOnTermination: true,
  allowNegativeCenti: 0,
};
const employed = (startDate: string, overrides: Partial<EmploymentFacts> = {}): EmploymentFacts => ({ startDate, seniorityDate: startDate, endDate: null, probation: [], ...overrides });
const target = (asOf: string, employment: EmploymentFacts, policy: PolicyRules = ANNUAL, openingDate: string | null = null, year = 2026) => accrualTarget({ year, asOf, policy, statutory: STATUTORY, employment, openingDate }).targetCenti;

describe("completed years and the seniority bonus", () => {
  it("counts an anniversary on its day", () => {
    expect(completedYears("2021-03-01", "2026-02-28")).toBe(4);
    expect(completedYears("2021-03-01", "2026-03-01")).toBe(5);
    expect(completedYears("2026-03-01", "2026-01-01")).toBe(0);
  });

  it("adds a day per five years, measured at the end of the leave year", () => {
    expect(fullYearDays(2026, ANNUAL, STATUTORY, employed("2021-03-01")).centi).toBe(1300);
    expect(fullYearDays(2026, ANNUAL, STATUTORY, employed("2022-01-10")).centi).toBe(1200);
    expect(fullYearDays(2026, ANNUAL, STATUTORY, employed("2016-06-01")).centi).toBe(1400);
  });

  it("measures seniority on the last day of employment when that comes first", () => {
    expect(fullYearDays(2026, ANNUAL, STATUTORY, employed("2021-09-01", { endDate: "2026-06-30" })).centi).toBe(1200);
  });

  it("uses the seniority date, not the start date (a transfer keeps the years)", () => {
    expect(fullYearDays(2026, ANNUAL, STATUTORY, employed("2025-01-01", { seniorityDate: "2019-01-01" })).centi).toBe(1300);
  });

  it("adds company extra days and takes a fixed base", () => {
    expect(fullYearDays(2026, { ...ANNUAL, extraDaysCenti: 200 }, STATUTORY, employed("2024-01-01")).centi).toBe(1400);
    expect(fullYearDays(2026, { ...ANNUAL, baseSource: "fixed", fixedDaysCenti: 100, seniorityBonus: false }, STATUTORY, employed("2010-01-01")).centi).toBe(100);
  });
});

describe("months that count", () => {
  it("counts a month when at least half of it is worked", () => {
    const months = countedMonths(2026, ANNUAL, employed("2026-03-16", { endDate: "2026-09-14" }));
    // March: 16 of 31 days → counts; September: 14 of 30 → does not.
    expect(months).toEqual([false, false, true, true, true, true, true, true, false, false, false, false]);
  });

  it("leaves probation out under no_accrual", () => {
    const months = countedMonths(2026, { ...ANNUAL, probationRule: "no_accrual" }, employed("2026-01-01", { probation: [{ start: "2026-01-01", end: "2026-03-01" }] }));
    expect(months.slice(0, 4)).toEqual([false, false, true, true]);
  });
});

describe("monthly accrual", () => {
  it("gives one day on the first of each month for a full year of 12", () => {
    const person = employed("2024-01-15");
    expect(target("2026-01-01", person)).toBe(100);
    expect(target("2026-01-31", person)).toBe(100);
    expect(target("2026-09-19", person)).toBe(900);
    expect(target("2026-12-01", person)).toBe(1200);
  });

  it("spreads 13 days so that December closes the year exactly", () => {
    const person = employed("2021-03-01");
    expect(target("2026-01-01", person)).toBe(108);
    expect(target("2026-06-01", person)).toBe(650);
    expect(target("2026-11-30", person)).toBe(1191);
    expect(target("2026-12-31", person)).toBe(1300);
  });

  it("pro-rates a joiner: months from the start only", () => {
    const joiner = employed("2026-08-03");
    expect(target("2026-07-31", joiner)).toBe(0);
    expect(target("2026-08-03", joiner)).toBe(100);
    expect(target("2026-12-31", joiner)).toBe(500);
  });

  it("pro-rates a leaver and rounds the final entitlement to half days", () => {
    // Leaves 14 September: eight months count → 13 × 8 / 12 = 8.67 → 8.5.
    const leaver = employed("2021-03-01", { endDate: "2026-09-14", seniorityDate: "2021-03-01" });
    expect(accrualTarget({ year: 2026, asOf: "2026-08-01", policy: ANNUAL, statutory: STATUTORY, employment: leaver }).entitlementCenti).toBe(850);
    expect(target("2026-07-01", leaver)).toBe(758);
    expect(target("2026-08-01", leaver)).toBe(850);
    expect(target("2026-12-31", leaver)).toBe(850);
  });

  it("rounds to whole days when the policy says so (Điều 66: .5 and above rounds up)", () => {
    const leaver = employed("2022-01-01", { endDate: "2026-05-20" });
    // Five months count → 12 × 5 / 12 = 5.0; with 13 days it would be 5.42 → 5.
    expect(target("2026-12-31", leaver, { ...ANNUAL, rounding: "full_day" })).toBe(500);
    expect(roundDays(542, "full_day")).toBe(500);
    expect(roundDays(550, "full_day")).toBe(600);
    expect(roundDays(867, "half_day")).toBe(850);
    expect(roundDays(875, "half_day")).toBe(900);
    expect(roundDays(867, "none")).toBe(867);
  });

  it("does not accrue during probation under no_accrual", () => {
    const person = employed("2026-08-03", { probation: [{ start: "2026-08-03", end: "2026-10-02" }] });
    const policy = { ...ANNUAL, probationRule: "no_accrual" as const };
    expect(target("2026-09-19", person, policy)).toBe(0);
    expect(target("2026-12-31", person, policy)).toBe(300);
    expect(target("2026-09-19", person, ANNUAL)).toBe(200);
  });

  it("skips the months an opening balance already contains", () => {
    const person = employed("2024-01-15");
    // Balance as at 1 September: January–August are inside it; September is not.
    expect(target("2026-09-19", person, ANNUAL, "2026-09-01")).toBe(100);
    expect(target("2026-12-31", person, ANNUAL, "2026-09-01")).toBe(400);
    // Balance as at 1 January (carried from last year): the whole year accrues.
    expect(target("2026-09-19", person, ANNUAL, "2026-01-01")).toBe(900);
  });

  it("corrects itself when an end date appears: the target can fall below what was posted", () => {
    const before = target("2026-09-19", employed("2024-01-15"));
    const after = target("2026-09-19", employed("2024-01-15", { endDate: "2026-06-10" }));
    expect(before).toBe(900);
    expect(after).toBe(500);
  });
});

describe("yearly grant", () => {
  const BIRTHDAY: PolicyRules = { ...ANNUAL, accrualMethod: "yearly_grant", baseSource: "fixed", fixedDaysCenti: 100, seniorityBonus: false, prorate: false, carryOverCapCenti: 0, carryOverExpiry: null, payoutOnTermination: false };
  const GRANT: PolicyRules = { ...ANNUAL, accrualMethod: "yearly_grant" };

  it("grants the whole year on 1 January", () => {
    expect(target("2026-01-01", employed("2024-01-15"), GRANT)).toBe(1200);
    expect(target("2025-12-31", employed("2024-01-15"), GRANT, null, 2026)).toBe(0);
  });

  it("grants a joiner the pro-rated year on the first day", () => {
    expect(target("2026-08-02", employed("2026-08-03"), GRANT)).toBe(0);
    expect(target("2026-08-03", employed("2026-08-03"), GRANT)).toBe(500);
  });

  it("gives a fixed day to everyone without pro-rating", () => {
    expect(target("2026-09-19", employed("2026-08-03"), BIRTHDAY)).toBe(100);
  });

  it("is contained in an opening balance dated after the grant day", () => {
    expect(target("2026-09-19", employed("2024-01-15"), GRANT, "2026-09-01")).toBe(0);
    expect(target("2026-09-19", employed("2024-01-15"), GRANT, "2026-01-01")).toBe(1200);
  });
});

describe("no accrual", () => {
  it("targets nothing: compensatory leave comes from postings", () => {
    expect(target("2026-09-19", employed("2020-01-01"), { ...ANNUAL, accrualMethod: "none" })).toBe(0);
  });
});

describe("carry-over, expiry and payout", () => {
  it("carries up to the cap and lapses the rest", () => {
    expect(yearEndCarryOver(750, ANNUAL)).toEqual({ carryCenti: 500, expireCenti: 250 });
    expect(yearEndCarryOver(300, ANNUAL)).toEqual({ carryCenti: 300, expireCenti: 0 });
    expect(yearEndCarryOver(300, { carryOverCapCenti: 0 })).toEqual({ carryCenti: 0, expireCenti: 300 });
    expect(yearEndCarryOver(900, { carryOverCapCenti: null })).toEqual({ carryCenti: 900, expireCenti: 0 });
  });

  it("carries a debt forward untouched", () => {
    expect(yearEndCarryOver(-150, ANNUAL)).toEqual({ carryCenti: -150, expireCenti: 0 });
  });

  it("knows when carried days lapse", () => {
    expect(carryOverExpiryDate(2027, "03-31")).toBe("2027-03-31");
    expect(carryOverExpiryDate(2027, null)).toBeNull();
  });

  it("lapses what is left of the carried days, used first, never more than the balance", () => {
    expect(carryOverLapse({ carriedCenti: 500, usedByExpiryCenti: 200, balanceCenti: 600 })).toBe(300);
    expect(carryOverLapse({ carriedCenti: 500, usedByExpiryCenti: 700, balanceCenti: 100 })).toBe(0);
    expect(carryOverLapse({ carriedCenti: 500, usedByExpiryCenti: 0, balanceCenti: 200 })).toBe(200);
  });

  it("pays out a positive balance on termination when the policy says so", () => {
    expect(terminationPayout(350, ANNUAL)).toBe(350);
    expect(terminationPayout(-100, ANNUAL)).toBe(0);
    expect(terminationPayout(350, { payoutOnTermination: false })).toBe(0);
  });
});

describe("probation", () => {
  it("is on probation inside an interval, open-ended included", () => {
    const person = employed("2026-08-03", { probation: [{ start: "2026-08-03", end: "2026-10-02" }] });
    expect(isOnProbation(person, "2026-09-01")).toBe(true);
    expect(isOnProbation(person, "2026-10-03")).toBe(false);
    expect(isOnProbation(employed("2026-08-03", { probation: [{ start: "2026-08-03", end: null }] }), "2027-01-01")).toBe(true);
  });
});

describe("accrual postings", () => {
  const policyAt = () => ANNUAL;

  it("catches up month by month and finds nothing the second time", () => {
    const first = accrualPostings({ year: 2026, asOf: "2026-03-10", statutory: STATUTORY, employment: employed("2024-01-15"), policyAt, given: [] });
    expect(first.map((row) => [row.effectiveDate, row.amountCenti, row.kind])).toEqual([
      ["2026-01-01", 100, "accrual"],
      ["2026-02-01", 100, "accrual"],
      ["2026-03-01", 100, "accrual"],
    ]);
    expect(accrualPostings({ year: 2026, asOf: "2026-03-10", statutory: STATUTORY, employment: employed("2024-01-15"), policyAt, given: first })).toEqual([]);
  });

  it("starts a joiner on their first day", () => {
    const rows = accrualPostings({ year: 2026, asOf: "2026-09-19", statutory: STATUTORY, employment: employed("2026-08-03"), policyAt, given: [] });
    expect(rows.map((row) => [row.effectiveDate, row.amountCenti])).toEqual([
      ["2026-08-03", 100],
      ["2026-09-01", 100],
    ]);
  });

  it("settles a late end date with one negative row today", () => {
    const given = accrualPostings({ year: 2026, asOf: "2026-09-19", statutory: STATUTORY, employment: employed("2024-01-15"), policyAt, given: [] });
    const rows = accrualPostings({ year: 2026, asOf: "2026-09-19", statutory: STATUTORY, employment: employed("2024-01-15", { endDate: "2026-06-10" }), policyAt, given });
    expect(rows.map((row) => [row.effectiveDate, row.amountCenti])).toEqual([["2026-09-19", -400]]);
  });

  it("follows a policy change from its start date and skips dates without a policy", () => {
    const rows = accrualPostings({ year: 2026, asOf: "2026-03-01", statutory: STATUTORY, employment: employed("2024-01-15"), policyAt: (date) => (date < "2026-02-01" ? null : { ...ANNUAL, extraDaysCenti: 1200 }), given: [] });
    // No policy in January; from February 24 days a year: two months' worth on 1 February, one more on 1 March.
    expect(rows.map((row) => [row.effectiveDate, row.amountCenti])).toEqual([
      ["2026-02-01", 400],
      ["2026-03-01", 200],
    ]);
  });
});
