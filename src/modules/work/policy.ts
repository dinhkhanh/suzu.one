// Who may see and change what in work management. Pure: the service loads the viewer's
// memberships once per request (viewer.ts) and asks these functions.
//
// Rights come from membership first — a team's leads run the team, a project's members work in it —
// and from the `work:manage` permission for leaders over their scope. Privacy (FR-WRK-18):
//   entity  → everyone in the project's entity (a group project: everyone); never collaborators
//   team    → the owning team's members and the project's members
//   private → the project's members and the team's leads. `work:manage` does not open a private
//             project: an HR or finance project stays with the people in it.
import { can, type Principal } from "../platform/rbac/policy";
import type { ProjectRole, TeamRole, Visibility } from "./enums";

export type WorkViewer = {
  principal: Principal;
  /** The viewer's primary entity. */
  entityId: string | null;
  teamRoles: ReadonlyMap<string, TeamRole>;
  projectRoles: ReadonlyMap<string, ProjectRole>;
};

export type TeamFacts = { id: string; entityId: string | null; departmentId: string | null; defaultVisibility: Visibility };
export type ProjectFacts = { id: string; entityId: string | null; visibility: Visibility; team: TeamFacts };
export type TaskFacts = {
  team: TeamFacts;
  project: ProjectFacts | null;
  assigneePersonId: string | null;
  requesterPersonId: string | null;
  createdByPersonId: string | null;
  /** Collaborators. Followers are not here: following a task gives notifications, never rights. */
  peopleIds: readonly string[];
};

const isCollaborator = (viewer: WorkViewer) => viewer.principal.workforceType === "collaborator";
// A work team may hang off an org unit; a `work:manage` grant on that unit — or on any unit above
// it, which the grant already knows about — covers the team.
const scopeOf = (team: Pick<TeamFacts, "entityId" | "departmentId">) => ({ entityId: team.entityId, unitPath: team.departmentId ? [team.departmentId] : [] });

/** Create teams here, keep the client list: leaders with `work:manage` over the place. */
export function canManageWorkspace(viewer: WorkViewer, place?: { entityId: string | null; departmentId: string | null }): boolean {
  return can(viewer.principal, "work:manage", place ? scopeOf(place) : undefined);
}

/** Members, workflow, labels, templates of a team. */
export function canAdminTeam(viewer: WorkViewer, team: TeamFacts): boolean {
  return viewer.teamRoles.get(team.id) === "lead" || canManageWorkspace(viewer, team);
}

export type PersonPlacement = { entityId: string | null; /** `person.org_unit_path`: the person's unit and every unit above it. */ unitPath: readonly string[] };

/**
 * Adding someone to a team. Being in a team puts a person's day in front of its leads — their
 * reports, plans and time, and their timesheets to approve — so a lead adds only people inside the
 * team's own place: the team's entity (any, for a group team) and, when the team hangs off an org
 * unit, that unit's subtree. Anyone else — a peer in another entity, the finance director — takes
 * `work:manage` over where the person sits. Changing the role of someone already in the team, or
 * taking them out, needs only the right to run the team.
 */
export function canAddTeamMember(viewer: WorkViewer, team: TeamFacts, person: PersonPlacement): boolean {
  if (!canAdminTeam(viewer, team)) return false;
  if (can(viewer.principal, "work:manage", { entityId: person.entityId, unitPath: person.unitPath })) return true;
  const inEntity = team.entityId === null || person.entityId === team.entityId;
  const inUnit = !team.departmentId || person.unitPath.includes(team.departmentId);
  return inEntity && inUnit;
}

/** A team's name, members and workflow are directory information — not for collaborators who are not in it. */
export function canViewTeam(viewer: WorkViewer, team: TeamFacts): boolean {
  return viewer.teamRoles.has(team.id) || canAdminTeam(viewer, team) || !isCollaborator(viewer);
}

function seesByVisibility(viewer: WorkViewer, visibility: Visibility, entityId: string | null, team: TeamFacts): boolean {
  if (viewer.teamRoles.get(team.id) === "lead") return true;
  if (visibility === "private") return false;
  // `pjm:portfolio` (FR-PJM-8): leaders read every non-private project in their scope.
  if (viewer.teamRoles.has(team.id) || canManageWorkspace(viewer, team) || can(viewer.principal, "pjm:portfolio", scopeOf(team))) return true;
  return visibility === "entity" && !isCollaborator(viewer) && (entityId === null || entityId === viewer.entityId);
}

