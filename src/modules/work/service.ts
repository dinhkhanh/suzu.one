// Work management's use-cases: the only entry point for other modules and for the routes.
import "server-only";

export * from "./enums";
export { loadViewer, loadViewerWith, type ViewerSource } from "./viewer";
export { canAdminTeam, canContributeToProject, canContributeToTeam, canCreateProject, canDeleteTask, canEditTask, canJoinTaskConversation, canManageProject, canManageWorkspace, canModerateTask, canViewProject, canViewTask, canViewTeam, canViewTeamBacklog, canDecideReview, canSubmitIntake, canManageTemplate, canNudgeTask, canSubmitDeliverable, readsPrivateByPortfolio, type WorkViewer } from "./policy";
export { notePrivateProjectRead, notePrivateProjectReads } from "./private-reads";
export { addableMembers, type ClientRow, entryState, findClient, findLabel, findState, findTeam, type LabelRow, listClients, listLabels, listStates, listTeamMembers, listTeams, type MemberChoice, type MemberView, type StateRow, teamFacts, type TeamRow, type TeamSummary } from "./teams";
export { type CreateTargets, findProject, listAssignable, listAssignableByTeam, listCreateTargets, listProjectMembers, listProjectOptions, projectFacts, type ProjectMemberView, type ProjectRow, type ProjectSummary, visibleProjects } from "./projects";
export { type ActivityView, createWorkTask, createWorkTaskIn, getTaskDetail, type LinkedTask, listActivity, listLinkableTasks, listProjectTasks, listTeamBacklog, listVisibleTaskIds, loadTask, type NewWorkTask, searchTasks, type TaskDetail, taskKey, type TaskListItem, type TaskSearchHit, visibleTaskCondition, WORK_KIND } from "./tasks";
export { listSavedViews, type SavedViewRow } from "./views";
export { type CalendarItem, listCalendarTasks, withEditable } from "./calendar";
export { type CommentView, listComments, listMentionable } from "./comments";
export { type FollowState, followersOf, followStateOf } from "./followers";
export { listTaskFiles, TASK_FILE_OWNER, type TaskFileView } from "./attachments";
export { clientOfTask, countReviewsWaitingFor, type DecisionView, type DeliverableView, listDeliverables, listReviewsWaitingFor, pendingDeliverable, type ReviewWaiting } from "./reviews";
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
/**
 * Phase 9 (FR-RPT-04): throughput, on-time rate, workload and revision rounds by team and client.
 * Scope-filtered in SQL by `visibleTaskCondition`, the same clause the work screens use — the
 * report is a different shape of the rows the viewer may already open, never a wider set.
 */
export { type AnalyticsCell, type AnalyticsFilter, defaultAnalyticsPeriod, getWorkAnalytics, type NamedGroup, type WorkAnalytics } from "./analytics";
/** Phase 10 (FR-PJM-20..23): the person's own work and activity for Today, the plan and the EOD report — no authorization inside; the daily module decides who reads the result. */
export { type DayTask, type FeedEvent, type FeedKind, type HandoffWaiting, listDayTasks, listHandoffsWaitingFor, listOpenBlockersRaisedBy, listOpenWorkOf, listWorkActivityBetween, type OpenBlocker } from "./day-feed";
/**
 * Phase 10 (FR-PJM-01..27): the project layer builds on projects and tasks. Work never imports
 * projects — the plan half of a template is applied through `createProjectFromTemplate`'s callback.
 */
export { invalidateWorkDirectory } from "./directory";
export { createProjectFromTemplate, findWorkTemplate, type ProjectCreatedHook, type TemplateUse } from "./templates";
export { loadTasks, type LoadedTask } from "./tasks";
export { viewersOfPeople } from "./viewer";
/**
 * Phase 10 on the task foundation: custom fields (FR-PJM-35), bulk edit (FR-PJM-36), moves between
 * teams (FR-PJM-34), triage (FR-PJM-32) and blockers (FR-PJM-28). `sendToTriage` runs inside the
 * caller's transaction (a cross-team hand-off puts the receiving task there); the blocker reads
 * carry no authorization — the caller holds task ids or a person it may already read about.
 */
export { canDecideTriage, canManageCustomFields, canMoveTask, canRaiseBlocker, canResolveBlocker, canSeeLoggedTime, canViewTriage } from "./policy";
export { asFieldDef, type CustomFieldRow, listCustomFields, toFieldViews } from "./custom-fields";
export { countTriage, listMergeTargets, listTriage, listTriageForLead, listTriageRules, sendToTriage, type TriageItem, triageLink, type TriageRuleRow, type TriageWaiting } from "./triage";
export { blockedMinutes, type BlockerView, listBlockersRaisedOn, listBlockersWaitingOn, listOpenBlockers, listTaskBlockers, type RaisedBlocker } from "./blockers";
export { loggedMinutesByTask } from "./table";
export { resolveTaskKey } from "./tasks";
export { listMoveTargets } from "./move";
/**
 * Phase 10 hand-offs (FR-PJM-40..46) and cycles (FR-PJM-10). Stage hand-offs are enforced inside
 * `updateWorkTaskIn` — every change of state passes the gate. Reads here carry no authorization
 * beyond what their names say; the statistics are aggregates for the delivery dashboards, for the
 * teams the caller names. Leave cover reads the leave module; exit handover reads core HR's
 * lifecycle events and guards the offboarding step (registered in schema.ts).
 */
