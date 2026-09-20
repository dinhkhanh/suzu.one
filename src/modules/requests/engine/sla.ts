// What the SLA job should do about one waiting turn (FR-PLT-23). Pure: given how long an approver
// has been sitting on a request and what the type asks for, say whether to nudge them, to escalate,
// or to leave it alone. The job does the I/O; this decides.
//
// A turn is nudged once and escalated once. The two are independent: escalation does not wait for
// a nudge to have happened, so switching the reminder off still escalates.

export type SlaPolicy = { remindAfterDays: number; escalateAfterDays: number; hasEscalationTarget: boolean };
export type WaitingTurn = { waitingSince: Date; remindedAt: Date | null; escalatedAt: Date | null };
export type SlaAction = "remind" | "escalate" | "none";

const DAY = 24 * 60 * 60 * 1000;

export const daysWaiting = (turn: { waitingSince: Date }, now: Date): number => (now.getTime() - turn.waitingSince.getTime()) / DAY;

/**
 * Escalation first: once a request is that late, a nudge is no longer the point. Both are capped
 * at once per turn by the marks the job writes back.
 */
export function slaActionFor(policy: SlaPolicy, turn: WaitingTurn, now: Date): SlaAction {
  const waited = daysWaiting(turn, now);
  if (policy.escalateAfterDays > 0 && policy.hasEscalationTarget && !turn.escalatedAt && waited >= policy.escalateAfterDays) return "escalate";
  if (policy.remindAfterDays > 0 && !turn.remindedAt && waited >= policy.remindAfterDays) return "remind";
  return "none";
}
