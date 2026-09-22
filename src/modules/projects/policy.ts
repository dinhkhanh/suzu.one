// Who may read and change a project's plan (FR-PJM-14, access rules of §4.6b). Pure, and built on
// the work policy: whoever may open a project reads its plan; whoever runs it changes the plan; the
// account manager owns the client side; money needs `pjm:commercial` over the project's entity.
//
// Project roles grant rights on that project only. Fees are never part of "reading the plan": a
// project lead who plans hours does not see what the client pays unless their role says so.
import { can, entityReach, type Principal } from "../platform/rbac/policy";
import { canActForClient, canContributeToProject, canManageProject, canViewProject, type ProjectFacts, type WorkViewer } from "../work/policy";

/**
 * A project as the plan rules see it: the work module's facts, and whether it has been closed
 * (FR-PJM-59). A closed project is read-only for its plan — phases, milestones, register, budget,
 * bookings, retainer, change requests — whoever is asking. Facts built without `closed` are open.
 */
export type PlanFacts = ProjectFacts & { closed?: boolean };

/** The plan, phases, milestones, register, budget hours, status history. */
export const canViewPlan = (viewer: WorkViewer, project: ProjectFacts): boolean => canViewProject(viewer, project);

/** Phases, milestones, the register, the hours budget, links of tasks to them. */
export const canEditPlan = (viewer: WorkViewer, project: PlanFacts): boolean => !project.closed && canManageProject(viewer, project);

/**
 * The brief and the kick-off gate, client contacts, the account manager: the client side. Whoever
 * runs the project, and its account manager.
 */
export const canEditClientSide = (viewer: WorkViewer, project: PlanFacts): boolean => !project.closed && canActForClient(viewer, project);

/** Fees and money budgets in VND: `pjm:commercial` over the project's entity (a group project: a group-wide grant). */
export const canSeeFees = (viewer: WorkViewer, project: Pick<ProjectFacts, "entityId">): boolean => can(viewer.principal, "pjm:commercial", { entityId: project.entityId });

/** Changing a fee: reading it is not enough — the person also changes the plan or owns the client side. */
export const canEditFees = (viewer: WorkViewer, project: PlanFacts): boolean => canSeeFees(viewer, project) && canEditClientSide(viewer, project);

/**
 * Posting a status update (FR-PJM-27): the project's lead, its account manager, or a lead of the
 * owning team. Not every workspace manager: an update is the account of the people running the work.
 */
export function canPostStatus(viewer: WorkViewer, project: PlanFacts): boolean {
  if (project.closed) return false;
  const role = viewer.projectRoles.get(project.id);
  return role === "lead" || role === "account_manager" || viewer.teamRoles.get(project.team.id) === "lead";
}

/**
 * Re-baselining (FR-PJM-12): replacing the dates a project was approved with is the project lead's
 * call — or a lead of the owning team's, who answers for every project of the team. Not a workspace
 * manager and not the account manager: moving the yardstick is not a planning edit.
 */
export function canRebaseline(viewer: WorkViewer, project: PlanFacts): boolean {
  if (project.closed) return false;
  return viewer.projectRoles.get(project.id) === "lead" || viewer.teamRoles.get(project.team.id) === "lead";
}

/** Bookings on a project (FR-PJM-13) are part of its plan: its readers see them, whoever runs it books. */
export const canViewBookings = canViewPlan;
export const canManageBookings = canEditPlan;

// ── Capacity (FR-PJM-13) ────────────────────────────────────────────────────────────────────
//
// A person's capacity says when they are away (never why) and how much of their time is promised.
// It is for the people who plan that time: the leads of any work team the person belongs to, every
// manager above them in the reporting line, and leaders holding `pjm:portfolio` or `work:manage`
// over where the person sits. Not colleagues, not a project lead as such, not the person's own
// directory readers.

export type CapacityReader = { personId: string | null; principal: Principal; /** Active work teams the reader leads. */ ledTeamIds: ReadonlySet<string> };
export type CapacitySubject = { personId: string; /** Active work teams the person belongs to. */ teamIds: readonly string[]; /** Everyone above the person in the reporting line. */ chainAbove: readonly string[]; entityId: string | null; unitPath: readonly string[] | null };

export function canSeeCapacityOf(reader: CapacityReader, subject: CapacitySubject): boolean {
  if (!reader.personId) return false;
  if (subject.teamIds.some((teamId) => reader.ledTeamIds.has(teamId))) return true;
  if (subject.chainAbove.includes(reader.personId)) return true;
  return holdsCapacityGrant(reader, subject);
}

const holdsCapacityGrant = (reader: CapacityReader, subject: CapacitySubject): boolean => {
  const target = { entityId: subject.entityId, unitPath: subject.unitPath };
  return can(reader.principal, "pjm:portfolio", target) || can(reader.principal, "work:manage", target);
};

/** Opening the capacity page (and its navigation entry): someone who plans other people's time somewhere. */
export function canOpenCapacity(reader: CapacityReader, managesSomeone: boolean): boolean {
  if (!reader.personId) return false;
  return reader.ledTeamIds.size > 0 || managesSomeone || can(reader.principal, "pjm:portfolio") || can(reader.principal, "work:manage");
}

// ── The commercial side (FR-PJM-06, 11, 55, 56, 58, 59) ─────────────────────────────────────
//
// Retainer terms, change requests, acceptance and client reports are the client side: the account
// manager and whoever runs the project. Money on any of them — a retainer's fee, a change's fee
// delta, a billing amount — follows `canSeeFees` / `canEditFees` and nothing else.

