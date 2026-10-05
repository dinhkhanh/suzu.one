// The retention schedule (NFR-PRV-04) and the consent rules (NFR-PRV-01, 02). Pure.
//
// These are the company's periods, not legal rates: the law says how long some records must be
// KEPT (below), and the company decides how soon what is not required goes. The owner may move any
// of them; each says why it is what it is. docs/privacy/ carries the same schedule in prose.

import { addDays, type IsoDate } from "@/lib/dates";

/**
 * Former employees: their personal details — contact details, emergency contacts, the vault's
 * scans of IDs and diplomas, the profile picture, their app account and inbox — are kept this many
 * years after the last day of their last employment, then anonymised once HR confirms it.
 *
 * Three years outlasts the time limits in which the employment can still be argued over: a year
 * for an individual labour dispute (Labour Code 2019, art. 190) and three for a civil claim on the
 * contract (Civil Code 2015, art. 429). It does NOT govern what anonymisation leaves alone: payroll,
 * tax and insurance records — the payslips and runs, contracts, employment periods, timesheets,
 * leave, identity and tax numbers, dependants claimed for PIT — are accounting documents kept at
 * least ten years (Accounting Law 88/2015/QH13, art. 41; Decree 174/2016, art. 12) and are never
 * touched by it (SRS NFR-PRV-04: "payroll records: per accounting law").
 */
export const FORMER_EMPLOYEE_RETENTION_YEARS = 3;

/**
 * The exact position, network address and browser details of a check-in from the app. The punch
 * itself (its time, its verdict, the office it matched and how far away) stays with the timesheet;
 * the coordinates are only needed while the check-in can still be reviewed, the month confirmed and
 * paid, and a complaint about it raised. Ninety days covers a month's lock, its payroll on the 5th
 * and two months of second thoughts. A check-in still waiting for review keeps its position.
 */
export const PUNCH_POSITION_RETENTION_DAYS = 90;

/**
 * Conversations with the assistant untouched for this long are deleted with their messages, and so
 * are questions the knowledge base could not answer that were logged this long ago. Half a year is
 * long enough to find last season's answer again and to write the missing page.
 */
export const AI_CONVERSATION_RETENTION_DAYS = 180;

/**
 * The GPS notice the check-in key shows (`messages: privacy.gpsNotice`). Change the words in a way
 * that matters and change this too: everyone is asked again, and the earlier answers stay on record
 * with the words they answered.
 */
export const GPS_NOTICE_VERSION = "gps-2026-10";

/** The day a former employee's personal details become due for anonymisation. */
export function anonymisationDueOn(lastDay: IsoDate, years: number = FORMER_EMPLOYEE_RETENTION_YEARS): IsoDate {
  const [year, month, day] = lastDay.split("-").map(Number);
  // 29 February plus whole years lands on 28 February, never on 1 March.
  const target = new Date(Date.UTC(year + years, month - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastOfMonth));
  return addDays(target.toISOString().slice(0, 10), 1);
}

/** The cut-off a nightly sweep compares against: everything strictly older than this goes. */
export const cutoffBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

export type ConsentState = "unanswered" | "given" | "declined" | "withdrawn";

/**
 * Where a person stands on the GPS notice, from their latest answer. An answer to an older version
 * of the notice is no answer: they are asked again (a withdrawal stands whatever the version).
 */
export function gpsConsentState(latest: { decision: "given" | "declined" | "withdrawn"; noticeVersion: string | null } | null, currentVersion: string = GPS_NOTICE_VERSION): ConsentState {
  if (!latest) return "unanswered";
  if (latest.decision === "withdrawn") return "withdrawn";
  return latest.noticeVersion === currentVersion ? latest.decision : "unanswered";
}
