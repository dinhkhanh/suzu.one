// Candidate data retention (FR-REC-13, PDPL). Pure: what is due, and when. The scrubbing itself
// is in `jobs.ts`, because it writes.
//
// The rule the law actually asks for is narrow, and so is this file: somebody who applied for a
// job and did not get it should not still be on file years later. Four things stop the clock, and
// each of them is a fact rather than a preference:
//
//   · they **consented to the talent pool** — the one thing a candidate may ask for, and the only
//     thing that extends the window (the public form asks for it separately from the privacy
//     notice, precisely so that agreeing to be considered is not agreeing to be kept);
//   · they are **still being considered** — an open application is live processing, not a record;
//   · they **became a colleague** — the employee register keeps its own records under its own
//     retention, and hollowing out the application they were hired from would erase how they came
//     to be here;
//   · they have **already been anonymised** — the job must be safe to run twice a day forever.
//
// Anonymising, not deleting: the rows stay so the funnel report can still count them, with
// everything that says who the person was taken out. A count is not personal data; a name is.

import type { IsoDate } from "@/lib/dates";
import { DEFAULT_RETENTION_MONTHS } from "../enums";

export const RETENTION_OUTCOMES = ["anonymise", "consented", "in_progress", "hired", "already_done", "not_due"] as const;
export type RetentionOutcome = (typeof RETENTION_OUTCOMES)[number];

export type RetentionFacts = {
  /** The date written on the candidate when they came in. Null falls back to the default window. */
  retainUntil: IsoDate | null;
  /** The day the record was created, used only when `retainUntil` is missing. */
  createdOn: IsoDate;
  talentPoolConsent: boolean;
  anonymised: boolean;
  /** Any application still open: they are in a live process, not in an archive. */
  hasOpenApplication: boolean;
  /** Any application that became a person record. */
  hasHire: boolean;
};

/** Today plus the window, clamped to a real calendar day (31 Jan + 1 month is 28 Feb). */
export function retainUntilFrom(from: IsoDate, months: number = DEFAULT_RETENTION_MONTHS): IsoDate {
  const [year, month, day] = from.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, day));
  const lastOfTarget = new Date(Date.UTC(year, month + months, 0));
  return (target.getUTCDate() === day ? target : lastOfTarget).toISOString().slice(0, 10) as IsoDate;
}

/**
 * The date this record is actually kept until. A candidate written before the column existed, or
 * created by a path that forgot it, is not thereby kept forever: the window runs from the day the
 * record was made.
 */
export const effectiveRetainUntil = (facts: Pick<RetentionFacts, "retainUntil" | "createdOn">): IsoDate => facts.retainUntil ?? retainUntilFrom(facts.createdOn);

/**
 * What should happen to one candidate today. The order matters and is the order of the reasons at
 * the top of this file: every "keep" reason is checked before the clock, so a consented or a still-
 * live record is never anonymised by a window that happened to lapse.
 */
export function retentionOutcome(facts: RetentionFacts, today: IsoDate): RetentionOutcome {
  if (facts.anonymised) return "already_done";
  if (facts.hasHire) return "hired";
  if (facts.hasOpenApplication) return "in_progress";
  if (facts.talentPoolConsent) return "consented";
  return effectiveRetainUntil(facts) < today ? "anonymise" : "not_due";
}

export const isDue = (facts: RetentionFacts, today: IsoDate): boolean => retentionOutcome(facts, today) === "anonymise";

/**
 * How long the rate limiter's counters are kept. They are hashes of addresses with an hour's
 * resolution and they are useless the moment their window has passed; a week is generous, and is
 * there only so that a burst can still be looked at the morning after.
 */
export const PUBLIC_HIT_RETENTION_DAYS = 7;

/** What an anonymised candidate is called. Not a blank: a blank row looks like a bug. */
export const ANONYMISED_NAME = "Ứng viên đã ẩn danh";
