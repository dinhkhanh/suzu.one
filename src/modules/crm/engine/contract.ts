// Contracts and money after delivery, pure (FR-CRM-25, 26, 30, 32): a contract's state read from its
// dates, when a renewal opens, which payment terms an invoice takes, and how an unpaid amount ages.
import { addDays, type IsoDate } from "@/lib/dates";
import type { AgingBucket, ContractStatus } from "../enums";

export type ContractState = "draft" | "upcoming" | "active" | "expired" | "terminated";

/** Stored status plus the dates: a signed contract is upcoming, active or expired depending on today. */
export function contractState(contract: { status: ContractStatus | string; startDate: IsoDate | null; endDate: IsoDate | null }, today: IsoDate): ContractState {
  if (contract.status === "terminated") return "terminated";
  if (contract.status !== "signed") return "draft";
  if (contract.startDate && contract.startDate > today) return "upcoming";
  if (contract.endDate && contract.endDate < today) return "expired";
  return "active";
}

/** Should a renewal deal be open for something ending on `endDate`? From `leadDays` before its end until it has ended. */
export function renewalDue(endDate: IsoDate | null, today: IsoDate, leadDays: number): boolean {
  if (!endDate) return false;
  return endDate >= today && endDate <= addDays(today, leadDays);
}

/** The last day of a "2026-12" month. */
export function monthEnd(month: string): IsoDate {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

/** An invoice's payment terms: the contract's, else the account's, else the entity default from the settings. */
export const paymentTerms = (contractDays: number | null | undefined, accountDays: number | null | undefined, defaultDays: number): number => contractDays ?? accountDays ?? defaultDays;

/** Days an unpaid invoice is past its due date (0 when not yet due). */
export const daysPastDue = (dueOn: IsoDate, today: IsoDate): number => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000));

export function agingBucket(dueOn: IsoDate, today: IsoDate): AgingBucket {
  const days = daysPastDue(dueOn, today);
  if (days === 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/**
 * Which reminder thresholds (days past due) an overdue invoice has crossed and not been reminded
 * of yet. Only the highest is sent — an invoice found 40 days late is one reminder, not three.
 */
export function reminderDue(dueOn: IsoDate, today: IsoDate, thresholds: readonly number[], sent: readonly number[]): number | null {
  const days = daysPastDue(dueOn, today);
  const crossed = thresholds.filter((threshold) => threshold > 0 && days >= threshold && !sent.includes(threshold));
  return crossed.length ? Math.max(...crossed) : null;
}

/** VAT on an invoice's subtotal, rounded half up to the dong — the same rounding as a quote's. */
export const vatOf = (subtotalVnd: number, vatRateBp: number): number => Math.round((subtotalVnd * vatRateBp) / 10_000);

/** Open → paid once payments reach the total; "part paid" is shown, never stored. A draft and a voided invoice owe nothing. */
export function invoiceStanding(totalVnd: number, paidVnd: number, status: string): "draft" | "open" | "part_paid" | "paid" | "written_off" | "void" {
  if (status === "written_off" || status === "draft" || status === "void") return status;
  if (paidVnd >= totalVnd) return "paid";
  return paidVnd > 0 ? "part_paid" : "open";
}
