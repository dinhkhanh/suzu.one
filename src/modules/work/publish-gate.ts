// The publish gate (FR-PJM-54): a content task — one with a channel, or with posts in its publish
// log — cannot enter a "Published" state until a post is out with its URL. Asked by
// `updateWorkTaskIn` (tasks.ts) beside the hand-off gate, so every path that changes a state — the
// task page, the board, bulk edit, Today, a hand-off — meets it. Kept apart from publish.ts so
// tasks.ts can import it without importing itself back.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { isPublishStateName } from "./engine/delivery";

type Executor = Tx | ReturnType<typeof db>;

/** Whether moving into this state would need a published post the task does not have. */
export async function publishBlocks(executor: Executor, task: { id: string; channel: string | null }, toState: { name: string }): Promise<boolean> {
  if (!isPublishStateName(toState.name)) return false;
  const posts = await executor.select({ status: schema.workPublish.status, url: schema.workPublish.url }).from(schema.workPublish).where(eq(schema.workPublish.taskId, task.id));
  // Work that is not content (a TVC handed to the client, an HR task) has no post to prove.
  if (!task.channel && posts.length === 0) return false;
  return !posts.some((post) => post.status === "published" && !!post.url);
}

/** Refuses the move; the screen explains that the post's URL is needed first. */
export async function assertPublishable(executor: Executor, task: { id: string; channel: string | null }, toState: { name: string }): Promise<void> {
  if (await publishBlocks(executor, task, toState)) throw new ActionError("publish_required", { taskId: task.id });
}
