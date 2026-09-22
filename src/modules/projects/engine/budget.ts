// Hours budget burn (FR-PJM-09). Pure. Burn = logged + the estimates still ahead, against the
// budget: a project that has logged 60 of 100 hours with 30 hours of open work is at 90%, which is
// the moment the lead needs to hear about it — not when the timesheets finally reach 100.

/** Alert levels, in percent of the budget. Each is sent once per project (`project_plan.budget_alerted`). */
export const BUDGET_THRESHOLDS = [80, 100] as const;

export type BurnLevel = "none" | "ok" | "warning" | "over";
export type Burn = {
  loggedMinutes: number;
  remainingMinutes: number;
  /** logged + remaining. */
  burnMinutes: number;
  budgetMinutes: number | null;
  /** burn ÷ budget, whole percent rounded down; null without a budget. */
  percent: number | null;
  /** logged ÷ budget alone. */
  loggedPercent: number | null;
  level: BurnLevel;
};

const percentOf = (part: number, whole: number) => Math.floor((part / whole) * 100);

export function budgetBurn(input: { loggedMinutes: number; remainingMinutes: number; budgetMinutes: number | null }): Burn {
  const logged = Math.max(0, input.loggedMinutes);
  const remaining = Math.max(0, input.remainingMinutes);
  const burn = logged + remaining;
  const budget = input.budgetMinutes && input.budgetMinutes > 0 ? input.budgetMinutes : null;
  const percent = budget ? percentOf(burn, budget) : null;
  const level: BurnLevel = percent === null ? "none" : percent >= BUDGET_THRESHOLDS[1] ? "over" : percent >= BUDGET_THRESHOLDS[0] ? "warning" : "ok";
  return { loggedMinutes: logged, remainingMinutes: remaining, burnMinutes: burn, budgetMinutes: budget, percent, loggedPercent: budget ? percentOf(logged, budget) : null, level };
}

/** What is still ahead on one open task: its estimate less what was logged on it, never below zero. */
export const remainingOf = (estimateMinutes: number | null, loggedMinutes: number): number => Math.max(0, (estimateMinutes ?? 0) - loggedMinutes);

/**
 * Thresholds crossed and not yet alerted, lowest first. A project that jumps from 50% to 110% in
 * one day gets both marked, and the caller sends one notice at the highest.
 */
export function alertsDue(percent: number | null, alerted: readonly number[]): number[] {
  if (percent === null) return [];
  return BUDGET_THRESHOLDS.filter((threshold) => percent >= threshold && !alerted.includes(threshold));
}

/** The total of a budget by role (FR-PJM-09: "Video editing 40 h"). */
export const totalOfRoles = (roles: readonly { minutes: number }[]): number => roles.reduce((sum, role) => sum + Math.max(0, role.minutes), 0);