export function canViewProject(viewer: WorkViewer, project: ProjectFacts): boolean {
  return viewer.projectRoles.has(project.id) || seesByVisibility(viewer, project.visibility, project.entityId, project.team);
}

/** The client side of a project (FR-PJM-14): client decisions, acceptance, change requests, billing hand-off. */
export function canActForClient(viewer: WorkViewer, project: ProjectFacts): boolean {
  return viewer.projectRoles.get(project.id) === "account_manager" || canManageProject(viewer, project);
}

/** Settings, members, archive. */
export function canManageProject(viewer: WorkViewer, project: ProjectFacts): boolean {
  if (viewer.projectRoles.get(project.id) === "lead" || viewer.teamRoles.get(project.team.id) === "lead") return true;
  return project.visibility !== "private" && canManageWorkspace(viewer, project.team);
}

export function canCreateProject(viewer: WorkViewer, team: TeamFacts): boolean {
  return viewer.teamRoles.has(team.id) || canAdminTeam(viewer, team);
}

/** Create and change tasks in a project: the people working in it, not everyone who may look — a viewer only looks. */
export function canContributeToProject(viewer: WorkViewer, project: ProjectFacts): boolean {
  const role = viewer.projectRoles.get(project.id);
  if ((role && role !== "viewer") || canManageProject(viewer, project)) return true;
  return project.visibility !== "private" && viewer.teamRoles.has(project.team.id);
}

/** Tasks outside any project sit in the team's own backlog. */
export function canContributeToTeam(viewer: WorkViewer, team: TeamFacts): boolean {
  return viewer.teamRoles.has(team.id) || canAdminTeam(viewer, team);
}

const isParty = (viewer: WorkViewer, task: TaskFacts): boolean => {
  const self = viewer.principal.personId;
  return !!self && (task.assigneePersonId === self || task.requesterPersonId === self || task.createdByPersonId === self || task.peopleIds.includes(self));
};

/** Tasks outside any project are as open as a new project of the team would be. */
export function canViewTeamBacklog(viewer: WorkViewer, team: TeamFacts): boolean {
  return seesByVisibility(viewer, team.defaultVisibility, team.entityId, team);
}

export function canViewTask(viewer: WorkViewer, task: TaskFacts): boolean {
  if (isParty(viewer, task)) return true;
  return task.project ? canViewProject(viewer, task.project) : canViewTeamBacklog(viewer, task.team);
}

export function canEditTask(viewer: WorkViewer, task: TaskFacts): boolean {
  const self = viewer.principal.personId;
  // The requester and the creator watch; the assignee and the collaborators do the work.
  if (self && (task.assigneePersonId === self || task.peopleIds.includes(self))) return true;
  return task.project ? canContributeToProject(viewer, task.project) : canContributeToTeam(viewer, task.team);
}

/** Deleting is for whoever runs the project (or team), and for the creator's own mistake. */
export function canDeleteTask(viewer: WorkViewer, task: TaskFacts): boolean {
  const self = viewer.principal.personId;
  if (self && task.createdByPersonId === self && canEditTask(viewer, task)) return true;
  return task.project ? canManageProject(viewer, task.project) : canAdminTeam(viewer, task.team);
}

/** Remove someone else's comment or file: whoever runs the project (or the team, for its backlog). */
export function canModerateTask(viewer: WorkViewer, task: TaskFacts): boolean {
  return task.project ? canManageProject(viewer, task.project) : canAdminTeam(viewer, task.team);
}

/** Handing in a deliverable for review (FR-WRK-08): the people doing the work. */
export function canSubmitDeliverable(viewer: WorkViewer, task: TaskFacts): boolean {
  const self = viewer.principal.personId;
  return !!self && (task.assigneePersonId === self || task.peopleIds.includes(self));
}

/** Deciding a review: the named reviewer or whoever runs the project — never the person who handed the work in. */
export function canDecideReview(viewer: WorkViewer, task: TaskFacts, review: { reviewerPersonId: string | null; submittedByPersonId: string | null }): boolean {
  const self = viewer.principal.personId;
  if (!self || self === review.submittedByPersonId) return false;
  return review.reviewerPersonId === self || canModerateTask(viewer, task);
}

