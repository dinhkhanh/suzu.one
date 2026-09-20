// The owner's view of who is paid "salary only" and for how long (FR-PAY-08, risk R11). Pure.
// It judges nothing: it shows where a basis may have run out, so the owner can ask the chief
// accountant. The limits come from the statutory store.
import type { SimpleBasis } from "../enums";

export type ExposureFlag = "review_date_passed" | "probation_longer_than_limit" | "short_term_longer_than_a_month" | "service_contract_with_labour_contract" | "no_basis_document";

export type ExposureInput = {
  basis: SimpleBasis;
  /** First day of the unbroken stretch on the Simple profile. */
  since: string;
  reviewDate: string | null;
  contractType: string | null;
  today: string;
  /** The longest probation the law allows for anyone (enterprise managers), in days. */
  longestProbationDays: number;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Whole months from `since` to `today` (a month is complete on the same day number). */
export function monthsOn(since: string, today: string): number {
  if (today < since) return 0;
  const [fromYear, fromMonth, fromDay] = since.split("-").map(Number);
  const [toYear, toMonth, toDay] = today.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) - (toDay < fromDay ? 1 : 0);
}

export function exposureFlags(input: ExposureInput): ExposureFlag[] {
  const flags: ExposureFlag[] = [];
  const days = daysBetween(input.since, input.today) + 1;
  if (input.reviewDate && input.reviewDate <= input.today) flags.push("review_date_passed");
  if (input.basis === "probation" && days > input.longestProbationDays) flags.push("probation_longer_than_limit");
  if (input.basis === "short_term" && monthsOn(input.since, input.today) >= 1) flags.push("short_term_longer_than_a_month");
  if (input.basis === "service_contract" && input.contractType !== null && ["fixed_term", "indefinite"].includes(input.contractType)) flags.push("service_contract_with_labour_contract");
  if (input.contractType === null) flags.push("no_basis_document");
  return flags;
}
