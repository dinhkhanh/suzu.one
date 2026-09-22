// Change requests (FR-PJM-11): a delta on a project's scope, hours, fee and due date that applies
// only once it is approved. Pure: no I/O.
//
// The history is "original + change requests = current": each approved change keeps the figures
// the plan had just before it was applied, so the original is what the first change found and
// every step after it is one change's delta.
import type { IsoDate } from "@/lib/dates";
import type { ChangeImpact } from "../schema";

export const CHANGE_STATUSES = ["draft", "submitted", "approved", "rejected", "withdrawn"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_REQUESTERS = ["client", "internal"] as const;
export type ChangeRequester = (typeof CHANGE_REQUESTERS)[number];

/** A draft — or a change returned for rework — is its author's to edit; anything further is not. */
export const changeEditable = (status: ChangeStatus): boolean => status === "draft";

export type ChangeDraft = { title: string; requestedBy: ChangeRequester; impact: ChangeImpact; evidenceFileId: string | null; evidenceUrl: string | null };

/**
 * What stops a change from going to approval. A change the client asked for needs the client's
 * word on file (a scan, an email saved as a file, or a link); a change that changes nothing is not
 * a change.
 */
export function changeProblems(draft: ChangeDraft): string[] {
  const problems: string[] = [];
  if (!draft.title.trim()) problems.push("change_title_required");
  if (draft.requestedBy === "client" && !draft.evidenceFileId && !draft.evidenceUrl) problems.push("change_evidence_required");
  if (!hasImpact(draft.impact)) problems.push("change_empty");
  return problems;
}

export const hasImpact = (impact: ChangeImpact): boolean => !!(impact.deliverables?.length || impact.cancelDeliverableIds?.length || impact.minutesDelta || impact.feeDeltaVnd || impact.dueDateTo);

/** A fee change needs a second approver with `pjm:commercial` — the flow's condition reads this. */
export const hasFeeChange = (impact: ChangeImpact): boolean => !!impact.feeDeltaVnd;

/** The fee part of a change taken out, for a reader without `pjm:commercial`. */
export function withoutFee(impact: ChangeImpact): ChangeImpact {
  const rest: ChangeImpact = { ...impact };
  delete rest.feeDeltaVnd;
  return impact.applied ? { ...rest, applied: { ...impact.applied, feeVndBefore: null } } : rest;
}

export type PlanFigures = { budgetMinutes: number | null; feeVnd: number | null; dueDate: IsoDate | null };

/**
 * The plan after a change. A delta on a figure nobody set starts from zero; neither the hours nor
 * the fee can go below zero. A new due date replaces the old one.
 */
export function applyChange(current: PlanFigures, impact: ChangeImpact): PlanFigures {
  return {
    budgetMinutes: impact.minutesDelta ? Math.max(0, (current.budgetMinutes ?? 0) + impact.minutesDelta) : current.budgetMinutes,
    feeVnd: impact.feeDeltaVnd ? Math.max(0, (current.feeVnd ?? 0) + impact.feeDeltaVnd) : current.feeVnd,
    dueDate: impact.dueDateTo ? impact.dueDateTo : current.dueDate,
  };
}

export type LedgerStep = { number: number; title: string; impact: ChangeImpact; after: PlanFigures };
export type ChangeLedger = { original: PlanFigures; steps: LedgerStep[]; current: PlanFigures };

/**
 * Original + changes = current. `applied` are the approved changes in the order they were applied,
 * each with the figures it found. Without any, the original is simply the current plan.
 */
export function changeLedger(current: PlanFigures, applied: readonly { number: number; title: string; impact: ChangeImpact }[]): ChangeLedger {
  if (applied.length === 0) return { original: current, steps: [], current };
  const found = (impact: ChangeImpact): PlanFigures | null => (impact.applied ? { budgetMinutes: impact.applied.budgetMinutesBefore, feeVnd: impact.applied.feeVndBefore, dueDate: impact.applied.dueDateBefore } : null);
  const original = found(applied[0].impact) ?? current;
  const steps = applied.map((change, index) => {
    const next = applied[index + 1];
    const after = (next ? found(next.impact) : null) ?? (next ? applyChange(found(change.impact) ?? original, change.impact) : current);
    return { number: change.number, title: change.title, impact: change.impact, after };
  });
  return { original, steps, current };
}

/** Totals of what the approved changes added, for the hours budget by role to stay in step. */
export const appliedMinutes = (impacts: readonly ChangeImpact[]): number => impacts.reduce((sum, impact) => sum + (impact.minutesDelta ?? 0), 0);
