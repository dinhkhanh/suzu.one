import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { bonusEarnedOn, REFERRAL_PROBATION_MONTHS, type ReferralFacts, referralBonusState } from "./referral";

const facts = (overrides: Partial<ReferralFacts> = {}): ReferralFacts => ({
  applicationStatus: "active",
  hired: false,
  startDate: null,
  probationMonths: 2,
  settled: false,
  ...overrides,
});

describe("bonusEarnedOn", () => {
  it("adds the probation term to the start date", () => {
    expect(bonusEarnedOn("2026-03-02" as IsoDate, 2)).toBe("2026-05-02");
  });

  it("falls back to the company term when the offer named none", () => {
    expect(bonusEarnedOn("2026-03-02" as IsoDate, null)).toBe(bonusEarnedOn("2026-03-02" as IsoDate, REFERRAL_PROBATION_MONTHS));
  });

  it("keeps the end of a short month instead of rolling into the next one", () => {
    // 31 January + 1 month is the 28th of February, not the 3rd of March.
    expect(bonusEarnedOn("2026-01-31" as IsoDate, 1)).toBe("2026-02-28");
    // And in a leap year it is the 29th.
    expect(bonusEarnedOn("2028-01-31" as IsoDate, 1)).toBe("2028-02-29");
  });

  it("treats a nonsense term as the company term", () => {
    expect(bonusEarnedOn("2026-03-02" as IsoDate, -4)).toBe("2026-05-02");
  });

  it("crosses a year end", () => {
    expect(bonusEarnedOn("2026-11-15" as IsoDate, 3)).toBe("2027-02-15");
  });
});

describe("referralBonusState", () => {
  const today = "2026-06-01" as IsoDate;

  it("is pending while the candidate is still in the pipeline", () => {
    expect(referralBonusState(facts(), today)).toBe("pending");
  });

  it("is not earned once the application ends without a hire", () => {
    expect(referralBonusState(facts({ applicationStatus: "rejected" }), today)).toBe("not_earned");
    expect(referralBonusState(facts({ applicationStatus: "withdrawn" }), today)).toBe("not_earned");
  });

  it("is pending while the new colleague is still on probation", () => {
    expect(referralBonusState(facts({ applicationStatus: "hired", hired: true, startDate: "2026-05-04" as IsoDate }), today)).toBe("pending");
  });

  it("is earned on the day probation ends, not after it", () => {
    const hired = facts({ applicationStatus: "hired", hired: true, startDate: "2026-04-01" as IsoDate, probationMonths: 2 });
    expect(referralBonusState(hired, "2026-05-31" as IsoDate)).toBe("pending");
    expect(referralBonusState(hired, "2026-06-01" as IsoDate)).toBe("earned");
  });

  it("stays pending when the application says hired but nobody was ever put on the books", () => {
    expect(referralBonusState(facts({ applicationStatus: "hired", hired: false, startDate: null }), today)).toBe("pending");
  });

  it("is never earned when the candidate had applied before the referral", () => {
    const hired = facts({ applicationStatus: "hired", hired: true, startDate: "2026-01-05" as IsoDate, preexisting: true });
    expect(referralBonusState(hired, today)).toBe("not_earned");
    expect(referralBonusState(facts({ preexisting: true }), today)).toBe("not_earned");
  });

  it("reports what was settled, whatever the facts now say", () => {
    expect(referralBonusState(facts({ settled: true }), today)).toBe("settled");
    expect(referralBonusState(facts({ applicationStatus: "rejected", settled: true }), today)).toBe("settled");
  });
});
