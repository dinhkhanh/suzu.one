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
