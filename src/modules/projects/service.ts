// The project layer's use-cases (Phase 10, FR-PJM-01..15, 27): the only entry point for other
// modules and for the routes.
import "server-only";

export { BRIEF_STATUSES, type BriefStatus, briefEditable, briefProblems, briefSubmittable, PROJECT_KINDS, type ProjectKind } from "./engine/brief";
export { BUDGET_THRESHOLDS, type Burn, type BurnLevel } from "./engine/budget";
export { type Slip, baselineSlip, slipWords } from "./engine/baseline";
export { REGISTER_STATUSES, type RegisterStatus } from "./engine/register";
export { HEALTHS, type Health, isStale, linkedProgress, updateDueOn } from "./engine/status";
export { canEditClientSide, canEditFees, canEditPlan, canPostStatus, canSeeFees, canViewPlan } from "./policy";
export { backfillPlans, ensurePlan, type PlanRow, type PlanView, shapePlan, syncProjectAccountManager } from "./plans";
export { briefRequestProject, getBriefRequest, projectBriefRequest } from "./kickoff";
export { type DeliverableRow, listStructure, type MilestoneRow, type PhaseRow } from "./structure";
export { loadBurns, loadMilestoneTasks, loadRegisters, loadStatusFacts, type Register, type RegisterLine } from "./metrics";
export { listStatusUpdates, projectFollowers, type StatusUpdateView } from "./status-updates";
export { filterPortfolio, listPortfolio, PORTFOLIO_GROUPS, type PortfolioFilters, type PortfolioGroup, type PortfolioRow, showsFees } from "./portfolio";
export { applyTemplatePlanIn, listTemplatePlans, type TemplatePlanRow } from "./template-plans";
export { auditPrivateRead, auditPrivateTaskRead, openBriefForApprover, openProject, type ProjectContext, type ProjectReader } from "./views";
export { listTaskLinks, type TaskLinkView } from "./links";
export type { ProjectBrief, StatusFacts } from "./schema";
/** Timeline, baselines, bookings and capacity (FR-PJM-07, 12, 13). */
export { canManageBookings, canOpenCapacity, canRebaseline, canSeeCapacityOf, canViewBookings, type CapacityReader, type CapacitySubject } from "./policy";
export { getTimeline, type TimelineMilestone, type TimelinePhase, type TimelineTask, type TimelineView } from "./timeline";
export { loadTaskSlips, type TaskSlipView } from "./baselines";
export { type SlipSummary, slipSummary, taskSlip } from "./engine/baseline";
export { listBookingsOfPerson, listProjectBookings, type BookingView, type PersonBookingView } from "./bookings";
export { BOOKING_STATUSES, type BookingStatus, type CapacityCell, isMonday, mondayOf, type Week, weeksFrom } from "./engine/capacity";
export { CAPACITY_WEEKS, capacityOfBooked, type CapacityPerson, type CapacityView, type CellBooking, getCapacity, listCapacitySubjects, loadCapacityReader, type OpenPlaceholder } from "./capacity";
/**
 * The commercial side of delivery (FR-PJM-06, 11, 55, 56, 58, 59): retainers, change requests,
 * acceptance, the billing hand-off, client reports and the close-out. Every list shapes money out
 * for a reader without `pjm:commercial`; the billing queue is cut to the reader's entities in SQL.
 */
export { billingReach, canCloseProject, canDecideBilling, canEditRetainer, canHoldRetro, canManageAcceptance, canManageChanges, canOpenBillingQueue, canWriteClientReport, type PlanFacts } from "./policy";
export { getRetainer, listPeriodOptions, listPeriods, type PeriodLine, type PeriodView, type RetainerConsumption, retainerConsumption, type RetainerView, shapeRetainer } from "./retainers";
export { hoursUsage, QUOTA_THRESHOLDS, RETAINER_ROLLOVERS, type RetainerRollover, type Usage, type UsageLevel } from "./engine/retainer";
export { changeRequestType, type ChangeView, getChangeLedger, getChangeRequest, listChanges, openChangesForApprover } from "./change-requests";
export { CHANGE_REQUESTERS, CHANGE_STATUSES, type ChangeLedger, type ChangeStatus, changeEditable } from "./engine/change-request";
export { acceptanceDocument, type AcceptanceView, type AcceptanceWaiting, type AcceptanceWords, awaitingAcceptance, findAcceptance, listAcceptances, signedTargets } from "./acceptance";
export { ACCEPTANCE_SCOPES, type AcceptanceScope, acceptanceNext, type AcceptanceStatus, BILLING_STATUSES, type BillingStatus } from "./engine/acceptance";
export { billingEntities, billingItemForAcceptance, type BillingFilters, type BillingItemView, listBillingQueue, listProjectBilling } from "./billing";
export { clientReportFigures, defaultReportPeriod, entityLetterhead, findClientReport, listClientReports } from "./client-reports";
export { type ReportFigures, reportText, type ReportWords } from "./engine/client-report";
export { getCloseChecklist, getRetro, previewCloseReport, type StoredCloseReport } from "./close";
export { CLOSE_CHECKS, type ChecklistItem, type CloseReport } from "./engine/close";
export { planProjectFor } from "./views";
export { ACCEPTANCE_TEMPLATE_CODE, seedAcceptanceTemplate } from "./seed";
/**
 * Collaboration (FR-PJM-29..31): the risks, issues and decisions log, meeting notes with their
 * decisions and action items, and the project's document space on the knowledge base.
 */
export { canAddRaid, canCloseRaidItem, canCreateProjectSpace, canEditMeeting, canEditRaidItem, canRecordMeeting, canViewMeetings, canViewRaid, type RaidItemFacts } from "./policy";
export { canBecomeTask, DEFAULT_MEETING_MINUTES, hasSeverity, MEETING_KINDS, type MeetingKind, meetingWindow, RAID_KINDS, RAID_SEVERITIES, RAID_STATUSES, type RaidCounts, raidCounts, type RaidKind, type RaidSeverity, RECORDABLE_MEETING_KINDS } from "./engine/raid";
export { findRaidItem, listRaid, type RaidView } from "./raid-log";
export { findMeeting, getMeeting, listMeetings, type MeetingActionView, type MeetingListItem, meetingPeople, type MeetingView, putMeetingInCalendar, removeMeetingFromCalendar } from "./meetings";
export { getProjectDocuments, type ProjectDocuments, projectSpaceKey } from "./documents";
export { loadRaidCounts } from "./metrics";
