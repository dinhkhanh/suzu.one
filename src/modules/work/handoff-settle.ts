// A cross-team hand-off (FR-PJM-42) is answered by the receiving team's triage: accepting the
// follow-on task accepts the hand-off, declining returns it with the lead's reason, merging it into
// a task the team already has accepts it there. Called by triage.ts inside its own transaction.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { loadTask, logActivity, taskKey } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;

export async function settleCrossTeamHandoff(tx: Executor, receivingTaskId: string, outcome: { status: "accepted"; targetTaskId?: string } | { status: "returned"; reason: string }, actor: { personId: string; fullName: string }): Promise<number> {
  const rows = await tx
    .update(schema.workHandoff)
    .set({
      status: outcome.status,
      respondedByPersonId: actor.personId,
      respondedAt: new Date(),
      returnReason: outcome.status === "returned" ? outcome.reason : null,
      ...(outcome.status === "accepted" && outcome.targetTaskId ? { targetTaskId: outcome.targetTaskId } : {}),
    })
    .where(and(eq(schema.workHandoff.targetTaskId, receivingTaskId), eq(schema.workHandoff.kind, "cross_team"), eq(schema.workHandoff.status, "pending")))
    .returning();
  for (const handoff of rows) {
    if (!handoff.taskId) continue;
    const source = await loadTask(handoff.taskId, tx);
    if (!source) continue;
    const task = `${taskKey(source.team.key, source.work.number)} ${source.task.title}`;
    await logActivity(tx, handoff.taskId, actor.personId, [{ type: outcome.status === "accepted" ? "handoff_accepted" : "handoff_returned", to: { name: outcome.status === "returned" ? outcome.reason : actor.fullName } }]);
    if (handoff.fromPersonId && handoff.fromPersonId !== actor.personId) {
      await notify(
        outcome.status === "accepted"
          ? { recipients: [handoff.fromPersonId], kind: "tasks.handoff_accepted", params: { actor: actor.fullName, task }, link: `/work/tasks/${handoff.taskId}` }
          : { recipients: [handoff.fromPersonId], kind: "tasks.handoff_returned", params: { actor: actor.fullName, task, reason: outcome.reason }, link: `/work/tasks/${handoff.taskId}` },
        tx,
      );
    }
  }
  return rows.length;
}
