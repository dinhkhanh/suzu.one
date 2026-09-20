// The colour of an obligation on the list, the calendar and the dashboard (FR-OPS-07). Pure.
import { addDays, type IsoDate } from "@/lib/dates";
import type { StatusColour } from "../enums";

export type StatusFacts = { status: "todo" | "in_progress" | "done" | "cancelled"; dueDate: IsoDate | null; completedLate?: boolean | null };

export const DUE_SOON_DAYS = 7;

export function statusColour(facts: StatusFacts, today: IsoDate, dueSoonDays: number = DUE_SOON_DAYS): StatusColour {
  if (facts.status === "cancelled") return "cancelled";
  if (facts.status === "done") return facts.completedLate ? "done_late" : "done";
  if (!facts.dueDate) return "upcoming";
  if (facts.dueDate < today) return "overdue";
  return facts.dueDate <= addDays(today, dueSoonDays) ? "due_soon" : "upcoming";
}

/** Late = finished after the (shifted) due date. The submitted date on the evidence counts when there is one: a receipt dated in time is in time even if it was filed here a day later. */
export function isCompletedLate(dueDate: IsoDate | null, completedOn: IsoDate, submittedDate: IsoDate | null): boolean {
  if (!dueDate) return false;
  return (submittedDate ?? completedOn) > dueDate;
}

export type EvidenceGiven = { files: number; referenceNumber: string | null; submittedDate: IsoDate | null; amountPaid: number | null };

/** What the template asks for and the instance does not have yet (FR-OPS-05); empty = may be closed. */
export function missingEvidence(required: { file: boolean; reference: boolean; submittedDate: boolean; amount: boolean }, given: EvidenceGiven): ("file" | "reference" | "submittedDate" | "amount")[] {
  const missing: ("file" | "reference" | "submittedDate" | "amount")[] = [];
  if (required.file && given.files === 0) missing.push("file");
  if (required.reference && !given.referenceNumber?.trim()) missing.push("reference");
  if (required.submittedDate && !given.submittedDate) missing.push("submittedDate");
  if (required.amount && given.amountPaid === null) missing.push("amount");
  return missing;
}
