// Checklists: which template applies, which tasks it becomes, and how far along they are. Pure.
import { addDays, type IsoDate } from "@/lib/dates";

export const ASSIGNEE_RULES = ["subject", "line_manager", "person", "permission"] as const;
export type AssigneeRule = { rule: "subject" | "line_manager" } | { rule: "person"; personId: string | null } | { rule: "permission"; permission: string };

/** Stored as text: "subject" | "line_manager" | "person" | "permission:<permission>". */
export function parseAssigneeRule(stored: string, assigneePersonId: string | null): AssigneeRule | null {
  if (stored === "subject" || stored === "line_manager") return { rule: stored };
  if (stored === "person") return { rule: "person", personId: assigneePersonId };
  if (stored.startsWith("permission:") && stored.length > "permission:".length) return { rule: "permission", permission: stored.slice("permission:".length) };
  return null;
}

export type TemplateScope = { id: string; entityId: string | null; departmentId: string | null; positionId: string | null; isActive: boolean };
export type Placement = { entityId: string | null; departmentId: string | null; positionId: string | null };

/**
 * The most specific active template that fits: position beats department beats entity beats
 * "everyone". A template fits when each scope it names matches; ties go to the first one given.
 */
export function pickTemplate<T extends TemplateScope>(templates: readonly T[], placement: Placement): T | null {
  let best: { template: T; score: number } | null = null;
  for (const template of templates) {
    if (!template.isActive) continue;
    const fits =
      (template.entityId === null || template.entityId === placement.entityId) &&
      (template.departmentId === null || template.departmentId === placement.departmentId) &&
      (template.positionId === null || template.positionId === placement.positionId);
    if (!fits) continue;
    const score = (template.positionId ? 4 : 0) + (template.departmentId ? 2 : 0) + (template.entityId ? 1 : 0);
    if (!best || score > best.score) best = { template, score };
  }
  return best?.template ?? null;
}

export type TemplateItem = { id: string; title: string; description: string | null; assigneeRule: string; assigneePersonId: string | null; dueOffsetDays: number; sortOrder: number };
export type PlannedTask = { templateItemId: string; title: string; description: string | null; assigneePersonId: string | null; dueDate: IsoDate; sortOrder: number };

/**
 * Items + anchor date + "who is that rule today" → task rows. `resolve` returns the first person a
 * rule names, or null: a task nobody can be found for is still created, unassigned, so it shows
 * up on the checklist instead of silently not happening.
 */
export function planChecklist(items: readonly TemplateItem[], anchorDate: IsoDate, resolve: (rule: AssigneeRule) => string | null): PlannedTask[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dueOffsetDays - b.dueOffsetDays)
    .map((item, index) => {
      const rule = parseAssigneeRule(item.assigneeRule, item.assigneePersonId);
      return { templateItemId: item.id, title: item.title, description: item.description, assigneePersonId: rule ? resolve(rule) : null, dueDate: addDays(anchorDate, item.dueOffsetDays), sortOrder: index };
    });
}

export type Progress = { total: number; done: number; open: number; overdue: number; complete: boolean };

/** Cancelled tasks do not count either way. */
export function summarize(tasks: readonly { status: "todo" | "in_progress" | "done" | "cancelled"; dueDate: IsoDate | null }[], today: IsoDate): Progress {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const open = counted.filter((task) => task.status !== "done");
  return { total: counted.length, done: counted.length - open.length, open: open.length, overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length, complete: counted.length > 0 && open.length === 0 };
}
