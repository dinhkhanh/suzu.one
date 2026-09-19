// A work template's item tree → dated, assigned tasks (FR-WRK-10). Pure.
import { addDays, type IsoDate } from "@/lib/dates";
import { parseAssigneeRule } from "../../platform/tasks-engine/engine/checklist";

export type TreeItem = { id: string; parentItemId: string | null; title: string; description: string | null; assigneeRule: string; assigneePersonId: string | null; dueOffsetDays: number; sortOrder: number; estimateMinutes: number | null };
export type PlannedNode = { templateItemId: string; parentItemId: string | null; title: string; description: string | null; assigneePersonId: string | null; roleKey: string | null; dueDate: IsoDate; estimateMinutes: number | null; depth: number };

/**
 * "start": offsets count from the kick-off date. "end": the template's last step lands on the
 * date (an event day, a go-live) and everything else is counted back from it.
 */
export type Anchor = { mode: "start" | "end"; date: IsoDate };

const bySortOrder = (a: { sortOrder: number; dueOffsetDays: number }, b: { sortOrder: number; dueOffsetDays: number }) => a.sortOrder - b.sortOrder || a.dueOffsetDays - b.dueOffsetDays;

/**
 * Parents before their children, siblings in template order. An item whose parent is missing
 * becomes a top-level task rather than disappearing. A due date that falls on a day off moves to
 * the next working day ("start") or the one before ("end": never past the deadline).
 */
export function planTree(items: readonly TreeItem[], anchor: Anchor, roles: Readonly<Record<string, string | null | undefined>>, isDayOff: (date: IsoDate) => boolean = () => false): PlannedNode[] {
  const ids = new Set(items.map((item) => item.id));
  const childrenOf = new Map<string | null, TreeItem[]>();
  for (const item of items) {
    const parent = item.parentItemId && ids.has(item.parentItemId) && item.parentItemId !== item.id ? item.parentItemId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), item]);
  }
  const shift = anchor.mode === "end" ? -Math.max(0, ...items.map((item) => item.dueOffsetDays)) : 0;
  const step = anchor.mode === "end" ? -1 : 1;
  const workingDay = (date: IsoDate): IsoDate => {
    let day = date;
    // A calendar never has two weeks of days off in a row; the bound only stops a broken predicate.
    for (let moved = 0; isDayOff(day) && moved < 14; moved++) day = addDays(day, step);
    return day;
  };

  const planned: PlannedNode[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const item of [...(childrenOf.get(parentId) ?? [])].sort(bySortOrder)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const rule = parseAssigneeRule(item.assigneeRule, item.assigneePersonId);
      const roleKey = rule?.rule === "role" ? rule.roleKey : null;
      const assigneePersonId = rule?.rule === "person" ? rule.personId : roleKey ? (roles[roleKey] ?? null) : null;
      planned.push({ templateItemId: item.id, parentItemId: parentId, title: item.title, description: item.description, assigneePersonId, roleKey, dueDate: workingDay(addDays(anchor.date, item.dueOffsetDays + shift)), estimateMinutes: item.estimateMinutes, depth });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  // A loop of parents (a → b → a) has no root: its items still become top-level tasks.
  for (const item of [...items].sort(bySortOrder)) if (!seen.has(item.id)) { childrenOf.set(null, [item]); visit(null, 0); }
  return planned;
}

/** The roles a template asks for, in the order the tasks will appear. */
export function roleKeysOf(items: readonly TreeItem[]): string[] {
  return [...new Set(planTree(items, { mode: "start", date: "2000-01-01" }, {}).flatMap((node) => (node.roleKey ? [node.roleKey] : [])))];
}
