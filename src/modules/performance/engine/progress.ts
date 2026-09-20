// Progress roll-up for the goal tree (FR-PRF-01). Pure: plain data in, figures and an explanation
// out — the year-end bonus is computed from these numbers (SRS D13), so anyone must be able to
// redo them by hand. Everything is an integer: progress in basis points (0 … 10000 = 0 … 100 %),
// ratios through BigInt, halves rounded up.
import type { Confidence, GoalStatus, MetricType, Milestone } from "../enums";

export type KeyResultInput = {
  id: string;
  metricType: MetricType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  milestones: Milestone[] | null;
  weight: number;
  confidence: Confidence | null;
};

export type GoalInput = {
  id: string;
  status: GoalStatus;
  weight: number;
  finalProgressBp: number | null;
  keyResults: KeyResultInput[];
  childIds: string[];
};

export type ProgressLine = { kind: "key_result" | "goal"; id: string; weight: number; progressBp: number | null; /** Left out of the average, and why. */ skipped: "cancelled" | "draft" | "not_measured" | "cycle" | null };

export type GoalProgress = {
  progressBp: number | null;
  confidence: Confidence | null;
  /** Where the figure comes from: frozen at close, the goal's own key results, its children, or nothing yet. */
  source: "frozen" | "key_results" | "children" | "none";
  lines: ProgressLine[];
};

export const FULL_BP = 10_000;

/** numerator / denominator in basis points, halves rounded up, kept within 0 … 100 %. */
function ratioBp(numerator: bigint, denominator: bigint): number {
  if (denominator === BigInt(0)) return 0;
  if (denominator < BigInt(0)) return ratioBp(-numerator, -denominator);
  if (numerator <= BigInt(0)) return 0;
  if (numerator >= denominator) return FULL_BP;
  return Number((numerator * BigInt(2 * FULL_BP) + denominator) / (denominator * BigInt(2)));
}

/**
 * How far a key result has come from its start to its target. A target below the start is a
 * "bring it down" metric. Start = target leaves no distance to cover: reached (current ≥ target)
 * or not — write a "stay below" key result with a start value above its target instead.
 */
export function keyResultProgressBp(keyResult: Pick<KeyResultInput, "metricType" | "startValue" | "targetValue" | "currentValue" | "milestones">): number {
  if (keyResult.metricType === "milestone") {
    const milestones = keyResult.milestones ?? [];
    return ratioBp(BigInt(milestones.filter((milestone) => milestone.done).length), BigInt(milestones.length));
  }
  const { startValue, targetValue, currentValue } = keyResult;
  if (startValue === targetValue) return currentValue >= targetValue ? FULL_BP : 0;
  return ratioBp(BigInt(currentValue) - BigInt(startValue), BigInt(targetValue) - BigInt(startValue));
}

/** Σ weight × progress / Σ weight over the lines that have a figure; null when none has. */
export function weightedAverageBp(lines: readonly { weight: number; progressBp: number | null }[]): number | null {
  let total = BigInt(0);
  let weights = BigInt(0);
  for (const line of lines) {
    if (line.progressBp === null || line.weight <= 0) continue;
    total += BigInt(line.weight) * BigInt(line.progressBp);
    weights += BigInt(line.weight);
  }
  if (weights === BigInt(0)) return null;
  return Number((total * BigInt(2) + weights) / (weights * BigInt(2)));
}

const SEVERITY: Record<Confidence, number> = { on_track: 0, at_risk: 1, off_track: 2 };
export function worstConfidence(values: readonly (Confidence | null)[]): Confidence | null {
  let worst: Confidence | null = null;
  for (const value of values) if (value && (worst === null || SEVERITY[value] > SEVERITY[worst])) worst = value;
  return worst;
}

/**
 * One goal's figure:
 * - closed with a frozen figure → that figure, whatever happened since;
 * - with key results → their weighted average (children are alignment, not arithmetic);
 * - without key results → the weighted average of its children, leaving out cancelled and draft
 *   ones and those with nothing to measure yet;
 * - otherwise nothing (null), never a made-up zero.
 */
export function goalProgress(goalId: string, goals: ReadonlyMap<string, GoalInput>, visiting: ReadonlySet<string> = new Set()): GoalProgress {
  const goal = goals.get(goalId);
  if (!goal) return { progressBp: null, confidence: null, source: "none", lines: [] };
  if (goal.status === "closed" && goal.finalProgressBp !== null) return { progressBp: goal.finalProgressBp, confidence: null, source: "frozen", lines: [] };

  if (goal.keyResults.length > 0) {
    const lines: ProgressLine[] = goal.keyResults.map((keyResult) => ({ kind: "key_result", id: keyResult.id, weight: keyResult.weight, progressBp: keyResultProgressBp(keyResult), skipped: null }));
    return { progressBp: weightedAverageBp(lines), confidence: worstConfidence(goal.keyResults.map((keyResult) => keyResult.confidence)), source: "key_results", lines };
  }

  const path = new Set(visiting).add(goalId);
  const confidences: (Confidence | null)[] = [];
  const lines: ProgressLine[] = [];
  for (const childId of goal.childIds) {
    const child = goals.get(childId);
    if (!child) continue;
    if (path.has(childId)) {
      lines.push({ kind: "goal", id: childId, weight: child.weight, progressBp: null, skipped: "cycle" });
      continue;
    }
    if (child.status === "cancelled" || child.status === "draft") {
      lines.push({ kind: "goal", id: childId, weight: child.weight, progressBp: null, skipped: child.status });
      continue;
    }
    const result = goalProgress(childId, goals, path);
    lines.push({ kind: "goal", id: childId, weight: child.weight, progressBp: result.progressBp, skipped: result.progressBp === null ? "not_measured" : null });
    confidences.push(result.confidence);
  }
  const progressBp = weightedAverageBp(lines);
  return { progressBp, confidence: worstConfidence(confidences), source: progressBp === null ? "none" : "children", lines };
}

/** An active goal's key result nobody has checked in on for `days` days (or ever). */
export function isStale(lastCheckInAt: Date | string | null, goalStatus: GoalStatus, now: Date, days = 7): boolean {
  if (goalStatus !== "active") return false;
  if (!lastCheckInAt) return true;
  return now.getTime() - new Date(lastCheckInAt).getTime() > days * 86_400_000;
}

/** The Monday of the week a date (yyyy-mm-dd) falls in. */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
