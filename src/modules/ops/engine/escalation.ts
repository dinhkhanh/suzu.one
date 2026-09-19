// Reminders and escalation (FR-OPS-08). Pure: given today, an open instance and what was already
// sent, which notices go out now? Every notice has a key; the job stores the key once it is sent,
// so running twice on a day — or missing a day — never repeats or loses a step.
//
//   lead:<n>            n days before the due date          → the owner
//   overdue:1           the first day after the due date    → the owner and the reviewer
//   escalate:manager    `managerAfterDays` late             → the owner's department head, else line manager
//   escalate:executive  `executiveAfterDays` late           → finance / C-level over the entity, and the owners
import type { IsoDate } from "@/lib/dates";
import type { Escalation } from "../enums";

export type NoticeAudience = "owner" | "owner_and_reviewer" | "manager" | "executive";
export type NoticeKind = "reminder" | "overdue" | "escalated";
export type Notice = { key: string; kind: NoticeKind; audience: NoticeAudience; /** Days until the due date (reminder) or days late (overdue, escalated). */ days: number };

export type EscalationFacts = {
  status: "todo" | "in_progress" | "done" | "cancelled";
  dueDate: IsoDate | null;
  reminderLeadDays: readonly number[];
  escalation: Escalation;
  sent: ReadonlySet<string>;
};

const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function noticesDue(facts: EscalationFacts, today: IsoDate): Notice[] {
  if (!facts.dueDate || facts.status === "done" || facts.status === "cancelled") return [];
  const until = daysBetween(today, facts.dueDate);
  const notices: Notice[] = [];

  if (until >= 0) {
    // One reminder a day at most: the closest lead time that has been reached. Earlier ones that
    // were missed (the instance was created late, the job did not run) are marked, not sent.
    const reached = [...new Set(facts.reminderLeadDays)].filter((lead) => lead >= until).sort((a, b) => a - b);
    const closest = reached[0];
    if (closest !== undefined && !facts.sent.has(`lead:${closest}`)) notices.push({ key: `lead:${closest}`, kind: "reminder", audience: "owner", days: until });
    return notices;
  }

  const late = -until;
  if (!facts.sent.has("overdue:1")) notices.push({ key: "overdue:1", kind: "overdue", audience: "owner_and_reviewer", days: late });
  if (late >= facts.escalation.managerAfterDays && !facts.sent.has("escalate:manager")) notices.push({ key: "escalate:manager", kind: "escalated", audience: "manager", days: late });
  if (late >= facts.escalation.executiveAfterDays && !facts.sent.has("escalate:executive")) notices.push({ key: "escalate:executive", kind: "escalated", audience: "executive", days: late });
  return notices;
}

/** Lead times passed without a notice: stored with the one that is sent, so a reminder for "7 days" never follows the one for "3 days". */
export function supersededLeadKeys(facts: Pick<EscalationFacts, "reminderLeadDays" | "sent">, sentLead: number): string[] {
  return facts.reminderLeadDays.filter((lead) => lead > sentLead && !facts.sent.has(`lead:${lead}`)).map((lead) => `lead:${lead}`);
}

/** 0 = nobody above the owner was told; 1 = the manager; 2 = the executives. Shown on the instance and the dashboard. */
export function escalationLevel(sent: Iterable<string>): 0 | 1 | 2 {
  const keys = new Set(sent);
  return keys.has("escalate:executive") ? 2 : keys.has("escalate:manager") ? 1 : 0;
}
