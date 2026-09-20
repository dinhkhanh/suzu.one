// The legal rules a contract must pass before it is saved (FR-CHR-05). Pure: the limits come from
// the statutory parameter store ("contract.fixed_term", "probation.limits"), never from here.
import { addDays, type IsoDate } from "@/lib/dates";

export type ContractType = "probation" | "fixed_term" | "indefinite" | "service" | "internship" | "nda" | "appendix";
export type JobCategory = "manager" | "professional" | "intermediate" | "other";

export type ContractLimits = {
  fixedTerm: { maxMonths: number; maxFixedTermRenewals: number };
  probation: { managerDays: number; professionalDays: number; intermediateDays: number; otherDays: number };
};

export type ContractDraft = { type: ContractType; startDate: IsoDate; endDate: IsoDate | null; jobCategory: JobCategory | null; parentContractId: string | null };
// The other contracts of the same employment (never the one being edited).
export type ExistingContract = { id: string; type: ContractType; startDate: IsoDate; endDate: IsoDate | null; terminatedOn: IsoDate | null };

export type ContractProblem =
  | "contract_end_before_start"
  | "contract_indefinite_has_end"
  | "contract_end_required"
  | "contract_fixed_term_too_long"
  | "contract_must_be_indefinite"
  | "contract_job_category_required"
  | "contract_probation_too_long"
  | "contract_probation_repeated"
  | "contract_appendix_needs_parent"
  | "contract_parent_not_found"
  | "contract_overlap";

// The contracts that *are* the employment relationship; only one runs at a time.
const LABOUR: readonly ContractType[] = ["probation", "fixed_term", "indefinite"];
export const isLabourContract = (type: ContractType) => LABOUR.includes(type);

/** The day `months` calendar months after `date`; the 31st of a short month lands on its last day. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const lastDayOf = (row: { endDate: IsoDate | null; terminatedOn: IsoDate | null }) => (row.terminatedOn && (!row.endDate || row.terminatedOn < row.endDate) ? row.terminatedOn : row.endDate);

export function probationLimitDays(limits: ContractLimits["probation"], category: JobCategory): number {
  return { manager: limits.managerDays, professional: limits.professionalDays, intermediate: limits.intermediateDays, other: limits.otherDays }[category];
}

/** Every rule the draft breaks, most basic first. An empty list means it may be saved. */
export function checkContract(draft: ContractDraft, existing: readonly ExistingContract[], limits: ContractLimits): ContractProblem[] {
  const problems: ContractProblem[] = [];
  if (draft.endDate && draft.endDate < draft.startDate) return ["contract_end_before_start"];

  if (draft.type === "appendix") {
    if (!draft.parentContractId) problems.push("contract_appendix_needs_parent");
    else if (!existing.some((row) => row.id === draft.parentContractId && row.type !== "appendix")) problems.push("contract_parent_not_found");
  }

  if (draft.type === "indefinite" && draft.endDate) problems.push("contract_indefinite_has_end");

  if (draft.type === "fixed_term") {
    if (!draft.endDate) problems.push("contract_end_required");
    // "No more than 36 months": a contract from 1 Jan runs to 31 Dec three years on at the latest.
    else if (draft.endDate > addDays(addMonths(draft.startDate, limits.fixedTerm.maxMonths), -1)) problems.push("contract_fixed_term_too_long");
    // Article 20: a fixed term may be followed by one more fixed term; after that, indefinite only.
    if (existing.filter((row) => row.type === "fixed_term").length > limits.fixedTerm.maxFixedTermRenewals) problems.push("contract_must_be_indefinite");
  }

  if (draft.type === "probation") {
    if (!draft.endDate) problems.push("contract_end_required");
    if (!draft.jobCategory) problems.push("contract_job_category_required");
    if (draft.endDate && draft.jobCategory && daysBetween(draft.startDate, draft.endDate) + 1 > probationLimitDays(limits.probation, draft.jobCategory)) problems.push("contract_probation_too_long");
    // Article 25: one probation per job.
    if (existing.some((row) => row.type === "probation")) problems.push("contract_probation_repeated");
  }

  if (isLabourContract(draft.type)) {
    const overlaps = existing.some((row) => {
      if (!isLabourContract(row.type)) return false;
      const rowEnd = lastDayOf(row);
      return (rowEnd === null || rowEnd >= draft.startDate) && (draft.endDate === null || row.startDate <= draft.endDate);
    });
    if (overlaps) problems.push("contract_overlap");
  }
  return problems;
}
