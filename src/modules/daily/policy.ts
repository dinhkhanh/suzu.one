// Who may read a person's daily reports (SRS §4.6b "Access rules specific to PJM"). Pure: the
// service loads the reader (the teams they lead) and the subject (their teams and the chain of
// managers above them) and asks these functions.
//
// A report — the plan, the end-of-day report, the week's summary, the time logged — is visible to
//   · the person,
//   · the leads of any work team the person belongs to,
//   · every manager above the person in the reporting line (direct or skip-level),
// and to nobody else: not colleagues, not the lead of another team, not a role grant. Daily reports
// are work evidence for the people who run the work (design rule 3), not a directory.
//
// The one exception is oversight (`daily:oversee`, decision of 2026-09-28): whoever holds it over
// the whole group — today the owner alone — reads everybody's plans, reports, time and
// utilisation. Reading only: commenting, reminding, summarising and approving stay with the
// people who run the work.
import { can, type Principal } from "@/modules/platform/rbac/policy";

export type ReportReader = {
  personId: string | null;
  /** Work teams the reader leads. */
  ledTeamIds: ReadonlySet<string>;
  /** Holds `daily:oversee` over the whole group (`overseesDaily`): reads everybody, acts on nobody's. */
  oversees?: boolean;
};

/** Oversight of the daily loop: a group-wide `daily:oversee` grant — a unit's or an entity's reaches nobody, since a report names no entity. */
export const overseesDaily = (principal: Principal): boolean => can(principal, "daily:oversee", {});

export type ReportSubject = {
  personId: string;
  /** Active work teams the person belongs to, as lead or member. */
  teamIds: readonly string[];
  /** Everyone above the person in the reporting line, nearest first. */
  chainAbove: readonly string[];
};

const isSelf = (reader: ReportReader, subject: ReportSubject) => !!reader.personId && reader.personId === subject.personId;
const leadsThem = (reader: ReportReader, subject: ReportSubject) => subject.teamIds.some((teamId) => reader.ledTeamIds.has(teamId));
const managesThem = (reader: ReportReader, subject: ReportSubject) => !!reader.personId && subject.chainAbove.includes(reader.personId);

/** The person, a lead of one of their teams, or a manager above them — the people the report is for. */
function readsByRelation(reader: ReportReader, subject: ReportSubject): boolean {
  if (!reader.personId) return false;
  return isSelf(reader, subject) || leadsThem(reader, subject) || managesThem(reader, subject);
}

export function canViewReport(reader: ReportReader, subject: ReportSubject): boolean {
  if (!reader.personId) return false;
  return readsByRelation(reader, subject) || !!reader.oversees;
}

/** A comment or a reaction: the person and the people the report is for — oversight reads, it does not join in. */
export const canCommentOnReport = readsByRelation;

/** Reminding someone to report, and writing on their weekly summary, is for the people above them. */
export function canOverseeReport(reader: ReportReader, subject: ReportSubject): boolean {
  return readsByRelation(reader, subject) && !isSelf(reader, subject);
}

// ── Time entries and timesheets (FR-PJM-24, 25, 61) ─────────────────────────────────────────
//
// Time follows the report's rule, with one addition from the PJM access rules: a project's lead
// sees the rows logged on their project — only those, not the rest of the person's week.

export type TimeReader = ReportReader & {
  /** Projects the reader leads: named as the project's lead, or holding the project role "lead". */
  ledProjectIds: ReadonlySet<string>;
};

/** One time entry: whoever may read the person's reports, and the lead of the entry's project. */
export function canViewTimeEntry(reader: TimeReader, subject: ReportSubject, entry: { projectId: string | null }): boolean {
  if (canViewReport(reader, subject)) return true;
  return !!reader.personId && !!entry.projectId && reader.ledProjectIds.has(entry.projectId);
}

/** A subject as the timesheet's approval asks of them (`loadTimesheetSubjects`). */
export type TimesheetSubject = ReportSubject & {
  /**
   * Who approves the week when no lead of the person's teams and no line manager is there to: the
   * holders of `work:manage` over the person, and when there are none, the owners. Empty while a
   * lead or the line manager can approve; never the person.
   */
  fallbackApprovers: readonly string[];
};

/**
 * Approving (or returning, or reopening) a person's week is for a lead of one of their work teams
 * or their line manager — the manager directly above, not the whole chain — and never the person
 * themself, whatever else they are. Where those rules find nobody, the week still has an approver
 * (`fallbackApprovers`): no submitted week waits for ever.
 */
export function canApproveTimesheet(reader: ReportReader, subject: TimesheetSubject): boolean {
  if (!reader.personId || isSelf(reader, subject)) return false;
  return leadsThem(reader, subject) || subject.chainAbove[0] === reader.personId || subject.fallbackApprovers.includes(reader.personId);
}

/**
 * The whole week — every row, the attendance hint beside each day, the status — as the report,
 * and for whoever approves it: an approver of last resort reads the week they decide, and nothing
 * else of the person's day.
 */
export function canViewTimesheet(reader: ReportReader, subject: TimesheetSubject): boolean {
  return canViewReport(reader, subject) || canApproveTimesheet(reader, subject);
}

/**
 * The attendance hint beside each day of a week (FR-PJM-26) is attendance data: the person's and
 * their line-management chain's, never a work team's lead as such — a lead chooses who joins their
 * team, and joining must not open the newcomer's attendance to them.
 */
export function canViewAttendanceHint(reader: ReportReader, subject: ReportSubject): boolean {
  return isSelf(reader, subject) || managesThem(reader, subject) || (!!reader.personId && !!reader.oversees);
}

/** A person's utilisation (FR-PJM-61) is for the people above them, as their reports are — and for oversight. */
export function canViewUtilisation(reader: ReportReader, subject: ReportSubject): boolean {
  return canOverseeReport(reader, subject) || (!!reader.oversees && !!reader.personId && !isSelf(reader, subject));
}
