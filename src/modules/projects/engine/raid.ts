// The risks, issues, decisions and assumptions log — RAID-lite (FR-PJM-29) — and the meeting
// notes that feed it (FR-PJM-30). Pure.
//
// A risk may happen, an issue has happened, a decision was taken, an assumption is what the plan
// rests on. Severity matters for risks and issues; a decision instead records when it was taken
// and the proof (the client's e-mail, a signed file, a message link). What reaches the status
// update and the portfolio is what needs attention: open high risks and open issues.
import type { IsoDate } from "@/lib/dates";

export const RAID_KINDS = ["risk", "issue", "decision", "assumption"] as const;
export type RaidKind = (typeof RAID_KINDS)[number];
export const RAID_SEVERITIES = ["low", "medium", "high"] as const;
export type RaidSeverity = (typeof RAID_SEVERITIES)[number];
export const RAID_STATUSES = ["open", "closed"] as const;
export type RaidStatus = (typeof RAID_STATUSES)[number];

/** Kinds that carry a severity. A decision or an assumption has none. */
export const hasSeverity = (kind: RaidKind): boolean => kind === "risk" || kind === "issue";

export type RaidDraft = {
  kind: RaidKind;
  title: string;
  severity: RaidSeverity | null;
  decidedOn: IsoDate | null;
  evidenceUrl: string | null;
  evidenceFileId: string | null;
};

export type RaidProblem = "raid_title_required" | "raid_severity_required" | "raid_decided_on_required" | "raid_decided_in_future" | "raid_evidence_url_invalid";

/** Evidence links are https only: a note from the client is a mail or a message, not a local path. */
export const isEvidenceUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * What stops an item being saved. A risk or an issue says how bad it is; a decision says when it
 * was taken — not later than today. Evidence is optional (a decision taken in a meeting has the
 * meeting), but a link given must be https.
 */
export function raidProblems(draft: RaidDraft, today: IsoDate): RaidProblem[] {
  const problems: RaidProblem[] = [];
  if (!draft.title.trim()) problems.push("raid_title_required");
  if (hasSeverity(draft.kind) && !draft.severity) problems.push("raid_severity_required");
  if (draft.kind === "decision") {
    if (!draft.decidedOn) problems.push("raid_decided_on_required");
    else if (draft.decidedOn > today) problems.push("raid_decided_in_future");
  }
  if (draft.evidenceUrl && !isEvidenceUrl(draft.evidenceUrl)) problems.push("raid_evidence_url_invalid");
  return problems;
}

/** What is kept of each kind: the fields a kind does not use are cleared, whatever the form sent. */
export function normaliseRaid<Draft extends RaidDraft>(draft: Draft): Draft {
  return {
    ...draft,
    severity: hasSeverity(draft.kind) ? draft.severity : null,
    decidedOn: draft.kind === "decision" ? draft.decidedOn : null,
  };
}

/** Only an open issue with no task yet becomes a task — once. */
export const canBecomeTask = (item: { kind: string; status: string; taskId: string | null }): boolean => item.kind === "issue" && item.status === "open" && !item.taskId;

export type RaidFacts = { kind: string; severity: string | null; status: string };
export type RaidCounts = { highRisks: number; openIssues: number };

/** What the status update and the portfolio show: open risks rated high, and every open issue. */
export function raidCounts(items: readonly RaidFacts[]): RaidCounts {
  const open = items.filter((item) => item.status === "open");
  return {
    highRisks: open.filter((item) => item.kind === "risk" && item.severity === "high").length,
    openIssues: open.filter((item) => item.kind === "issue").length,
  };
}

/** The log's reading order: open before closed, then high before low, then by due date (undated last). */
export function sortRaid<Item extends RaidFacts & { dueDate: IsoDate | null; createdAt: Date }>(items: readonly Item[]): Item[] {
  const rank = (severity: string | null) => (severity === "high" ? 0 : severity === "medium" ? 1 : severity === "low" ? 2 : 3);
  return [...items].sort(
    (a, b) =>
      Number(a.status !== "open") - Number(b.status !== "open") ||
      rank(a.severity) - rank(b.severity) ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// ── Meetings (FR-PJM-30) ────────────────────────────────────────────────────────────────────

/** Kinds a meeting is recorded as. The retrospective is held on the close-out page, once. */
export const MEETING_KINDS = ["kickoff", "weekly", "client", "retro", "other"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export const RECORDABLE_MEETING_KINDS = ["kickoff", "weekly", "client", "other"] as const satisfies readonly MeetingKind[];

export type ActionItem = { title: string; assigneePersonId: string | null; dueDate: IsoDate | null };
export type MeetingDraft = {
  title: string;
  heldOn: IsoDate;
  attendeeIds: readonly string[];
  decisions: readonly { title: string }[];
  actionItems: readonly ActionItem[];
};
export type MeetingProblem = "meeting_title_required" | "meeting_decisions_before_held" | "meeting_attendee_not_member" | "meeting_assignee_not_member" | "meeting_action_due_before";

/**
 * A meeting may be written up before it is held (the agenda) and after (notes, decisions, action
 * items). Decisions only once it has been held: a decision is dated by the meeting that took it.
 * Attendees and the people action items go to are picked from the project's people; an action
 * item is not due before the meeting that gave it.
 */
export function meetingProblems(draft: MeetingDraft, context: { today: IsoDate; people: ReadonlySet<string> }): MeetingProblem[] {
  const problems: MeetingProblem[] = [];
  if (!draft.title.trim()) problems.push("meeting_title_required");
  if (draft.decisions.length > 0 && draft.heldOn > context.today) problems.push("meeting_decisions_before_held");
  if (draft.attendeeIds.some((id) => !context.people.has(id))) problems.push("meeting_attendee_not_member");
  if (draft.actionItems.some((item) => item.assigneePersonId !== null && !context.people.has(item.assigneePersonId))) problems.push("meeting_assignee_not_member");
  if (draft.actionItems.some((item) => item.dueDate !== null && item.dueDate < draft.heldOn)) problems.push("meeting_action_due_before");
  return problems;
}
