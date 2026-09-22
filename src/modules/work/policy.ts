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