/** The retainer's months, line template, hours allowance and rollover rule. Its fee: `canEditFees` too. */
export const canEditRetainer = (viewer: WorkViewer, project: PlanFacts): boolean => canEditClientSide(viewer, project);

/** Drafting, submitting and withdrawing change requests. Deciding one is the approval flow's business. */
export const canManageChanges = (viewer: WorkViewer, project: PlanFacts): boolean => canEditClientSide(viewer, project);

/**
 * Acceptance records and client reports are the paperwork of delivery, not the plan: they trail
 * the work, so a closed project still gets its last biên bản signed and its last report sent.
 */
export const canManageAcceptance = (viewer: WorkViewer, project: ProjectFacts): boolean => canActForClient(viewer, project);
export const canWriteClientReport = (viewer: WorkViewer, project: ProjectFacts): boolean => canActForClient(viewer, project);

/**
 * Closing a project (FR-PJM-59) is its lead's call — or a lead of the owning team's. Not the
 * account manager and not a workspace manager: closing ends everyone's plan.
 */
export function canCloseProject(viewer: WorkViewer, project: PlanFacts): boolean {
  if (project.closed) return false;
  return viewer.projectRoles.get(project.id) === "lead" || viewer.teamRoles.get(project.team.id) === "lead";
}

/** The retrospective: the people who post status updates, before or after the close. */
export function canHoldRetro(viewer: WorkViewer, project: ProjectFacts): boolean {
  const role = viewer.projectRoles.get(project.id);
  return role === "lead" || role === "account_manager" || viewer.teamRoles.get(project.team.id) === "lead";
}

// ── The billing queue (FR-PJM-56) ───────────────────────────────────────────────────────────

/** Opening finance's queue (and its navigation entry): `pjm:commercial` anywhere. The rows are cut by `billingReach`. */
export const canOpenBillingQueue = (principal: Principal): boolean => can(principal, "pjm:commercial");

/** Invoicing or waiving an item, or adding one by hand: `pjm:commercial` over the item's entity. */
export const canDecideBilling = (principal: Principal, item: { entityId: string | null }): boolean => can(principal, "pjm:commercial", { entityId: item.entityId });

/** The entities whose items the queue shows; a group-wide grant also sees items of group projects. */
export const billingReach = (principal: Principal) => entityReach(principal, "pjm:commercial");

// ── Risks, issues, decisions (FR-PJM-29), meetings (FR-PJM-30), documents (FR-PJM-31) ───────
//
// The log and the meeting notes are the working record of the project: its readers read them,
// the people working in it write them. Closing an item — saying a risk has passed or an issue is
// dealt with — is the call of whoever runs the project or of the item's owner, not of anyone who
// may add a line. A closed project's record is read-only, like its plan.

/** Whoever runs the project: its lead, or a lead of the owning team. */
const runsProject = (viewer: WorkViewer, project: ProjectFacts): boolean => viewer.projectRoles.get(project.id) === "lead" || viewer.teamRoles.get(project.team.id) === "lead";

export const canViewRaid = (viewer: WorkViewer, project: ProjectFacts): boolean => canViewProject(viewer, project);

/** Adding an item, and turning an issue into a task: the project's contributors. */
export const canAddRaid = (viewer: WorkViewer, project: PlanFacts): boolean => !project.closed && canContributeToProject(viewer, project);

export type RaidItemFacts = { ownerPersonId: string | null; createdByPersonId: string | null };

/** Changing an item's wording, owner, dates or evidence: whoever wrote it or owns it, and whoever runs the project. */
export function canEditRaidItem(viewer: WorkViewer, project: PlanFacts, item: RaidItemFacts): boolean {
  if (!canAddRaid(viewer, project)) return false;
  const me = viewer.principal.personId;
  return runsProject(viewer, project) || (!!me && (item.ownerPersonId === me || item.createdByPersonId === me));
}

/** Closing or reopening an item: the project's lead or a team lead, or the item's owner. */
export function canCloseRaidItem(viewer: WorkViewer, project: PlanFacts, item: RaidItemFacts): boolean {
  if (project.closed || !canViewProject(viewer, project)) return false;
  const me = viewer.principal.personId;
  return runsProject(viewer, project) || (!!me && item.ownerPersonId === me);
}

export const canViewMeetings = (viewer: WorkViewer, project: ProjectFacts): boolean => canViewProject(viewer, project);

/** Recording a meeting — its notes, decisions and action items: the project's contributors. */
export const canRecordMeeting = (viewer: WorkViewer, project: PlanFacts): boolean => !project.closed && canContributeToProject(viewer, project);

/** Changing a meeting's notes afterwards: whoever wrote them, and whoever runs the project. */
export function canEditMeeting(viewer: WorkViewer, project: PlanFacts, meeting: { createdByPersonId: string | null; kind: string }): boolean {
  // The retrospective has its own page and its own rule (`canHoldRetro`).
  if (meeting.kind === "retro" || !canRecordMeeting(viewer, project)) return false;
  const me = viewer.principal.personId;
  return runsProject(viewer, project) || (!!me && meeting.createdByPersonId === me);
}

/**
 * Making the project's document space (FR-PJM-31): anyone working in it, once. What happens inside
 * the space — pages, files — is the knowledge base's policy, whose `project:<id>` row names the
 * project's people.
 */
export const canCreateProjectSpace = (viewer: WorkViewer, project: PlanFacts): boolean => !project.closed && canContributeToProject(viewer, project);
