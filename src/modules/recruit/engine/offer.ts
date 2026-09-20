// The offer, as arithmetic and a state machine (FR-REC-08). Pure: no I/O, no clock of its own —
// every function that needs "today" is handed it, so a test can stand anywhere in the year.
//
// Two rules live here rather than in the service, because they are the ones that must not be
// reasoned about twice:
//
//   · **What may follow what.** An offer that has been sent cannot be edited, an offer that was
//     never approved cannot be sent, and an offer the candidate answered is finished. `nextStatus`
//     is the whole of that, and the service asks it rather than remembering it.
//   · **What an offer may say.** A figure that is not a whole positive number of đồng is not a
//     salary; a start date in the past is a typo; an offer that expires after the candidate is
//     due to start is not an offer, it is a trap.
import { addDays, type IsoDate } from "@/lib/dates";
import { OFFER_LIMITS, type OfferStatus } from "../enums";

// ── The state machine ───────────────────────────────────────────────────────────────────────

/** Everything anybody may do to an offer. `expire` is the clock's move, not a person's. */
export type OfferMove = "submit" | "approve" | "reject" | "send" | "accept" | "decline" | "withdraw" | "expire" | "edit";

const MOVES: Record<OfferMove, { from: readonly OfferStatus[]; to: OfferStatus }> = {
  // Editing is a move that changes nothing: it is here so that "may I still edit this?" is the
  // same question, answered by the same table, as "may I still send it?".
  edit: { from: ["draft"], to: "draft" },
  submit: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "approved" },
  // The company's own refusal. The candidate never hears of it; it is not a decline.
  reject: { from: ["pending_approval"], to: "rejected" },
  send: { from: ["approved"], to: "sent" },
  accept: { from: ["sent"], to: "accepted" },
  decline: { from: ["sent"], to: "declined" },
  // Taking it off the table. Possible right up to the moment the candidate answers — after that
  // there is nothing to withdraw.
  withdraw: { from: ["draft", "pending_approval", "approved", "sent"], to: "withdrawn" },
  expire: { from: ["approved", "sent"], to: "expired" },
};

export const mayMove = (status: OfferStatus, move: OfferMove): boolean => MOVES[move].from.includes(status);

/** The status after `move`, or null when the move is not open from here. */
export const nextStatus = (status: OfferStatus, move: OfferMove): OfferStatus | null => (mayMove(status, move) ? MOVES[move].to : null);

/**
 * Has this offer lapsed? Read from the clock rather than stored, so an offer does not stay alive
 * because a scheduled job did not run. `expiresOn` is the last day it stands, inclusive.
 */
export const offerExpiredOn = (offer: { status: OfferStatus; expiresOn: IsoDate }, today: IsoDate): boolean => mayMove(offer.status, "expire") && offer.expiresOn < today;

/** What the offer is *really* at, once the calendar has had its say. */
export const effectiveOfferStatus = (offer: { status: OfferStatus; expiresOn: IsoDate }, today: IsoDate): OfferStatus => (offerExpiredOn(offer, today) ? "expired" : offer.status);

// ── What an offer may say ───────────────────────────────────────────────────────────────────

export type OfferProblem =
  | "offer_amount_invalid"
  | "offer_amount_too_large"
  | "offer_allowances_invalid"
  | "offer_start_date_past"
  | "offer_expiry_past"
  | "offer_expiry_after_start"
  | "offer_probation_invalid"
  | "offer_probation_percent_invalid"
  | "offer_position_empty";

export type OfferDraft = {
  positionName: string;
  startDate: IsoDate;
  expiresOn: IsoDate;
  baseSalaryVnd: number;
  allowancesVnd: number;
  probationMonths: number;
  probationSalaryPercent: number;
};

const wholeDong = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/**
 * Everything wrong with a draft offer, as message keys. Called before anything is written and
 * again before it is submitted for approval, because the second is the one that matters: an
 * approver should never be shown a figure the form would have refused.
 */
export function offerProblems(draft: OfferDraft, today: IsoDate): OfferProblem[] {
  const problems: OfferProblem[] = [];
  if (!draft.positionName.trim()) problems.push("offer_position_empty");

  if (!wholeDong(draft.baseSalaryVnd) || draft.baseSalaryVnd <= 0) problems.push("offer_amount_invalid");
  else if (draft.baseSalaryVnd > OFFER_LIMITS.maxMonthlyVnd) problems.push("offer_amount_too_large");
  if (!wholeDong(draft.allowancesVnd) || draft.allowancesVnd > OFFER_LIMITS.maxMonthlyVnd) problems.push("offer_allowances_invalid");

  if (draft.startDate < today) problems.push("offer_start_date_past");
  if (draft.expiresOn < today) problems.push("offer_expiry_past");
  // An offer that stands past the day the person is due at their desk asks them to accept a job
  // they have already failed to start.
  else if (draft.expiresOn > draft.startDate) problems.push("offer_expiry_after_start");

  if (!Number.isSafeInteger(draft.probationMonths) || draft.probationMonths < 0 || draft.probationMonths > OFFER_LIMITS.probationMonths) problems.push("offer_probation_invalid");
  // Vietnam's Labour Code puts a floor under probation pay (85% of the agreed wage, art. 26).
  // The floor is here rather than in a statutory table because it is a *validation* of what may be
  // typed, not a rate anything is calculated from.
  if (!Number.isSafeInteger(draft.probationSalaryPercent) || draft.probationSalaryPercent < OFFER_LIMITS.probationPercentMin || draft.probationSalaryPercent > 100) problems.push("offer_probation_percent_invalid");

  return problems;
}

/** Total monthly package. One place, so the letter and the screen cannot disagree. */
export const offerTotalVnd = (offer: { baseSalaryVnd: number; allowancesVnd: number }): number => offer.baseSalaryVnd + offer.allowancesVnd;

/** What the probation months are actually paid, rounded to the đồng the way a payslip would be. */
export const probationMonthlyVnd = (offer: { baseSalaryVnd: number; allowancesVnd: number; probationSalaryPercent: number }): number =>
  Math.round((offerTotalVnd(offer) * offer.probationSalaryPercent) / 100);

/** The default last day an offer stands: a week, but never past the day the job starts. */
export function defaultExpiry(startDate: IsoDate, today: IsoDate, validDays: number): IsoDate {
  const week = addDays(today, validDays);
  return week > startDate ? startDate : week;
}