/** Asking "how is this going?" (FR-WRK-07): whoever asked for the task, and whoever runs the project or team. */
export function canNudgeTask(viewer: WorkViewer, task: TaskFacts): boolean {
  const self = viewer.principal.personId;
  return (!!self && (task.requesterPersonId === self || task.createdByPersonId === self)) || canModerateTask(viewer, task);
}

/** A team's templates are kept by whoever runs the team; shared ones (no owner) by `work:manage` over the whole group. */
export function canManageTemplate(viewer: WorkViewer, ownerTeam: TeamFacts | null): boolean {
  return ownerTeam ? canAdminTeam(viewer, ownerTeam) : canManageWorkspace(viewer, { entityId: null, departmentId: null });
}

/**
 * Intake forms (FR-WRK-16) are a team's front door. A form says who may knock: the people of the
 * team's entity, or anyone in the group (a studio serving its sister companies) — never
 * collaborators, who only work inside their projects. The team's own members always may. Asking
 * for work gives no right to see the team's other work.
 */
export function canSubmitIntake(viewer: WorkViewer, team: TeamFacts, audience: "entity" | "group"): boolean {
  if (viewer.teamRoles.has(team.id)) return true;
  if (isCollaborator(viewer) || !viewer.principal.personId) return false;
  return audience === "group" || team.entityId === null || team.entityId === viewer.entityId || canManageWorkspace(viewer, team);
}

// ── Phase 10 (PJM) on the task foundation ───────────────────────────────────────────────────

/** Custom fields (FR-PJM-35): a team's are kept by whoever runs the team, a project's own by whoever runs the project. */
export function canManageCustomFields(viewer: WorkViewer, team: TeamFacts, project: ProjectFacts | null = null): boolean {
  return project ? project.team.id === team.id && canManageProject(viewer, project) : canAdminTeam(viewer, team);
}

/** The triage queue (FR-PJM-32) is the team's own business: its members may look at it. */
export function canViewTriage(viewer: WorkViewer, team: TeamFacts): boolean {
  return canContributeToTeam(viewer, team);
}

/**
 * Accepting, declining, merging or snoozing incoming work — and keeping the triage rules — is the
 * lead's call: it commits the team's time. A member who simply picks a request up would bypass that.
 */
export function canDecideTriage(viewer: WorkViewer, team: TeamFacts): boolean {
  return canAdminTeam(viewer, team);
}

/** Flagging a task blocked (FR-PJM-28): anyone who works on it. */
export function canRaiseBlocker(viewer: WorkViewer, task: TaskFacts): boolean {
  return canEditTask(viewer, task);
}

/** Resolving: the people on the task, whoever raised the blocker, and whoever it waits for — they are the ones who unblock it. */
export function canResolveBlocker(viewer: WorkViewer, task: TaskFacts, blocker: { raisedByPersonId: string; neededPersonId: string | null }): boolean {
  const self = viewer.principal.personId;
  return (!!self && (blocker.raisedByPersonId === self || blocker.neededPersonId === self)) || canEditTask(viewer, task);
}

/**
 * Moving a task to another team (FR-PJM-34): the right to change it here and to put work there —
 * into the target project, or the target team's backlog. A project of another team is no target.
 */
export function canMoveTask(viewer: WorkViewer, task: TaskFacts, target: { team: TeamFacts; project: ProjectFacts | null }): boolean {
  if (target.team.id === task.team.id || (target.project && target.project.team.id !== target.team.id)) return false;
  if (!canEditTask(viewer, task)) return false;
  return target.project ? canContributeToProject(viewer, target.project) : canContributeToTeam(viewer, target.team);
}

/**
 * Hours logged on a project's (or a backlog's) tasks, summed per task in the table view: time
 * entries are for the project's lead and the team's leads (PJM access rules), not for every member.
 */
export function canSeeLoggedTime(viewer: WorkViewer, scope: { team: TeamFacts; project: ProjectFacts | null }): boolean {
  return scope.project ? canManageProject(viewer, scope.project) : canAdminTeam(viewer, scope.team);
}

// ── Hand-offs (FR-PJM-40..46) ───────────────────────────────────────────────────────────────

