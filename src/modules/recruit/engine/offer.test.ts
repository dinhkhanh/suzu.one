import { describe, expect, it } from "vitest";
import { OFFER_STATUSES, type OfferStatus } from "../enums";
import { defaultExpiry, effectiveOfferStatus, mayMove, nextStatus, offerExpiredOn, type OfferDraft, offerProblems, offerTotalVnd, probationMonthlyVnd } from "./offer";

const TODAY = "2026-09-20";

const draft = (over: Partial<OfferDraft> = {}): OfferDraft => ({
  positionName: "Video Editor",
  startDate: "2026-10-05",
  expiresOn: "2026-09-27",
  baseSalaryVnd: 22_000_000,
  allowancesVnd: 1_500_000,
  probationMonths: 2,
  probationSalaryPercent: 85,
  ...over,
});

describe("the offer state machine", () => {
  it("walks the ordinary path from a draft to an accepted offer", () => {
    let status: OfferStatus = "draft";
    for (const move of ["submit", "approve", "send", "accept"] as const) {
      const next = nextStatus(status, move);
      expect(next, move).not.toBeNull();
      status = next!;
    }
    expect(status).toBe("accepted");
  });

  it("refuses to send an offer nobody approved", () => {
    expect(nextStatus("draft", "send")).toBeNull();
    expect(nextStatus("pending_approval", "send")).toBeNull();
    expect(nextStatus("approved", "send")).toBe("sent");
  });

  it("stops editing the moment the offer is out of the building", () => {
    expect(mayMove("draft", "edit")).toBe(true);
    // Under approval the figure is in front of an approver; sent, it is in the candidate's hands.
    expect(mayMove("pending_approval", "edit")).toBe(false);
    expect(mayMove("approved", "edit")).toBe(false);
    expect(mayMove("sent", "edit")).toBe(false);
  });

  it("keeps the company's refusal and the candidate's decline apart", () => {
    expect(nextStatus("pending_approval", "reject")).toBe("rejected");
    expect(nextStatus("pending_approval", "decline")).toBeNull();
    expect(nextStatus("sent", "decline")).toBe("declined");
    expect(nextStatus("sent", "reject")).toBeNull();
  });

  it("lets an offer be withdrawn until the candidate has answered, and not after", () => {
    for (const status of ["draft", "pending_approval", "approved", "sent"] as const) expect(mayMove(status, "withdraw"), status).toBe(true);
    for (const status of ["accepted", "declined", "rejected", "withdrawn", "expired"] as const) expect(mayMove(status, "withdraw"), status).toBe(false);
  });

  it("leaves every terminal status with no move out of it", () => {
    for (const status of ["rejected", "declined", "withdrawn", "expired", "accepted"] as const) {
      const moves = (["submit", "approve", "reject", "send", "accept", "decline", "withdraw", "expire", "edit"] as const).filter((move) => mayMove(status, move));
      expect(moves, status).toEqual([]);
    }
  });

  it("knows every status it was given", () => {
    // A status added to the enum and forgotten here would silently accept no move at all.
    for (const status of OFFER_STATUSES) expect(typeof mayMove(status, "withdraw")).toBe("boolean");
  });
});

describe("expiry is read from the clock, not from a job", () => {
  it("lapses an offer whose last day has passed", () => {
    expect(offerExpiredOn({ status: "sent", expiresOn: "2026-09-19" }, TODAY)).toBe(true);
    // Inclusive: the last day it stands is a day it stands.
    expect(offerExpiredOn({ status: "sent", expiresOn: TODAY }, TODAY)).toBe(false);
  });

  it("does not lapse what is already finished", () => {
    expect(offerExpiredOn({ status: "accepted", expiresOn: "2020-01-01" }, TODAY)).toBe(false);
    expect(offerExpiredOn({ status: "declined", expiresOn: "2020-01-01" }, TODAY)).toBe(false);
    expect(offerExpiredOn({ status: "draft", expiresOn: "2020-01-01" }, TODAY)).toBe(false);
  });

  it("reports the status the calendar actually leaves it at", () => {
    expect(effectiveOfferStatus({ status: "sent", expiresOn: "2026-09-01" }, TODAY)).toBe("expired");
    expect(effectiveOfferStatus({ status: "sent", expiresOn: "2026-09-30" }, TODAY)).toBe("sent");
  });
});

