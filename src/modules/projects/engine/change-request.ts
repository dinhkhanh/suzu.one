// Change requests (FR-PJM-11): a delta on a project's scope, hours, fee and due date that applies
// only once it is approved. Pure: no I/O.
//
// The history is "original + change requests = current": each approved change keeps the figures
// the plan had just before it was applied and the figures it left, so the original is what the
// first change found, every step after it is one change's delta — and a figure edited directly,
// outside any change, shows as a difference nobody explained (`changeLedger`).
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

/** The change replaces something of a retainer's monthly scope: its quota lines, its hours allowance or its monthly fee. */
export const hasRetainerChange = (impact: ChangeImpact): boolean => !!impact.retainer && (impact.retainer.lines !== undefined || impact.retainer.minutesPerMonth !== undefined || impact.retainer.feePerMonthVnd !== undefined);

export const hasImpact = (impact: ChangeImpact): boolean => !!(impact.deliverables?.length || impact.cancelDeliverableIds?.length || impact.minutesDelta || impact.feeDeltaVnd || impact.dueDateTo || hasRetainerChange(impact));

/** A fee change — the project's, or a retainer's monthly fee — needs a second approver with `pjm:commercial`: the flow's condition reads this. */
export const hasFeeChange = (impact: ChangeImpact): boolean => !!impact.feeDeltaVnd || impact.retainer?.feePerMonthVnd !== undefined;

/** The fee part of a change taken out, for a reader without `pjm:commercial`. */
export function withoutFee(impact: ChangeImpact): ChangeImpact {
  const rest: ChangeImpact = { ...impact };
  delete rest.feeDeltaVnd;
  if (rest.retainer) {
    const terms = { ...rest.retainer };
    delete terms.feePerMonthVnd;
    rest.retainer = terms;
  }
  if (!impact.applied) return rest;
  return { ...rest, applied: { ...impact.applied, feeVndBefore: null, ...(impact.applied.retainer ? { retainer: { ...impact.applied.retainer, feePerMonthVnd: null } } : {}) } };
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

/** What moved between two readings of the figures. */
export type FigureDelta = { minutes: number; feeVnd: number; dueDate: boolean };
const deltaOf = (before: PlanFigures, after: PlanFigures): FigureDelta => ({
  minutes: (after.budgetMinutes ?? 0) - (before.budgetMinutes ?? 0),
  feeVnd: (after.feeVnd ?? 0) - (before.feeVnd ?? 0),
  dueDate: before.dueDate !== after.dueDate,
});
const moved = (delta: FigureDelta): boolean => delta.minutes !== 0 || delta.feeVnd !== 0 || delta.dueDate;

/** An approved change with the figures it found and left; either may be missing on a change applied before they were stored. */
export type AppliedChange = { number: number; title: string; impact: ChangeImpact; before?: PlanFigures | null; after?: PlanFigures | null };

/**
 * A row of the ledger, each with the figures as they stood after it: an approved change, or a
 * difference no change request explains — the figures were edited directly between two changes, or
 * since the last one.
 */
export type LedgerStep = { kind: "change"; number: number; title: string; impact: ChangeImpact; after: PlanFigures } | { kind: "unexplained"; delta: FigureDelta; after: PlanFigures };
export type ChangeLedger = { original: PlanFigures; steps: LedgerStep[]; current: PlanFigures; /** Original + change requests = current, with nothing unexplained. */ balanced: boolean };

/**
 * Original + change requests = current (FR-PJM-11), rebuilt from each change's own record. `applied`
 * are the approved changes in the order they were applied. `origin` is what the kick-off found, when
 * the caller knows it (the baseline, taken before any change); without it the original is what the
 * first change found, and without any change it is the current plan.
 *
 * Each change's "after" is its own — stored when it was applied, or, for a change older than that,
 * what its delta makes of what it found — never the next change's "before". So wherever the figures
 * a change found are not the figures the row before left, and wherever the last row is not the
 * current plan, a row says so: the sum is shown not to add up rather than being made to.
 */
export function changeLedger(current: PlanFigures, applied: readonly AppliedChange[], origin: PlanFigures | null = null): ChangeLedger {
  const found = (change: AppliedChange): PlanFigures | null =>
    change.before ?? (change.impact.applied ? { budgetMinutes: change.impact.applied.budgetMinutesBefore, feeVnd: change.impact.applied.feeVndBefore, dueDate: change.impact.applied.dueDateBefore } : null);
  const original = origin ?? (applied.length ? found(applied[0]) : null) ?? current;
  const steps: LedgerStep[] = [];
  let running = original;
  const gap = (to: PlanFigures) => {
    const delta = deltaOf(running, to);
    if (moved(delta)) steps.push({ kind: "unexplained", delta, after: to });
  };
  for (const change of applied) {
    const before = found(change) ?? running;
    gap(before);
    const after = change.after ?? applyChange(before, change.impact);
    steps.push({ kind: "change", number: change.number, title: change.title, impact: change.impact, after });
    running = after;
  }
  gap(current);
  return { original, steps, current, balanced: steps.every((step) => step.kind === "change") };
}

/** The ledger for a reader without `pjm:commercial`: no fee anywhere, and no row whose only difference was the fee. */
export function ledgerWithoutFee(ledger: ChangeLedger): ChangeLedger {
  const strip = (figures: PlanFigures): PlanFigures => ({ ...figures, feeVnd: null });
  const steps = ledger.steps.flatMap((step): LedgerStep[] => {
    if (step.kind === "change") return [{ ...step, impact: withoutFee(step.impact), after: strip(step.after) }];
    const delta = { ...step.delta, feeVnd: 0 };
    return moved(delta) ? [{ kind: "unexplained", delta, after: strip(step.after) }] : [];
  });
  return { original: strip(ledger.original), steps, current: strip(ledger.current), balanced: steps.every((step) => step.kind === "change") };
}

/** Totals of what the approved changes added, for the hours budget by role to stay in step. */
export const appliedMinutes = (impacts: readonly ChangeImpact[]): number => impacts.reduce((sum, impact) => sum + (impact.minutesDelta ?? 0), 0);
