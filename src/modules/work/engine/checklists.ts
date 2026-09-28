// The checklist library (work_checklist): what a checklist may hold, what using one does to a task's
// tick-boxes, and what a required one still asks for before the task moves on. Pure: the service
// loads the library and the task, these functions decide.
//
// Using a checklist copies its items onto the task, each marked with the checklist it came from.
// The copy is the task's own from then on: editing the checklist later changes what later uses
// copy, never boxes already on a task. A copied box can be ticked, not reworded — the text is what
// the department asked for — and while a stage requires its checklist, none of its boxes can go.
import { isSafeTaskLink } from "../../platform/tasks-engine/engine/checklist";
import type { ChecklistItemDef, TaskChecklistItem } from "../schema";

export const MAX_CHECKLIST_ITEMS = 40;
/** Every box on one task, copied and typed: several checklists fit, a runaway loop does not. */
export const MAX_TASK_CHECKLIST = 200;
/** Library checklists one stage, package, intake form or template step may name. */
export const MAX_LINKED_CHECKLISTS = 5;

const ITEM_ID = /^[a-z0-9_]{1,20}$/;

export type LibraryChecklist = { id: string; name: string; items: readonly ChecklistItemDef[]; isActive: boolean };
export type ChecklistItemInput = { id?: string | null; text: string; linkUrl?: string | null };

/** An item keeps its id when it is edited; a new one gets a fresh id. Blank rows are dropped. */
export function normalizeItems(items: readonly ChecklistItemInput[], newId: () => string): ChecklistItemDef[] {
  return items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => {
      const kept = { id: item.id && ITEM_ID.test(item.id) ? item.id : `i_${newId()}`, text: item.text.trim() };
      const linkUrl = item.linkUrl?.trim();
      return linkUrl ? { ...kept, linkUrl } : kept;
    });
}

export type ChecklistProblem = "checklist_name_required" | "checklist_empty" | "checklist_too_many" | "checklist_item_text" | "checklist_item_link" | "checklist_item_duplicate";

export function checklistProblem(checklist: { name: string; items: readonly ChecklistItemDef[] }): ChecklistProblem | null {
  if (!checklist.name.trim()) return "checklist_name_required";
  if (checklist.items.length === 0) return "checklist_empty";
  if (checklist.items.length > MAX_CHECKLIST_ITEMS) return "checklist_too_many";
  if (checklist.items.some((item) => !item.text.trim() || item.text.length > 200)) return "checklist_item_text";
  if (checklist.items.some((item) => item.linkUrl !== undefined && !isSafeTaskLink(item.linkUrl))) return "checklist_item_link";
  if (new Set(checklist.items.map((item) => item.id)).size !== checklist.items.length) return "checklist_item_duplicate";
  return null;
}

/** The active checklists a list of ids names, in its order, each once; unknown and retired ones are left out. */
export function resolveLinked<List extends LibraryChecklist>(ids: readonly string[], library: readonly List[]): List[] {
  const byId = new Map(library.map((list) => [list.id, list]));
  return [...new Set(ids)].flatMap((id) => {
    const list = byId.get(id);
    return list?.isActive && list.items.length > 0 ? [list] : [];
  });
}

export const hasChecklist = (items: readonly TaskChecklistItem[], checklistId: string): boolean => items.some((item) => item.checklistId === checklistId);

/**
 * The task's boxes with the given checklists added at the end — each checklist once: one the task
 * already carries is not added again. `added` names what was added, for the task's activity. With
 * `max`, a checklist that does not fit is left out whole rather than cut short.
 */
export function appendChecklists(current: readonly TaskChecklistItem[], lists: readonly LibraryChecklist[], newId: () => string, options: { /** Leave out a whole checklist that would take the task past this many boxes. */ max?: number } = {}): { items: TaskChecklistItem[]; added: { id: string; name: string }[] } {
  const items = [...current];
  const added: { id: string; name: string }[] = [];
  for (const list of lists) {
    if (hasChecklist(items, list.id) || added.some((row) => row.id === list.id)) continue;
    if (options.max !== undefined && items.length + list.items.length > options.max) continue;
    items.push(...list.items.map((item) => ({ id: newId(), text: item.text, done: false, checklistId: list.id, checklistName: list.name, ...(item.linkUrl ? { linkUrl: item.linkUrl } : {}) })));
    added.push({ id: list.id, name: list.name });
  }
  return { items, added };
}

