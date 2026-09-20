// Work management's use-cases: the only entry point for other modules and for the routes.
import "server-only";

export * from "./enums";
export { loadViewer, loadViewerWith, type ViewerSource } from "./viewer";
export { canAdminTeam, canContributeToProject, canContributeToTeam, canCreateProject, canDeleteTask, canEditTask, canManageProject, canManageWorkspace, canModerateTask, canViewProject, canViewTask, canViewTeam, canViewTeamBacklog, canDecideReview, canSubmitIntake, canManageTemplate, canNudgeTask, canSubmitDeliverable, type WorkViewer } from "./policy";
export { type ClientRow, entryState, findClient, findLabel, findState, findTeam, type LabelRow, listClients, listLabels, listStates, listTeamMembers, listTeams, type MemberView, type StateRow, teamFacts, type TeamRow, type TeamSummary } from "./teams";
export { type CreateTargets, findProject, listAssignable, listCreateTargets, listProjectMembers, projectFacts, type ProjectMemberView, type ProjectRow, type ProjectSummary, visibleProjects } from "./projects";
export { type ActivityView, createWorkTask, createWorkTaskIn, getTaskDetail, type LinkedTask, listActivity, listProjectTasks, listTeamBacklog, listVisibleTaskIds, loadTask, type NewWorkTask, searchTasks, type TaskDetail, taskKey, type TaskListItem, type TaskSearchHit, visibleTaskCondition, WORK_KIND } from "./tasks";
export { listSavedViews, type SavedViewRow } from "./views";
export { type CalendarItem, listCalendarTasks, withEditable } from "./calendar";
export { type CommentView, listComments, listMentionable } from "./comments";
export { type FollowState, followersOf, followStateOf } from "./followers";
export { listTaskFiles, type TaskFileView } from "./attachments";
export { countReviewsWaitingFor, type DeliverableView, listDeliverables, listReviewsWaitingFor, pendingDeliverable, type ReviewWaiting } from "./reviews";
export { listWorkTemplates, WORK_TEMPLATE_PURPOSES, type WorkTemplateView } from "./templates";
export { listRecurrences, type RecurrenceView } from "./recurrences";
export { getLeaderView, type LeaderTask, type LeaderView, listMyWorkItems, type MyWorkItem } from "./leader";
export { getWorkload, WORKLOAD_WEEKS, type WorkloadPerson, type WorkloadView } from "./workload";
export { findIntakeForm, type IntakeFormRow, type IntakeFormView, listMyIntakeRequests, listOpenIntakeForms, listTeamIntakeForms } from "./intake";
export { INTAKE_FIELD_TYPES, type IntakeField, type IntakeFieldType, MAX_INTAKE_FIELDS } from "./engine/intake";
/**
 * Phase 8 (FR-PRF-07): how much work one person got through in a period, for the evidence panel
 * of a performance review. Counts only, and **no authorization inside** — performance has already
 * decided that the reviewer may read this person's performance data.
 */
export { getPersonTaskStats, type PersonTaskStats } from "./stats";