export { canAcknowledgeCover, canChangeAccountManager, canHandBackCover, canHandOff, canManageHandoffPackages, canRespondToHandoff, canRunExitHandover, canSendToTeam, canSubmitCoverPlan, canViewCoverPlan, canViewExitHandover } from "./policy";
export { type HandoffPackageRow, type HandoffRequirement, listPackages } from "./handoff-gate";
export { type AccountHandoffView, handoffReturnsByTask, handoffStatsByStage, type HandoffView, listAccountHandoffs, listPendingHandoffsFor, listTaskHandoffs, type StageHandoffStats } from "./handoffs";
export { coverPlanFacts, type CoverPlanSummary, type CoverPlanView, getCoverPlan, getCoverPlanForLeave, getCoverPlanForLeaveAs, listCoverPlansFor } from "./cover";
export { exitHandoverFacts, type ExitHandoverView, getExitHandover, listExitHandoversFor } from "./exit";
export { type CyclePage, type CycleRow, getCyclePage, listOpenCycles, listTeamCycles } from "./cycles";
export { HANDOFF_KINDS, NOTE_PARTS } from "./engine/handoff";
export { OWNERSHIP_KINDS, type OwnedItem } from "./engine/exit";
/**
 * Phase 10 delivery (FR-PJM-50..57): review chains, client decisions, pins, delivery records, the
 * publish log and its results. The `...ByTask` reads and `revisionRoundsByTask` carry no
 * authorization — the caller names tasks it may already read (the projects register, the client
 * report, the close-out). `deliveryFactsByTask` is what the deliverables register marks its lines by:
 * client-approved (a frozen version), delivered, published, and the latest client decision.
 */
export { canChangeDeliverable, canDecideStage, canManagePublish, canManageReviewChains, canPinFeedback, canRecordClientDecision, canRecordDelivery, canResolvePin } from "./policy";
export { listReviewChains, type ReviewChainRow } from "./chains";
export { listTaskPins, type PinView } from "./pins";
export { type DeliveryView, listDeliveriesByTask } from "./deliveries";
export { type CalendarPublish, type ContentCalendar, contentCalendar, listCalendarPublishes, listPublishesByTask, listResultsByTask, publishCountsByTask, type PublishView, type ResultView } from "./publish";
export { type DeliveryFacts, deliveryFactsByTask, type LastClientDecision, type RevisionRounds, revisionRoundsByTask } from "./delivery-facts";
export { CLIENT_CHANNELS, REVIEWER_RULES, STAGE_DECISIONS } from "./engine/delivery";
/**
 * Phase 10, the client's expiring review link (D24, FR-PJM-51a). `openPreviewLink` and
 * `decideOnPreviewLink` are the **public** surface: they take a token and a visitor, never a user,
 * and they check everything themselves — the routes under `(preview)` hand them the request and
 * print what comes back. `listPreviewLinks` carries no authorization; `canManagePreviewLinks`
 * decides who may see it, and the task page asks before it calls.
 */
export { canManagePreviewLinks, canRevokePreviewLink } from "./preview-policy";
export { decideOnPreviewLink, findPreviewLink, listPreviewLinks, openPreviewLink, type PreviewDecisionInput, type PreviewLinkView, type PreviewOutcome, type PreviewPage, purgePreviewHits } from "./preview";
export { PREVIEW_DECISIONS, PREVIEW_DEFAULT_DAYS, PREVIEW_MAX_DAYS, PREVIEW_MIN_DAYS, type PreviewState } from "./engine/preview";
/**
 * Phase 10 automations (FR-PJM-33): a team's (or a project's own) "when … then …" rules. They run
 * inside the work module's own changes; `fireProjectAutomations` is for the projects module's quota
 * alerts, called inside its transaction with the alert's key so a repeated alert runs nothing twice.
 */
export { canManageAutomations, canViewAutomations } from "./policy";
export { type AutomationPanel, automationPanel, type AutomationRow, type AutomationRunView, fireProjectAutomations, listAutomationRuns, listAutomations, listTaskTemplates } from "./automations";
export { AUTOMATION_ACTIONS, AUTOMATION_PRESETS, AUTOMATION_TRIGGERS, CLIENT_DECISIONS, CONDITION_FIELDS, CONDITION_OPS, QUOTA_PERCENTS, ROLES_FOR, WATCHED_FIELDS } from "./engine/automation";
