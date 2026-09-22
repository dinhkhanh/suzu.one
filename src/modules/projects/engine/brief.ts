// The project brief and its kick-off gate (FR-PJM-01, 03). Pure.
import type { ProjectBrief } from "../schema";

/** FR-PJM-01. The type decides which planning and delivery features apply. */
export const PROJECT_KINDS = ["client", "retainer", "pitch", "internal"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

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

/** The brief can be edited while it is not waiting at the gate; an approved brief changes only through a change request later. */
export const briefEditable = (status: BriefStatus): boolean => status === "draft" || status === "returned";
export const briefSubmittable = (status: BriefStatus): boolean => status === "draft" || status === "returned";
