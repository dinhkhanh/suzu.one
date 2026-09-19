// Work management's use-cases: the only entry point for other modules and for the routes.
import "server-only";

export * from "./enums";
export { loadViewer, loadViewerWith, type ViewerSource } from "./viewer";
export { canAdminTeam, canContributeToProject, canContributeToTeam, canCreateProject, canDeleteTask, canEditTask, canManageProject, canManageWorkspace, canViewProject, canViewTask, canViewTeam, canViewTeamBacklog, type WorkViewer } from "./policy";
export { type ClientRow, entryState, findClient, findLabel, findState, findTeam, type LabelRow, listClients, listLabels, listStates, listTeamMembers, listTeams, type MemberView, type StateRow, teamFacts, type TeamRow, type TeamSummary } from "./teams";
export { findProject, listProjectMembers, projectFacts, type ProjectMemberView, type ProjectRow, type ProjectSummary, visibleProjects } from "./projects";
export { type ActivityView, createWorkTask, createWorkTaskIn, getTaskDetail, type LinkedTask, listActivity, listProjectTasks, listTeamBacklog, listVisibleTaskIds, loadTask, type NewWorkTask, searchTasks, type TaskDetail, taskKey, type TaskListItem, type TaskSearchHit, visibleTaskCondition, WORK_KIND } from "./tasks";