/** Which transitions need a package, and what it asks: the team's leads — it sets how the team works. */
export function canManageHandoffPackages(viewer: WorkViewer, team: TeamFacts): boolean {
  return canAdminTeam(viewer, team);
}

/** Filling a package and handing the task on: whoever may move the task. */
export function canHandOff(viewer: WorkViewer, task: TaskFacts): boolean {
  return canEditTask(viewer, task);
}

/**
 * Accepting or returning a hand-off: the person it was handed to, or whoever runs the work it is on
 * (a lead may take it in for someone who is away) — never the sender, who cannot accept their own
 * work. "Whoever runs it" is the task's own answer (`canModerateTask`): a private project's
 * hand-offs are answered inside the project, not by anyone with `work:manage` over the team.
 */
export function canRespondToHandoff(viewer: WorkViewer, task: TaskFacts, handoff: { fromPersonId: string | null; toPersonId: string | null }): boolean {
  const self = viewer.principal.personId;
  if (!self || self === handoff.fromPersonId) return false;
  return handoff.toPersonId === self || canModerateTask(viewer, task);
}

/**
 * Sending work on to another team (FR-PJM-42): whoever may move the task, into any other team's
 * triage — a request, not a right to see that team's work. Outside collaborators work inside their
 * projects only.
 */
export function canSendToTeam(viewer: WorkViewer, task: TaskFacts, target: TeamFacts): boolean {
  return target.id !== task.team.id && !isCollaborator(viewer) && canEditTask(viewer, task);
}

export type CoverPlanFacts = { personId: string; entityId: string | null; coverIds: readonly string[] };

/**
 * A cover plan (FR-PJM-44) is the person's own: they fill and submit it. `work:manage` over their
 * entity may do it for them — someone taken ill does not fill forms.
 */
export function canSubmitCoverPlan(viewer: WorkViewer, plan: Pick<CoverPlanFacts, "personId" | "entityId">): boolean {
  return viewer.principal.personId === plan.personId || can(viewer.principal, "work:manage", { entityId: plan.entityId });
}

/** The person, the covers named in it, and whoever may submit it. (Approvers see it beside the leave request, which checks its own access.) */
export function canViewCoverPlan(viewer: WorkViewer, plan: CoverPlanFacts): boolean {
  const self = viewer.principal.personId;
  return (!!self && plan.coverIds.includes(self)) || canSubmitCoverPlan(viewer, plan);
}

/** Only a cover acknowledges what they were asked to cover. */
export function canAcknowledgeCover(viewer: WorkViewer, plan: Pick<CoverPlanFacts, "coverIds">): boolean {
  const self = viewer.principal.personId;
  return !!self && plan.coverIds.includes(self);
}

/**
 * Handing back after the leave: the person back at work, a cover returning what they hold, or
 * whoever may submit the plan. How much goes back is the service's call (`handBackCover`): a cover
 * hands back only their own items, and nobody hands anything back before the leave's last day.
 */
export function canHandBackCover(viewer: WorkViewer, plan: CoverPlanFacts): boolean {
  return canViewCoverPlan(viewer, plan);
}

export type ExitHandoverFacts = { personId: string; managerId: string | null; entityId: string | null; /** The work teams the person is in. */ teamIds: readonly string[] };

/**
 * An exit or transfer handover (FR-PJM-45) is run by the line manager, the leads of the person's
 * teams, and leaders or HR over the person's entity. The leaver may look at it but reassigns
 * nothing: where their work goes is their manager's decision.
 */
export function canRunExitHandover(viewer: WorkViewer, handover: ExitHandoverFacts): boolean {
  const self = viewer.principal.personId;
  if (!self || self === handover.personId) return false;
  if (handover.managerId === self || handover.teamIds.some((teamId) => viewer.teamRoles.get(teamId) === "lead")) return true;
  const scope = { entityId: handover.entityId };
  return can(viewer.principal, "work:manage", scope) || can(viewer.principal, "person:manage", scope);
}

export function canViewExitHandover(viewer: WorkViewer, handover: ExitHandoverFacts): boolean {
  return viewer.principal.personId === handover.personId || canRunExitHandover(viewer, handover);
}

/**
 * Account handover (FR-PJM-46): the client list is kept by leaders with `work:manage`, and so is who
 * owns each relationship — over the client's entity; a group client (no entity) takes a group-wide
 * grant. The projects the role moves on are weighed one by one (`canManageProject`).
 */
