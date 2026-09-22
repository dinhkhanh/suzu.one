// Who hears about a task (FR-WRK-17). Following gives notifications, never rights: the policy does
// not look at followers, and a follower who can no longer see the task hears nothing.
import "server-only";
import { and, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { Kind } from "../platform/notifications/kinds";
import { notify } from "../platform/notifications/service";
import { canViewTask } from "./policy";
import { type LoadedTask, loadTask, taskKey } from "./tasks";
import { viewersOfPeople } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
const taskLink = (taskId: string) => `/work/tasks/${taskId}`;

/**
 * Who hears about a task: the assignee, the requester, the collaborators and whoever follows it
 * (commenters and mentioned people follow by themselves) — minus those who muted it. The assignee
 * and the collaborators cannot mute: it is their work.
 */
export function followersOf(loaded: LoadedTask): string[] {
  const working = [loaded.task.assigneePersonId, ...loaded.peopleIds].filter((id): id is string => !!id);
  const watching = [loaded.task.requesterPersonId, ...loaded.followerIds].filter((id): id is string => !!id && !loaded.mutedIds.includes(id));
  return [...new Set([...working, ...watching])];
}

export type FollowState = "working" | "following" | "muted" | "none";
export function followStateOf(loaded: LoadedTask, personId: string): FollowState {
  if (loaded.task.assigneePersonId === personId || loaded.peopleIds.includes(personId)) return "working";
  if (loaded.mutedIds.includes(personId)) return "muted";
  return loaded.task.requesterPersonId === personId || loaded.followerIds.includes(personId) ? "following" : "none";
}

/** Never turns a collaborator into a follower, and never un-mutes: a row that exists stays as it is. */
export async function autoFollow(tx: Executor, taskId: string, personIds: readonly string[]): Promise<void> {
  if (personIds.length) await tx.insert(schema.workTaskPerson).values(personIds.map((personId) => ({ taskId, personId, role: "follower" }))).onConflictDoNothing();
}

export async function setFollowing(taskId: string, personId: string, follow: boolean): Promise<{ before: FollowState; after: FollowState }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const before = followStateOf(loaded, personId);
    if (before === "working") throw new ActionError("follow_working");
    const role = follow ? "follower" : "muted";
    // The requester hears by default, so their "unfollow" has to be remembered; anyone else just stops following.
    if (!follow && loaded.task.requesterPersonId !== personId) await tx.delete(schema.workTaskPerson).where(and(eq(schema.workTaskPerson.taskId, taskId), eq(schema.workTaskPerson.personId, personId)));
    else await tx.insert(schema.workTaskPerson).values({ taskId, personId, role }).onConflictDoUpdate({ target: [schema.workTaskPerson.taskId, schema.workTaskPerson.personId], set: { role } });
    const after = followStateOf((await loadTask(taskId, tx))!, personId);
    return { before, after };
  });
}

/**
 * A notice to everyone following the task, except the person who caused it and `skip` (people who
 * get a more specific notice for the same event). A stored follower who can no longer see the
 * task — moved out of a private project — hears nothing.
 */
export async function notifyFollowers(tx: Executor, loaded: LoadedTask, actorPersonId: string | null, kind: Kind, params: Record<string, string | number>, skip: readonly string[] = []): Promise<string[]> {
  const candidates = followersOf(loaded).filter((personId) => personId !== actorPersonId && !skip.includes(personId));
  const viewers = await viewersOfPeople(candidates.filter((personId) => loaded.followerIds.includes(personId)), tx);
  const recipients = candidates.filter((personId) => {
    if (!loaded.followerIds.includes(personId)) return true;
    const viewer = viewers.get(personId);
    return !!viewer && canViewTask(viewer, loaded.facts);
  });
  await notify({ recipients, kind, params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: taskLink(loaded.task.id) }, tx);
  return recipients;
}
