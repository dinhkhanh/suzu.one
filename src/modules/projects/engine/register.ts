// The deliverables register's status (FR-PJM-05): what was promised and how far each promise has
// come, computed from the tasks linked to a line — one task is one unit. Pure.
//
// Today a unit's stage comes from its task's state category and its review data. Later releases
// add client decisions, delivery records and publish records; they are optional inputs here, so a
// unit with none of them is judged by its task alone and nothing needs rewriting when they arrive.
import type { StateCategory } from "../../work/enums";

export const REGISTER_STATUSES = ["promised", "in_production", "client_review", "accepted", "delivered", "published"] as const;
export type RegisterStatus = (typeof REGISTER_STATUSES)[number];
const rank = (status: RegisterStatus) => REGISTER_STATUSES.indexOf(status);

export type UnitFacts = {
  category: StateCategory;
  /** The latest internal review decision of the task's deliverable, if one was handed in. */
  review?: "pending" | "approved" | "changes_requested" | null;
  /** The client's latest decision recorded on the task's deliverable (FR-PJM-51). */
  clientDecision?: "approved" | "approved_with_changes" | "changes_required" | null;
  /** A delivery record exists (FR-PJM-53). */
  delivered?: boolean;
  /** A publish record with a URL exists (FR-PJM-54). */
  published?: boolean;
};

/** The stage one unit has reached; null = its task was cancelled, so it fills no promise. */
export function unitStatus(unit: UnitFacts): RegisterStatus | null {
  if (unit.category === "cancelled") return null;
  if (unit.published) return "published";
  if (unit.delivered) return "delivered";
  if (unit.clientDecision === "approved" || unit.clientDecision === "approved_with_changes") return "accepted";
  if (unit.category === "done") return "accepted";
  // The client asked for changes: the unit is back in production whatever its state says.
  if (unit.clientDecision === "changes_required" || unit.review === "changes_requested") return "in_production";
  if (unit.category === "in_review" || unit.review === "approved") return "client_review";
  if (unit.category === "in_progress" || unit.review === "pending") return "in_production";
  return "promised";
}

export type LineFacts = { quantity: number; cancelled: boolean; units: readonly UnitFacts[] };
export type LineStatus = {
  status: RegisterStatus | "cancelled";
  /** The promised quantity (0 for a cancelled line). */
  promised: number;
  /** Units that fill the promise: at most the quantity, the most advanced first. */
  counts: Record<RegisterStatus, number>;
  /** Units at "accepted" or beyond. */
  accepted: number;
  /** Linked tasks that are not cancelled — more than the quantity means extra work on the line. */
  linked: number;
};

const emptyCounts = (): Record<RegisterStatus, number> => Object.fromEntries(REGISTER_STATUSES.map((status) => [status, 0])) as Record<RegisterStatus, number>;

/**
 * A line is as far as its least advanced unit: "12 × Facebook post" is accepted when all twelve
 * are. Units not yet linked to a task are still promised. A line where something has started but
 * some units are untouched is "in production", not "promised".
 */
export function lineStatus(line: LineFacts): LineStatus {
  const reached = line.units.map(unitStatus).filter((status): status is RegisterStatus => status !== null);
  if (line.cancelled) return { status: "cancelled", promised: 0, counts: emptyCounts(), accepted: 0, linked: reached.length };
  const quantity = Math.max(0, line.quantity);
  const filling = [...reached].sort((a, b) => rank(b) - rank(a)).slice(0, quantity);
  while (filling.length < quantity) filling.push("promised");
  const counts = emptyCounts();
  for (const status of filling) counts[status] += 1;
  const lowest = filling.reduce<RegisterStatus | null>((low, status) => (low === null || rank(status) < rank(low) ? status : low), null) ?? "promised";
  const started = filling.some((status) => status !== "promised");
  const status = lowest === "promised" && started ? "in_production" : lowest;
  return { status, promised: quantity, counts, accepted: filling.filter((unit) => rank(unit) >= rank("accepted")).length, linked: reached.length };
}

/** Progress of a register = accepted ÷ promised over its live lines. null when nothing is promised. */
export function registerProgress(lines: readonly Pick<LineStatus, "promised" | "accepted">[]): { promised: number; accepted: number; percent: number | null } {
  const promised = lines.reduce((sum, line) => sum + line.promised, 0);
  const accepted = lines.reduce((sum, line) => sum + line.accepted, 0);
  return { promised, accepted, percent: promised > 0 ? Math.floor((accepted / promised) * 100) : null };
}

/**
 * Units of a line that count as used, uncapped (FR-PJM-06): every unit at "accepted" or beyond,
 * however many — a retainer line of 12 posts with 15 accepted has consumed 15, and the three extra
 * are the overservicing the account manager needs to see.
 */
export const unitsConsumed = (units: readonly UnitFacts[]): number => units.map(unitStatus).filter((status) => status !== null && rank(status) >= rank("accepted")).length;
