// Exit and transfer handover (FR-PJM-45). Pure: the service lists, live, everything a leaver still
// owns; this turns the list into the gate's answer and says what can be handed to someone else.

/**
 * What a person can own in work management. `time_week` is the odd one: a week of time belongs to
 * whoever logged it — it is closed by submitting it, never reassigned.
 */
export const OWNERSHIP_KINDS = ["task", "review", "project_lead", "account_manager", "client_account", "recurrence", "intake_form", "automation", "team_lead", "time_week"] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

export type OwnedItem = { kind: OwnershipKind; id: string; label: string; /** Where it lives, for the handover page (a project, a team). */ context: string | null };

export type OwnershipSummary = { total: number; byKind: Partial<Record<OwnershipKind, number>>; clear: boolean; reassignable: number; blocking: OwnershipKind[] };

export const isReassignable = (kind: OwnershipKind): boolean => kind !== "time_week";

/** The gate: closed only when the person owns nothing. `blocking` lists the kinds still held, in the page's order. */
export function ownershipSummary(items: readonly OwnedItem[]): OwnershipSummary {
  const byKind: Partial<Record<OwnershipKind, number>> = {};
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  return { total: items.length, byKind, clear: items.length === 0, reassignable: items.filter((item) => isReassignable(item.kind)).length, blocking: OWNERSHIP_KINDS.filter((kind) => byKind[kind]) };
}

export type ReassignProblem = "exit_reassign_to_self" | "exit_reassign_nothing" | "exit_reassign_time_week";

/** A bulk reassignment the page sends: some items, to one person who is not the leaver. */
export function reassignProblem(input: { leaverId: string; toPersonId: string; items: readonly { kind: OwnershipKind }[] }): ReassignProblem | null {
  if (input.items.length === 0) return "exit_reassign_nothing";
  if (input.toPersonId === input.leaverId) return "exit_reassign_to_self";
  if (input.items.some((item) => !isReassignable(item.kind))) return "exit_reassign_time_week";
  return null;
}

/** The lifecycle events that start a handover: somebody leaves, or moves to another place. */
export const HANDOVER_EVENT_TYPES = ["termination", "transfer"] as const;
export type HandoverEventType = (typeof HANDOVER_EVENT_TYPES)[number];
