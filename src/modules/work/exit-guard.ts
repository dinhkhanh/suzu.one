// The gate of the work handover step (FR-PJM-45): registered with the task engine's completion
// guards (work/schema.ts registers it; completion-guards.ts explains why there), it refuses to mark
// the step done while the person still owns anything, and closes the handover when it lets it through.
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { CompletionGuard } from "../platform/tasks-engine/completion-guards";
import { ownershipSummary } from "./engine/exit";
import { listOwnership } from "./exit";

type Executor = Tx | ReturnType<typeof db>;

export const exitHandoverGuard: CompletionGuard = async (executor, task) => {
  if (task.kind !== "checklist") return null;
  const tx = (executor ?? db()) as Executor;
  const [handover] = await tx.select().from(schema.workExitHandover).where(and(eq(schema.workExitHandover.taskId, task.id), eq(schema.workExitHandover.status, "open"))).limit(1);
  if (!handover) return null;
  // The daily module's time weeks are read on their own connection: only outside a transaction.
  const summary = ownershipSummary(await listOwnership(handover.personId, tx, { timeWeeks: tx === db() }));
  if (!summary.clear) return { reason: "work_handover_open", details: { count: summary.total, kinds: summary.blocking, link: `/work/handover/${handover.id}` } };
  await tx.update(schema.workExitHandover).set({ status: "done", doneAt: new Date(), updatedAt: new Date() }).where(eq(schema.workExitHandover.id, handover.id));
  return null;
};
