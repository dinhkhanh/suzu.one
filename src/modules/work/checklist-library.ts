// Reading the checklist library (work_checklist) and its stage hooks (work_state_checklist). Both
// are small reference tables read on every state change and by every screen that offers a
// checklist, so each sits whole under one cache key and callers filter it here; the writers
// (checklists.ts) drop the keys once their change has committed. Inside a transaction pass the
// executor, and the rows come from there, not the cache.
//
// Kept apart from the writers so tasks.ts, the hand-off gate and intake forms can read it without
// importing back the modules whose caches the writers must drop.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { type LibraryChecklist, MAX_LINKED_CHECKLISTS, resolveLinked } from "./engine/checklists";

type Executor = Tx | ReturnType<typeof db>;
export type ChecklistRow = typeof schema.workChecklist.$inferSelect;
export type StateChecklistRow = typeof schema.workStateChecklist.$inferSelect;

const CHECKLISTS_KEY = "work:checklists";
const STATE_CHECKLISTS_KEY = "work:state-checklists";

/** After a write to `work_checklist` has committed. */
export const invalidateChecklists = () => invalidate(CHECKLISTS_KEY);
/** After a write to `work_state_checklist` has committed. */
export const invalidateStateChecklists = () => invalidate(STATE_CHECKLISTS_KEY);

async function allChecklists(executor?: Executor): Promise<ChecklistRow[]> {
  const load = (from: Executor) => from.select().from(schema.workChecklist).orderBy(asc(schema.workChecklist.name), asc(schema.workChecklist.id));
  return executor ? load(executor) : cached(CHECKLISTS_KEY, TTL.reference, () => load(db()));
}

/** The library, by name. */
export async function listChecklists(options: { activeOnly?: boolean; executor?: Executor } = {}): Promise<ChecklistRow[]> {
  const rows = await allChecklists(options.executor);
  return options.activeOnly ? rows.filter((row) => row.isActive) : rows;
}

/** One checklist, from the cached library — or from the transaction when one is passed. */
export async function findChecklist(checklistId: string, executor?: Executor): Promise<ChecklistRow | undefined> {
  return (await allChecklists(executor)).find((row) => row.id === checklistId);
}

/** The active checklists a list of ids names, in its order (unknown and retired ones left out). */
export async function resolveChecklists(ids: readonly string[], executor?: Executor): Promise<LibraryChecklist[]> {
  if (ids.length === 0) return [];
  return resolveLinked(ids, await allChecklists(executor));
}

/** The active checklists for an offer list: id and name. */
export async function checklistChoices(): Promise<{ id: string; name: string }[]> {
  return (await listChecklists({ activeOnly: true })).filter((row) => row.items.length > 0).map(({ id, name }) => ({ id, name }));
}

// ── Stage hooks ─────────────────────────────────────────────────────────────────────────────

async function allStateChecklists(): Promise<StateChecklistRow[]> {
  return cached(STATE_CHECKLISTS_KEY, TTL.reference, () => db().select().from(schema.workStateChecklist).orderBy(asc(schema.workStateChecklist.stateId), asc(schema.workStateChecklist.createdAt), asc(schema.workStateChecklist.checklistId)));
}

/** The hooks of the given stages, in the order they were added. */
export async function listStateChecklists(stateIds: readonly string[]): Promise<StateChecklistRow[]> {
  if (stateIds.length === 0) return [];
  const wanted = new Set(stateIds);
  return (await allStateChecklists()).filter((row) => wanted.has(row.stateId));
}

export type StageChecklist = { stateId: string; required: boolean; checklist: LibraryChecklist };

/**
 * The active checklists hooked to the given stages, in one query — read inside the move that
 * enters or leaves them, so a hook added a moment ago holds at once.
 */
export async function stageChecklists(executor: Executor, stateIds: readonly string[]): Promise<StageChecklist[]> {
  if (stateIds.length === 0) return [];
  const rows = await executor
    .select({ stateId: schema.workStateChecklist.stateId, required: schema.workStateChecklist.required, checklist: schema.workChecklist })
    .from(schema.workStateChecklist)
    .innerJoin(schema.workChecklist, eq(schema.workChecklist.id, schema.workStateChecklist.checklistId))
    .where(and(inArray(schema.workStateChecklist.stateId, [...stateIds]), eq(schema.workChecklist.isActive, true)))
    .orderBy(asc(schema.workStateChecklist.createdAt), asc(schema.workStateChecklist.checklistId));
  return rows.filter((row) => row.checklist.items.length > 0).map(({ stateId, required, checklist }) => ({ stateId, required, checklist }));
}

/**
 * Checklists a stage, package, form or template step is about to name: at most a handful, each an
 * active one of the library. Refused otherwise, so a hook never points at nothing. One it already
 * names (`alreadyNamed`) may stay though it has since been retired — saving something else about
 * the stage must not fail over a checklist nobody touched; a retired one adds nothing to tasks.
 */
export async function assertUsable(checklistIds: readonly string[], alreadyNamed: readonly string[] = [], executor?: Executor): Promise<string[]> {
  const ids = [...new Set(checklistIds)];
  if (ids.length > MAX_LINKED_CHECKLISTS) throw new ActionError("checklist_links_too_many");
  if (ids.length === 0) return ids;
  const library = new Map((await listChecklists({ executor })).map((row) => [row.id, row]));
  const kept = new Set(alreadyNamed);
  if (ids.some((id) => !library.get(id)?.isActive && !(kept.has(id) && library.has(id)))) throw new ActionError("checklist_not_found");
  return ids;
}
