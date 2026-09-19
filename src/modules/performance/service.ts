// The performance module's entry point for routes and other modules.
import "server-only";

export * from "./enums";
export { canCheckIn, canCloseGoal, canEditGoal, canManagePerformanceOf, canReadPerformanceOf, canReopenGoal, canSeeGoal, canSetUnitGoals, type GoalParties, type PersonContext } from "./policy";
export { type CheckInRow, type GoalFormOptions, goalFormOptions, type GoalRights, type GoalRow, type GoalView, type KeyResultRow, type KeyResultView, listGoals, type LoadedGoal, loadGoal, type Viewer } from "./goals";
export { FULL_BP, type GoalProgress, type ProgressLine } from "./engine/progress";

// ── For Phase 8 (review cycles, the final result per person and year, the bonus scheme) ─────
// "OKR progress for person X in year Y": their own goals and their units', frozen where closed.
export { getOkrResults, type OkrFigure, type OkrGoalResult, type OkrResults } from "./goals";
// Week 2 adds its twin here: `getKpiResults({ personId, year })` — the final KPI score per closed period.