describe("what an offer may say", () => {
  it("accepts an ordinary offer", () => {
    expect(offerProblems(draft(), TODAY)).toEqual([]);
  });

  it("refuses a figure that is not whole positive đồng", () => {
    expect(offerProblems(draft({ baseSalaryVnd: 0 }), TODAY)).toContain("offer_amount_invalid");
    expect(offerProblems(draft({ baseSalaryVnd: -1 }), TODAY)).toContain("offer_amount_invalid");
    expect(offerProblems(draft({ baseSalaryVnd: 22_000_000.5 }), TODAY)).toContain("offer_amount_invalid");
    expect(offerProblems(draft({ baseSalaryVnd: Number.NaN }), TODAY)).toContain("offer_amount_invalid");
    expect(offerProblems(draft({ baseSalaryVnd: 9_000_000_000 }), TODAY)).toContain("offer_amount_too_large");
    expect(offerProblems(draft({ allowancesVnd: -5 }), TODAY)).toContain("offer_allowances_invalid");
    // Nothing on top of the base is perfectly ordinary.
    expect(offerProblems(draft({ allowancesVnd: 0 }), TODAY)).toEqual([]);
  });

  it("refuses a start date that has already been and gone", () => {
    expect(offerProblems(draft({ startDate: "2026-09-19", expiresOn: "2026-09-19" }), TODAY)).toContain("offer_start_date_past");
    // Starting today is late notice, not an error.
    expect(offerProblems(draft({ startDate: TODAY, expiresOn: TODAY }), TODAY)).toEqual([]);
  });

  it("refuses an offer that outlives the day the person is due at their desk", () => {
    expect(offerProblems(draft({ startDate: "2026-10-05", expiresOn: "2026-10-06" }), TODAY)).toContain("offer_expiry_after_start");
    expect(offerProblems(draft({ expiresOn: "2026-09-01" }), TODAY)).toContain("offer_expiry_past");
    // Expiring on the start date itself is the tightest honest offer.
    expect(offerProblems(draft({ startDate: "2026-10-05", expiresOn: "2026-10-05" }), TODAY)).toEqual([]);
  });

  it("holds probation to the Labour Code's shape", () => {
    expect(offerProblems(draft({ probationMonths: 7 }), TODAY)).toContain("offer_probation_invalid");
    expect(offerProblems(draft({ probationMonths: -1 }), TODAY)).toContain("offer_probation_invalid");
    // No probation at all is a decision, not a mistake.
    expect(offerProblems(draft({ probationMonths: 0 }), TODAY)).toEqual([]);
    expect(offerProblems(draft({ probationSalaryPercent: 80 }), TODAY)).toContain("offer_probation_percent_invalid");
    expect(offerProblems(draft({ probationSalaryPercent: 101 }), TODAY)).toContain("offer_probation_percent_invalid");
    expect(offerProblems(draft({ probationSalaryPercent: 100 }), TODAY)).toEqual([]);
  });

  it("refuses an offer with no job title", () => {
    expect(offerProblems(draft({ positionName: "   " }), TODAY)).toContain("offer_position_empty");
  });
});

describe("the arithmetic", () => {
  it("adds the package up once", () => {
    expect(offerTotalVnd({ baseSalaryVnd: 22_000_000, allowancesVnd: 1_500_000 })).toBe(23_500_000);
  });

  it("pays probation at the agreed share, rounded to the đồng", () => {
    expect(probationMonthlyVnd({ baseSalaryVnd: 22_000_000, allowancesVnd: 1_500_000, probationSalaryPercent: 85 })).toBe(19_975_000);
    // 85% of 10,000,001 is 8,500,000.85 — a payslip has no hào on it.
    expect(probationMonthlyVnd({ baseSalaryVnd: 10_000_001, allowancesVnd: 0, probationSalaryPercent: 85 })).toBe(8_500_001);
    expect(Number.isInteger(probationMonthlyVnd({ baseSalaryVnd: 7_777_777, allowancesVnd: 333_333, probationSalaryPercent: 87 }))).toBe(true);
  });
});

describe("the default expiry", () => {
  it("gives the candidate a week", () => {
    expect(defaultExpiry("2026-11-01", TODAY, 7)).toBe("2026-09-27");
  });

  it("never stands past the start date", () => {
    expect(defaultExpiry("2026-09-23", TODAY, 7)).toBe("2026-09-23");
  });
});
