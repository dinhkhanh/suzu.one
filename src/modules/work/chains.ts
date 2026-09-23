// Review chains (FR-PJM-50): the ordered stages a deliverable version passes through — peer, lead,
// account manager, client — kept per team or per project, optionally for one content format. Which
// chain a task uses is decided when a version is handed in (engine/delivery.ts `chainFor`); a task
// no chain applies to keeps the single-step review of FR-WRK-08.
import "server-only";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { chainFor, chainProblems, type ChainStage } from "./engine/delivery";
import type { ReviewStage } from "./schema";

type Executor = Tx | ReturnType<typeof db>;
export type ReviewChainRow = typeof schema.workReviewChain.$inferSelect;

// The chains are small reference data read whenever a version is handed in and by the team and
// project screens: the whole table sits under one cache key and is filtered here; the writers
// below drop the entry once committed, and the TTL bounds anything written behind the app's back.
const CHAINS_KEY = "work:review-chains";
const CHAINS_TTL = 30 * 60;
/** After a write to `work_review_chain` outside this file (a seed) has committed. */
export const invalidateReviewChains = () => invalidate(CHAINS_KEY);

/**
 * A team's chains and, when a project is named, that project's own — active first, oldest first.
 * Inside a transaction pass the executor, and the rows come from there, not the cache.
 */
export async function listReviewChains(scope: { teamId: string; projectId?: string | null }, executor?: Executor): Promise<ReviewChainRow[]> {
  const chains = schema.workReviewChain;
  if (executor) {
    const where = scope.projectId ? or(and(eq(chains.teamId, scope.teamId), isNull(chains.projectId)), eq(chains.projectId, scope.projectId)) : and(eq(chains.teamId, scope.teamId), isNull(chains.projectId));
    return executor.select().from(chains).where(where).orderBy(asc(chains.createdAt), asc(chains.id));
  }
  const all = await cached(CHAINS_KEY, CHAINS_TTL, () => db().select().from(chains).orderBy(asc(chains.createdAt), asc(chains.id)));
  return all.filter((chain) => (chain.teamId === scope.teamId && chain.projectId === null) || (!!scope.projectId && chain.projectId === scope.projectId));
}

export async function findReviewChain(chainId: string, executor: Executor = db()): Promise<ReviewChainRow | undefined> {
  const [row] = await executor.select().from(schema.workReviewChain).where(eq(schema.workReviewChain.id, chainId)).limit(1);
  return row;
}

/** The chain a task's next version runs through; null = the single-step review. */
export async function chainForTask(executor: Executor, task: { teamId: string; projectId: string | null; contentFormat: string | null }): Promise<ReviewChainRow | null> {
  const rows = await listReviewChains({ teamId: task.teamId, projectId: task.projectId }, executor);
  return chainFor(
    rows.map((row) => ({ ...row, stageCount: row.stages.length })),
    task,
  );
}

export type ChainInput = { name: string; contentFormat: string | null; stages: { key?: string | null; name: string; reviewer: string; dueHours: number | null }[]; isActive: boolean };

const newStageKey = () => Math.random().toString(36).slice(2, 10);

/**
 * A new chain or a change to one. Versions already in review keep their stage number and read the
 * stage names from the chain as it is now; a stage removed under them ends their review at the
 * last stage left.
 */
export async function saveReviewChain(scope: { teamId: string; projectId: string | null }, chainId: string | null, input: ChainInput, actorPersonId: string): Promise<{ before: ReviewChainRow | null; after: ReviewChainRow }> {
  const stages: ReviewStage[] = input.stages.map((stage) => ({ key: stage.key || newStageKey(), name: stage.name.trim(), reviewer: stage.reviewer, dueHours: stage.dueHours }));
  const [problem] = chainProblems(stages as ChainStage[]);
  if (problem) throw new ActionError(problem);
  if (!input.name.trim()) throw new ActionError("chain_name_required");
  const values = { name: input.name.trim(), contentFormat: input.contentFormat, stages, isActive: input.isActive, updatedAt: new Date() };
  const saved = await db().transaction(async (tx) => {
    if (!chainId) {
      const [after] = await tx.insert(schema.workReviewChain).values({ teamId: scope.teamId, projectId: scope.projectId, createdByPersonId: actorPersonId, ...values }).returning();
      return { before: null, after };
    }
    const before = await findReviewChain(chainId, tx);
    // A chain stays where it was made: a team's chain does not turn into a project's.
    if (!before || before.teamId !== scope.teamId || before.projectId !== scope.projectId) throw new ActionError("chain_not_found");
    const [after] = await tx.update(schema.workReviewChain).set(values).where(eq(schema.workReviewChain.id, chainId)).returning();
    return { before, after };
  });
  await invalidateReviewChains();
  return saved;
}

/**
 * Removing a chain retires it: versions on their way through it still need its stage names, so a
 * chain that was ever used is only switched off; one never used goes.
 */
export async function removeReviewChain(chainId: string): Promise<{ before: ReviewChainRow; deleted: boolean }> {
  const removed = await db().transaction(async (tx) => {
    const before = await findReviewChain(chainId, tx);
    if (!before) throw new ActionError("chain_not_found");
    const [used] = await tx.select({ id: schema.workDeliverable.id }).from(schema.workDeliverable).where(eq(schema.workDeliverable.chainId, chainId)).limit(1);
    if (used) await tx.update(schema.workReviewChain).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.workReviewChain.id, chainId));
    else await tx.delete(schema.workReviewChain).where(eq(schema.workReviewChain.id, chainId));
    return { before, deleted: !used };
  });
  await invalidateReviewChains();
  return removed;
}
