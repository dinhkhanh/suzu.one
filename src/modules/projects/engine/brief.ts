// The project brief and its kick-off gate (FR-PJM-01, 03). Pure.
import type { ProjectBrief } from "../schema";

/** FR-PJM-01. The type decides which planning and delivery features apply. */
export const PROJECT_KINDS = ["client", "retainer", "pitch", "internal"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * Work done for a client under contract: a client project and a retainer. These answer to the
 * client — a unit of their register is accepted on the client's word, not on the task being done
 * (FR-PJM-05) — and they move by the gates: Active through the kick-off, Done through the close-out
 * (FR-PJM-03, 59). An internal project has no client, and a pitch lives and ends with its deal in
 * the CRM: both are accepted when done and change status freely.
 */
export const isClientWork = (kind: string | null | undefined): boolean => kind === "client" || kind === "retainer";

/** draft → submitted → approved, or returned to the author with a comment and submitted again. */
export const BRIEF_STATUSES = ["draft", "submitted", "approved", "returned"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

/**
 * What a brief must say before it can go to the kick-off gate. An internal project has no client,
 * so no success criteria are asked of the client side; every brief needs an objective and a scope.
 */
export function briefProblems(brief: ProjectBrief, kind: ProjectKind): ("objective" | "scopeIn" | "successCriteria")[] {
  const blank = (value: string | undefined) => !value || value.trim() === "";
  const problems: ("objective" | "scopeIn" | "successCriteria")[] = [];
  if (blank(brief.objective)) problems.push("objective");
  if (blank(brief.scopeIn)) problems.push("scopeIn");
  if (kind !== "internal" && kind !== "pitch" && blank(brief.successCriteria)) problems.push("successCriteria");
  return problems;
}

/**
 * The brief can be edited while it is not waiting at the gate. Once approved, what was agreed —
 * objective, scope, success criteria, the rest of its text — changes only through a change request
 * or a new approval; who to call and where the files are (`BRIEF_OPEN_FIELDS`) is not part of the
 * agreement and stays editable.
 */
export const briefEditable = (status: BriefStatus): boolean => status === "draft" || status === "returned";
export const BRIEF_OPEN_FIELDS = ["clientContacts", "links"] as const satisfies readonly (keyof ProjectBrief)[];
/** Contacts and links of an approved brief: the people and the folders change while the work runs. */
export const briefContactsEditable = (status: BriefStatus): boolean => status === "approved";
/** An approved brief with new contacts and links, every agreed field as it was. */
export const withOpenFields = (brief: ProjectBrief, open: Pick<ProjectBrief, (typeof BRIEF_OPEN_FIELDS)[number]>): ProjectBrief => {
  const next: ProjectBrief = { ...brief };
  for (const field of BRIEF_OPEN_FIELDS) {
    delete next[field];
    if (open[field]?.length) Object.assign(next, { [field]: open[field] });
  }
  return next;
};
export const briefSubmittable = (status: BriefStatus): boolean => status === "draft" || status === "returned";
