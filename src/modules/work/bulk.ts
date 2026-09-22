// Bulk edit (FR-PJM-36): one change applied to many selected tasks. Each task is checked and
// written on its own — its own authorization, its own transaction, its own activity — so a task
// the viewer may not touch, or one the change does not fit (a state of another team's workflow),
// is reported back by name while the rest go through.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { canEditTask, canViewTask, type WorkViewer } from "./policy";
import { type ActivityEntry, loadTasks, taskKey, updateWorkTaskIn, type WorkTaskPatch } from "./tasks";

export const MAX_BULK = 200;

export type BulkPatch = {
  stateId?: string;
  assigneePersonId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  priority?: number | null;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  customValues?: Record<string, unknown>;
  /** FR-PJM-10: plan into a cycle of the task's team (null takes them out). */
  cycleId?: string | null;
};

/** A refusal carries what the screen needs to put it right — the hand-off package a move requires (FR-PJM-40). */
export type BulkOutcome = { updated: { id: string; key: string; changes: ActivityEntry[] }[]; refused: { id: string; key: string | null; reason: string; details?: unknown }[] };

export async function bulkEditTasks(viewer: WorkViewer, taskIds: readonly string[], patch: BulkPatch, actorPersonId: string): Promise<BulkOutcome> {
  const ids = [...new Set(taskIds)].slice(0, MAX_BULK);
  const loaded = await loadTasks(ids);
  const outcome: BulkOutcome = { updated: [], refused: [] };
  const { addLabelIds, removeLabelIds, ...plain } = patch;
  for (const id of ids) {
    const found = loaded.get(id);
    if (!found) {
      outcome.refused.push({ id, key: null, reason: "task_not_found" });
      continue;
    }
    // A task the viewer may not even open is not there as far as they can tell: answering
    // "forbidden" with its key would turn bulk edit into a way of asking whether a task exists.
    if (!canViewTask(viewer, found.facts)) {
      outcome.refused.push({ id, key: null, reason: "task_not_found" });
      continue;
    }
    const key = taskKey(found.team.key, found.work.number);
    if (!canEditTask(viewer, found.facts)) {
      outcome.refused.push({ id, key, reason: "forbidden" });
      continue;
    }
    try {
      const changes = await db().transaction(async (tx) => {
        const taskPatch: WorkTaskPatch = { ...plain };
        if (addLabelIds?.length || removeLabelIds?.length) {
          const current = (await tx.select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, id))).map((row) => row.labelId);
          taskPatch.labelIds = [...new Set([...current, ...(addLabelIds ?? [])])].filter((labelId) => !(removeLabelIds ?? []).includes(labelId));
        }
        return (await updateWorkTaskIn(tx, id, taskPatch, actorPersonId)).changes;
      });
      outcome.updated.push({ id, key, changes });
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      outcome.refused.push({ id, key, reason: error.message, ...(error.details === undefined ? {} : { details: error.details }) });
    }
  }
  return outcome;
}
