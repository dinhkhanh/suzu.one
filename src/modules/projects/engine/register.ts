// The deliverables register's status (FR-PJM-05): what was promised and how far each promise has
// come, computed from the tasks linked to a line — one task is one unit. Pure.
//
// "Done internally" and "accepted by the client" are two things. A unit is **accepted** only on the
// client's recorded word — approved, or approved with changes, on the unit's deliverable (FR-PJM-51,
// 51a) — or, beyond that, on a delivery or a publish record. A unit whose task is done, or whose
// deliverable cleared internal review, without the client's answer is **ready for the client**; it
// is in **client review** only while its current version is actually with the client (a client
// stage of the review chain is waiting, or a review link was sent for it). Work that has no client
// to accept it — an internal project, a pitch — is accepted when it is done.
import type { StateCategory } from "../../work/service";

export const REGISTER_STATUSES = ["promised", "in_production", "ready_for_client", "client_review", "accepted", "delivered", "published"] as const;
export type RegisterStatus = (typeof REGISTER_STATUSES)[number];
const rank = (status: RegisterStatus) => REGISTER_STATUSES.indexOf(status);

export type UnitFacts = {
  category: StateCategory;
  /** The internal review decision of the task's current deliverable version, if one was handed in. */
  review?: "pending" | "approved" | "changes_requested" | null;
  /**
   * The client's decision that stands on the task's deliverable (FR-PJM-51): an approval of any
   * version, or a request for changes on the current one (a newer version answers an older request).
   */
  clientDecision?: "approved" | "approved_with_changes" | "changes_required" | null;
  /**
   * The current version is with the client and has no answer yet: a client stage of its review
   * chain is waiting, or a review link was made for it (FR-PJM-50, 51a).
   */
  sentToClient?: boolean;
  /** The work has no client to accept it (an internal project, a pitch): done is accepted. */
  noClient?: boolean;
  /** A delivery record exists (FR-PJM-53). */
  delivered?: boolean;
  /** A publish record with a URL exists (FR-PJM-54). */
  published?: boolean;
};

/**
 * The stage one unit has reached; null = its task was cancelled, so it fills no promise. The first
 * line that applies decides:
 *
 *   a publish record / a delivery record ................ published / delivered
 *   the current version is waiting on the client ........ client_review
 *   the client approved (with or without changes) ....... accepted
 *   the client asked for changes on the current version . in_production
 *   the task is done .................................... ready_for_client (accepted without a client)
 *   internal review asked for changes ................... in_production
 *   internal review approved ............................ ready_for_client (in_production without a client)
 *   in progress, in review, or a version handed in ...... in_production
 *   anything else ....................................... promised
 */
export function unitStatus(unit: UnitFacts): RegisterStatus | null {
  if (unit.category === "cancelled") return null;
  if (unit.published) return "published";
  if (unit.delivered) return "delivered";
  if (unit.sentToClient) return "client_review";
  if (unit.clientDecision === "approved" || unit.clientDecision === "approved_with_changes") return "accepted";
  // The client asked for changes: the unit is back in production whatever its state says.
  if (unit.clientDecision === "changes_required") return "in_production";
  if (unit.category === "done") return unit.noClient ? "accepted" : "ready_for_client";
  if (unit.review === "changes_requested") return "in_production";
  if (unit.review === "approved") return unit.noClient ? "in_production" : "ready_for_client";
  if (unit.category === "in_review" || unit.category === "in_progress" || unit.review === "pending") return "in_production";
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
  /** Units finished on our side that the client has not answered yet: ready for the client, or with them. */
  awaitingClient: number;
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
  if (line.cancelled) return { status: "cancelled", promised: 0, counts: emptyCounts(), accepted: 0, awaitingClient: 0, linked: reached.length };
  const quantity = Math.max(0, line.quantity);
  const filling = [...reached].sort((a, b) => rank(b) - rank(a)).slice(0, quantity);
  while (filling.length < quantity) filling.push("promised");
  const counts = emptyCounts();
  for (const status of filling) counts[status] += 1;
  const lowest = filling.reduce<RegisterStatus | null>((low, status) => (low === null || rank(status) < rank(low) ? status : low), null) ?? "promised";
  const started = filling.some((status) => status !== "promised");
  const status = lowest === "promised" && started ? "in_production" : lowest;
  return { status, promised: quantity, counts, accepted: filling.filter((unit) => rank(unit) >= rank("accepted")).length, awaitingClient: counts.ready_for_client + counts.client_review, linked: reached.length };
}

/**
 * Progress of a register = accepted ÷ promised over its live lines — accepted by the client, never
 * merely finished. `awaitingClient` is the work finished on our side that the client has yet to
 * answer, so the gap between "done" and "accepted" is a figure and not a guess. `percent` is null
 * when nothing is promised.
 */
export function registerProgress(lines: readonly Pick<LineStatus, "promised" | "accepted" | "awaitingClient">[]): { promised: number; accepted: number; awaitingClient: number; percent: number | null } {
  const promised = lines.reduce((sum, line) => sum + line.promised, 0);
  const accepted = lines.reduce((sum, line) => sum + line.accepted, 0);
  const awaitingClient = lines.reduce((sum, line) => sum + line.awaitingClient, 0);
  return { promised, accepted, awaitingClient, percent: promised > 0 ? Math.floor((accepted / promised) * 100) : null };
}

/**
 * Units of a line that count as used, uncapped (FR-PJM-06): every unit finished on our side —
 * ready for the client or beyond — however many. A quota is used up by the work that was made,
 * whether or not the client has answered yet: a retainer line of 12 posts with 15 finished has
 * consumed 15, and the three extra are the overservicing the account manager needs to see.
 */
export const unitsConsumed = (units: readonly UnitFacts[]): number => units.map(unitStatus).filter((status) => status !== null && rank(status) >= rank("ready_for_client")).length;