export function canChangeAccountManager(viewer: WorkViewer, client: { entityId: string | null }): boolean {
  return canManageWorkspace(viewer, { entityId: client.entityId, departmentId: null });
}

// ── Delivery (FR-PJM-50..57) ────────────────────────────────────────────────────────────────

/** Review chains: a team's are kept by whoever runs the team, a project's own by whoever runs the project. */
export function canManageReviewChains(viewer: WorkViewer, team: TeamFacts, project: ProjectFacts | null = null): boolean {
  return project ? project.team.id === team.id && canManageProject(viewer, project) : canAdminTeam(viewer, team);
}

/**
 * Recording what the client decided (FR-PJM-51): clients have no accounts, so the account side
 * records it — the project's account manager or whoever runs the project; for work outside a
 * project, the client's account manager or the team's leads.
 */
export function canRecordClientDecision(viewer: WorkViewer, task: TaskFacts, client: { accountManagerPersonId: string | null }): boolean {
  if (task.project) return canActForClient(viewer, task.project);
  const self = viewer.principal.personId;
  return (!!self && client.accountManagerPersonId === self) || canAdminTeam(viewer, task.team);
}

export type StageFacts = { isClient: boolean; reviewerPersonId: string | null; submittedByPersonId: string };

/**
 * Deciding a stage of a review chain (FR-PJM-50). An internal stage: its reviewer or whoever runs
 * the project — never the person who handed the work in. A client stage is the client's decision,
 * recorded by the account side (the recorder may have made the work: the client decides, not them).
 */
export function canDecideStage(viewer: WorkViewer, task: TaskFacts, stage: StageFacts, client: { accountManagerPersonId: string | null }): boolean {
  if (stage.isClient) return canRecordClientDecision(viewer, task, client);
  const self = viewer.principal.personId;
  if (!self || self === stage.submittedByPersonId) return false;
  return stage.reviewerPersonId === self || canModerateTask(viewer, task);
}

/** A version the client approved is frozen (FR-PJM-51): nobody changes or removes it, or the file behind it; a change is a new version. */
export function canChangeDeliverable(deliverable: { frozenAt: Date | string | null }): boolean {
  return deliverable.frozenAt === null;
}

/** Pinning feedback on a version (FR-PJM-52): whoever may open the task, as with comments. Collaborators too — they are asked for feedback. */
export function canPinFeedback(viewer: WorkViewer, task: TaskFacts): boolean {
  return canViewTask(viewer, task);
}

/** Resolving a pin: whoever pinned it, and the people doing the work — they are the ones who act on it. */
export function canResolvePin(viewer: WorkViewer, task: TaskFacts, pin: { authorPersonId: string }): boolean {
  return viewer.principal.personId === pin.authorPersonId || canEditTask(viewer, task);
}

/** Recording what went to the client (FR-PJM-53): the people doing the work, and the account side. */
export function canRecordDelivery(viewer: WorkViewer, task: TaskFacts): boolean {
  return canEditTask(viewer, task) || (!!task.project && canActForClient(viewer, task.project));
}

/** The publish log and its results (FR-PJM-54, 57): whoever may change the task — they post it. */
export function canManagePublish(viewer: WorkViewer, task: TaskFacts): boolean {
  return canEditTask(viewer, task);
}

// ── Automations (FR-PJM-33) ─────────────────────────────────────────────────────────────────

/**
 * Keeping a team's rules — and a project's own: only whoever runs the team. A rule acts on everyone's
 * work without asking (moves, assigns, sets dates), so it is the lead's call, not a project member's.
 * A project's own rules also need the right to run that project: `work:manage` over the team does
 * not reach into a private project, and neither do rules written from there.
 */
export function canManageAutomations(viewer: WorkViewer, team: TeamFacts, project: ProjectFacts | null = null): boolean {
  if (!canAdminTeam(viewer, team)) return false;
  return !project || (project.team.id === team.id && canManageProject(viewer, project));
}

/** Reading the rules and their runs: the team's own people — the rules are how the team works. */
export function canViewAutomations(viewer: WorkViewer, team: TeamFacts): boolean {
  return canContributeToTeam(viewer, team);
}
