// Checklists: which template applies, which tasks it becomes, and how far along they are. Pure.
import { addDays, type IsoDate } from "@/lib/dates";

/** The rules a checklist offers. Work templates add "role:<key>", which no checklist form shows. */
export const ASSIGNEE_RULES = ["subject", "line_manager", "person", "permission"] as const;
export type AssigneeRule = { rule: "subject" | "line_manager" } | { rule: "person"; personId: string | null } | { rule: "permission"; permission: string } | { rule: "role"; roleKey: string };

/** Templates whose purpose starts with "work_" belong to work management and its own screens and rules; the checklist screens leave them alone. */
export const isChecklistPurpose = (purpose: string): boolean => !purpose.startsWith("work_");

export const ROLE_KEY = /^[a-z][a-z0-9_]{1,30}$/;

/** Stored as text: "subject" | "line_manager" | "person" | "permission:<permission>" | "role:<key>". */
export function parseAssigneeRule(stored: string, assigneePersonId: string | null): AssigneeRule | null {
  if (stored === "subject" || stored === "line_manager") return { rule: stored };
  if (stored === "person") return { rule: "person", personId: assigneePersonId };
  if (stored.startsWith("permission:") && stored.length > "permission:".length) return { rule: "permission", permission: stored.slice("permission:".length) };
  // A role in a project ("designer", "account"): who plays it is said when the template is used.
  if (stored.startsWith("role:") && ROLE_KEY.test(stored.slice("role:".length))) return { rule: "role", roleKey: stored.slice("role:".length) };
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

export type TemplateItem = { id: string; title: string; description: string | null; linkUrl?: string | null; assigneeRule: string; assigneePersonId: string | null; dueOffsetDays: number; sortOrder: number };
export type PlannedTask = { templateItemId: string; title: string; description: string | null; linkUrl: string | null; assigneePersonId: string | null; dueDate: IsoDate; sortOrder: number };

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
      return { templateItemId: item.id, title: item.title, description: item.description, linkUrl: item.linkUrl ?? null, assigneePersonId: rule ? resolve(rule) : null, dueDate: addDays(anchorDate, item.dueOffsetDays), sortOrder: index };
    });
}

export type Progress = { total: number; done: number; open: number; overdue: number; complete: boolean };

/** Cancelled tasks do not count either way. */
export function summarize(tasks: readonly { status: "todo" | "in_progress" | "done" | "cancelled"; dueDate: IsoDate | null }[], today: IsoDate): Progress {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const open = counted.filter((task) => task.status !== "done");
  return { total: counted.length, done: counted.length - open.length, open: open.length, overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length, complete: counted.length > 0 && open.length === 0 };
}

/**
 * A task's "how to" link: a page inside the app ("/kb/pages/…") or an https address. Anything
 * else — `javascript:`, protocol-relative "//host", a bare word — is refused.
 */
export function isSafeTaskLink(value: string): boolean {
  if (value.length > 500 || /[\s\\]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
