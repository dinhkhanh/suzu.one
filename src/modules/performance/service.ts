// The performance module's entry point for routes and other modules.
import "server-only";

export * from "./enums";
export { canCheckIn, canCloseGoal, canCloseKpiMonth, canEditGoal, canEnterActualsFor, canManageAssignmentsOf, canManageKpiLibrary, canManagePerformanceOf, canManagePositionKpis, canOpenKpiAdmin, canOpenOverview, canReadPerformanceOf, canReopenGoal, canReopenKpiMonth, canSeeGoal, canSetUnitGoals, type GoalParties, overviewReach, type PersonContext } from "./policy";
export { type CheckInRow, type GoalFormOptions, goalFormOptions, type GoalRights, type GoalRow, type GoalView, type KeyResultRow, type KeyResultView, listGoals, type LoadedGoal, loadGoal, type Viewer } from "./goals";
export { FULL_BP, type GoalProgress, type ProgressLine } from "./engine/progress";

// ── For Phase 8 (review cycles, the final result per person and year, the bonus scheme) ─────
// "OKR progress for person X in year Y": their own goals and their units', frozen where closed.
export { getOkrResults, type OkrFigure, type OkrGoalResult, type OkrResults } from "./goals";
// "Final KPI score for person X in year Y": from the stored (closed, not superseded) month scores only.
// Neither function authorizes: the caller decides who may see the result.
export { getKpiResults, isKpiMonthClosed, type KpiMonthResult, type KpiResults } from "./kpi-scores";
export { getPerformanceResults, type PerformanceResults } from "./results";

// ── KPIs (week 2) ───────────────────────────────────────────────────────────────────────────
export { type AssignmentView, type KpiRow, listAssignments, listKpis, listPositionTemplates, type PositionTemplate, templateFor } from "./kpis";
export { closeBlockers, type CloseBlocker, getScorecard, isMissing, listPeriods, type KpiPeriodRow, type Scorecard } from "./kpi-scores";
export { type EntryRow, getEntryGrid, getOverview, getTeamDashboard, type Overview, type OverviewEntity, type Spread, type TeamRow } from "./kpi-views";
export { loadDirectory, reportsBelow, type DirectoryPerson } from "./people";
export type { AnnualKpiLine, KpiLineFlag, KpiTrace, KpiTraceLine } from "./engine/kpi-score";

// ── Review cycles (Phase 8 week 1, FR-PRF-03, 08) ───────────────────────────────────────────
export { canAcknowledgeReview, canManageCycle, canManageReviewTemplates, canReadAnonymisedPeers, canReadReviewForm, canReleaseReview, canSeeParticipant, canWriteManagerReview, canWritePeerReview, canWriteSelfReview, isReviewingManager, type ReviewParties } from "./review-policy";
export {
  cycleProgress,
  eligibleParticipants,
  findParticipant,
  findReviewCycle,
  findReviewTemplate,
  listCycleParticipants,
  listFormsOf,
  listMyParticipations,
  listReleasedReviewScores,
  listReviewCycles,
  listReviewTemplates,
  loadParticipant,
  type LoadedParticipant,
  nextCycleStatus,
  type ParticipantLine,
  partiesOfParticipant,
  type ReviewCycleRow,
  type ReviewFormRow,
  type ReviewParticipantRow,
  type ReviewPeerNominationRow,
  type ReviewTemplateRow,
  listReviewsIOwe,
} from "./reviews";
export { isAnswered, missingRequired, type ReviewScoreLine, type ReviewScoreTrace, scoreReviewForm } from "./engine/review-score";

// ── Peer / 360 (week 2) ─────────────────────────────────────────────────────────────────────
export { canDecideNomination, canNominatePeer, canSeeNominations, nominationIsApproved } from "./review-policy";
export { findNomination, isApprovedPeer, listPeerInvitations, peerCandidates, type PeerInvitation } from "./reviews";

// ── The final yearly result (week 2, FR-PRF-09) ─────────────────────────────────────────────
export { canComputeResults, canDecidePerformanceRules, canOpenResults, canOverrideResult, canProposeWeighting, canReadResultOf, canSettleResultOf } from "./policy";
export { bandOf, DEFAULT_PERFORMANCE_WEIGHTING, FULL_WEIGHT_BP, OKR_LEVELS, type OkrLevel, PERFORMANCE_RESULT_STATUSES, type PerformanceResultStatus, type PerformanceWeightingValue, performanceWeightingSchema, type ResultBand, RESULT_COMPONENTS, type ResultComponentKey } from "./enums";
export { finalResult, okrFigure, type OkrMixLine, type ResultComponentLine, type ResultOverride, type ResultTrace } from "./engine/result";
export { getWeighting, getWeightingVersion, hasWeighting, listWeightingVersions, type PerformanceWeightingRow, type ResolvedWeighting, weightingDateOf } from "./weighting";
/**
 * What the year-end bonus run reads (FR-PAY-21). `listFinalResults` and `getFinalResult` hand back
 * **settled** results only — locked or published — with the trace that explains each figure.
 * No authorization inside: payroll decides who may see an amount built on them.
 */
export { findResult, findResultById, getFinalResult, getPublishedResult, listFinalResults, listResults, type PerformanceResultRow, previewResult, type ResultLine, resultYears } from "./final-results";
/**
 * The other half of the bonus contract: once a run is approved, payroll records the stored KPI
 * scores it was computed from, and `reopenMonth` then refuses to take those months back.
 */
export { consumedMonths, isMonthConsumed, isYearConsumed, type KpiScoreUseRow, markScoresConsumed, monthConsumers, releaseConsumedScores, type ScoreUse } from "./consumption";

// ── The evidence panel (week 2, FR-PRF-07) ──────────────────────────────────────────────────
export { loadReviewEvidence, type ReviewEvidence } from "./evidence";

// ── 1:1 notes and review outcomes (week 3, FR-PRF-04, 06) ───────────────────────────────────
export { canDecideOutcome, canRaiseOutcome, canReadOneOnOne, canReadOneOnOnePrivate, canSeeOutcome, canWriteOneOnOne } from "./policy";
export { addOneOnOneAction, completeOneOnOneAction, createOneOnOne, findOneOnOne, findOneOnOneAction, listOneOnOnes, loadOneOnOne, myReports, ONE_ON_ONE_CONTEXT, type OneOnOneActionRow, type OneOnOneRow, type OneOnOneView, shareOneOnOne, updateOneOnOne } from "./one-on-ones";
export { decideOutcome, findOutcome, listOutcomes, OUTCOME_CONTEXT, type OutcomeInput, raiseOutcome, type ReviewOutcomeRow } from "./outcomes";