/**
 * A task's boxes as the person sent them back, made safe: a copied box keeps its origin, text and
 * link from what is stored (only its tick changes); anything else sent is a plain box of the task's
 * own, whatever origin it claims — checklists are added through `appendChecklists`, never by
 * writing their marks by hand.
 */
export function mergeChecklistPatch(stored: readonly TaskChecklistItem[], patch: readonly { id: string; text: string; done: boolean }[]): TaskChecklistItem[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  return patch.map((item) => {
    const before = byId.get(item.id);
    if (before?.checklistId) return { ...before, done: item.done };
    return { id: item.id, text: item.text, done: item.done };
  });
}

/**
 * Copied boxes the patch drops while other boxes of the same checklist stay: a library checklist
 * comes off a task whole or not at all, so a required one cannot be whittled down to the box that
 * happens to be ticked.
 */
export function partlyRemoved(stored: readonly TaskChecklistItem[], next: readonly TaskChecklistItem[]): TaskChecklistItem[] {
  const kept = new Set(next.map((item) => item.id));
  const stillCarried = new Set(next.flatMap((item) => (item.checklistId ? [item.checklistId] : [])));
  return stored.filter((item) => item.checklistId && !kept.has(item.id) && stillCarried.has(item.checklistId));
}

/** The copied boxes of the given checklists that the patch takes away. */
export function removedFrom(stored: readonly TaskChecklistItem[], next: readonly TaskChecklistItem[], checklistIds: ReadonlySet<string>): TaskChecklistItem[] {
  const kept = new Set(next.map((item) => item.id));
  return stored.filter((item) => item.checklistId && checklistIds.has(item.checklistId) && !kept.has(item.id));
}

export type MissingCheck = { checklistId: string; checklistName: string; text: string };

/**
 * What the stage's required checklists still ask for: the unticked boxes each put on the task — or,
 * for one the task does not carry at all (hooked to the stage after the task arrived), every item
 * it has today.
 */
export function missingRequired(items: readonly TaskChecklistItem[], required: readonly LibraryChecklist[]): MissingCheck[] {
  return required.flatMap((list) => {
    const own = items.filter((item) => item.checklistId === list.id);
    if (own.length === 0) return list.items.map((item) => ({ checklistId: list.id, checklistName: list.name, text: item.text }));
    return own.filter((item) => !item.done).map((item) => ({ checklistId: list.id, checklistName: item.checklistName ?? list.name, text: item.text }));
  });
}

type StageFacts = { sortOrder: number; category: string };

/**
 * Does leaving `from` for `to` need the stage's required checklists done? Moving on does; going
 * back a stage (a review sends the work back) or cancelling the task does not.
 */
export const gateApplies = (from: StageFacts, to: StageFacts): boolean => to.category !== "cancelled" && (from.category === "cancelled" || to.sortOrder >= from.sortOrder);

/**
 * Every stage whose required checklists a forward move must have done: the one it leaves and every
 * one it passes over on the way to `to`. Without the ones passed over, a task sent back a stage —
 * or cancelled — could then jump past the stage that held it. Leaving "cancelled" starts from the
 * top, as the task's place in the flow is lost. Going back or cancelling needs none.
 */
export function gatedStages<Stage extends StageFacts & { id: string }>(from: Stage, to: Stage, stages: readonly Stage[]): string[] {
  if (!gateApplies(from, to)) return [];
  const floor = from.category === "cancelled" ? Number.NEGATIVE_INFINITY : from.sortOrder;
  const passed = stages.filter((stage) => stage.id !== to.id && stage.category !== "cancelled" && stage.sortOrder >= floor && stage.sortOrder < to.sortOrder).map((stage) => stage.id);
  return from.category === "cancelled" || passed.includes(from.id) ? passed : [from.id, ...passed];
}

/** A short id for a copied or library checklist item. */
export const newChecklistItemId = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 8);

/** A library item's id inside a hand-off package: stable per checklist and item, short enough for a form. */
export const libraryCheckId = (checklistId: string, itemId: string): string => `l_${checklistId.replaceAll("-", "").slice(0, 12)}_${itemId}`;

/** A package's own checks followed by those of the library checklists it names. */
export function packageChecks(own: readonly { id: string; text: string }[], lists: readonly LibraryChecklist[]): { id: string; text: string }[] {
  return [...own, ...lists.flatMap((list) => list.items.map((item) => ({ id: libraryCheckId(list.id, item.id), text: item.text })))];
}
