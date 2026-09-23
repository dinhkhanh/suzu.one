// Whether a referral has earned its bonus (FR-REC-10). Pure: no I/O, no clock of its own.
//
// The state is **read from the facts, never stored**, for the same reason an offer's expiry is
// (`engine/offer.ts`): a stored flag is a claim that was true once and may not be true now. The one
// thing that *is* stored is the moment somebody settled the bonus, because "we have already paid
// this" is not derivable from anything else.
//
// **No amount appears in this file.** What a referral bonus is worth is company policy and it is
// paid through payroll; all recruitment does is say when one has been earned.

import type { IsoDate } from "@/lib/dates";
import type { ApplicationStatus } from "../enums";

/**
 * · `pending` — the person referred is still going through the pipeline, or has been hired and is
 *   still inside their probation. Nothing is owed yet, and it still might be.
 * · `earned` — the hire is past probation and nobody has settled it. This is the list HR works from.
 * · `settled` — somebody marked it paid. Terminal, and the only state that needs a stored column.
 * · `not_earned` — the application ended without a hire. Terminal.
 */
export const REFERRAL_BONUS_STATES = ["pending", "earned", "settled", "not_earned"] as const;
export type ReferralBonusState = (typeof REFERRAL_BONUS_STATES)[number];

/** How long a referred hire must stay before the bonus is earned. Company practice, in one place. */
export const REFERRAL_PROBATION_MONTHS = 2;

export type ReferralFacts = {
  applicationStatus: ApplicationStatus;
  /** The person record the accepted candidate became, if it happened. */
  hired: boolean;
  /** The hire's first working day. Null while there is no hire. */
  startDate: IsoDate | null;
  /**
   * Probation as the offer put it, in months. Null falls back to `REFERRAL_PROBATION_MONTHS` —
   * an offer with no probation term does not thereby pay a bonus on the first morning.
   */
  probationMonths: number | null;
  /** Already settled: the stored column, and the only input that is not a derived fact. */
  settled: boolean;
  /**
   * The application existed before the referral: the candidate had applied, or a recruiter had
   * added them, before the colleague spoke up. They were not brought in by the referral, so it
   * earns nothing, however the application ends.
   */
  preexisting?: boolean;
};

/**
 * The day a referral's bonus becomes earned: the start date plus the probation term, clamped to a
 * real calendar day. `2026-01-31` + 1 month is `2026-02-28`, not the 3rd of March — `Date.UTC`
 * rolls an impossible day forward, so the result is pulled back to the end of the month it meant.
 */
export function bonusEarnedOn(startDate: IsoDate, probationMonths: number | null): IsoDate {
  const months = probationMonths === null || probationMonths < 0 ? REFERRAL_PROBATION_MONTHS : probationMonths;
  const [year, month, day] = startDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, day));
  // Did the day survive the month it landed in? (31 January + 1 month lands on 3 March.)
  const lastOfTarget = new Date(Date.UTC(year, month + months, 0));
  const clamped = target.getUTCDate() === day ? target : lastOfTarget;
  return clamped.toISOString().slice(0, 10) as IsoDate;
}

/** Where one referral stands today. */
export function referralBonusState(facts: ReferralFacts, today: IsoDate): ReferralBonusState {
  if (facts.settled) return "settled";
  if (facts.preexisting) return "not_earned";
  // Rejected, withdrawn — the pipeline ended without a colleague. Nothing is owed.
  if (facts.applicationStatus === "rejected" || facts.applicationStatus === "withdrawn") return "not_earned";
  // Hired is a status; being on the books is a person record. Both are required: an application
  // marked hired whose conversion never happened has nobody serving a probation.
  if (facts.applicationStatus !== "hired" || !facts.hired || !facts.startDate) return "pending";
  return bonusEarnedOn(facts.startDate, facts.probationMonths) <= today ? "earned" : "pending";
}
