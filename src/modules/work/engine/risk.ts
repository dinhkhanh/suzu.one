// Which open tasks a leader should look at (FR-WRK-07). Pure.
import type { IsoDate } from "@/lib/dates";
import { addDays } from "@/lib/dates";
import type { StateCategory } from "../enums";

export type RiskFacts = { category: StateCategory; dueDate: IsoDate | null; /** Open tasks blocking this one. */ blockedBy: number };
export type Risk = "overdue" | "at_risk" | null;

export const AT_RISK_WITHIN_DAYS = 2;

/**
 * Overdue: open and past its date. At risk: open and either blocked by another open task, or due
 * within two days while nobody has started it. Closed tasks are never either.
 */
export function riskOf(task: RiskFacts, today: IsoDate): Risk {
  if (task.category === "done" || task.category === "cancelled") return null;
  if (task.dueDate !== null && task.dueDate < today) return "overdue";
  if (task.blockedBy > 0) return "at_risk";
  const notStarted = task.category === "backlog" || task.category === "todo";
  return notStarted && task.dueDate !== null && task.dueDate <= addDays(today, AT_RISK_WITHIN_DAYS) ? "at_risk" : null;
}
