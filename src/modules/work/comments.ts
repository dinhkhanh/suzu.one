// The conversation on a task (FR-WRK-09, 17): threaded comments with @mentions and reactions,
// followers, and the notices that go to them. Whoever may see a task may comment on it.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { dropMentions, extractMentionIds } from "./engine/mentions";
import { REACTIONS, type Reaction } from "./enums";
import { autoFollow, followersOf, followStateOf, notifyFollowers } from "./followers";
import { canViewTask } from "./policy";
import { type LoadedTask, loadTask, logActivity, taskKey } from "./tasks";
import { viewersOfPeople } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
export type CommentRow = typeof schema.workComment.$inferSelect;
const taskLink = (taskId: string) => `/work/tasks/${taskId}`;

// ── Comments ────────────────────────────────────────────────────────────────────────────────

export type CommentView = { id: string; parentId: string | null; authorPersonId: string; authorName: string; body: string; reactions: Record<string, string[]>; editedAt: Date | null; deleted: boolean; createdAt: Date };

/** Oldest first. A deleted comment keeps its place (its replies still make sense) but not its words. */
export async function listComments(taskId: string): Promise<CommentView[]> {
  const rows = await db()
    .select({ comment: schema.workComment, authorName: schema.person.fullName })
    .from(schema.workComment)
    .innerJoin(schema.person, eq(schema.person.id, schema.workComment.authorPersonId))
    .where(eq(schema.workComment.taskId, taskId))
    .orderBy(asc(schema.workComment.createdAt), asc(schema.workComment.id));
  const withReplies = new Set(rows.map((row) => row.comment.parentId).filter(Boolean));
  return rows
    .filter((row) => !row.comment.deletedAt || withReplies.has(row.comment.id))
    .map(({ comment, authorName }) => ({ id: comment.id, parentId: comment.parentId, authorPersonId: comment.authorPersonId, authorName, body: comment.deletedAt ? "" : comment.body, reactions: comment.deletedAt ? {} : comment.reactions, editedAt: comment.editedAt, deleted: !!comment.deletedAt, createdAt: comment.createdAt }));
}

export async function findComment(commentId: string, executor: Executor = db()): Promise<CommentRow | undefined> {
  const [row] = await executor.select().from(schema.workComment).where(and(eq(schema.workComment.id, commentId), isNull(schema.workComment.deletedAt))).limit(1);
  return row;
}

/** Mentions that may stand: people who exist, are still here and may see the task. */
async function allowedMentions(tx: Executor, loaded: LoadedTask, body: string): Promise<Set<string>> {
  const candidates = extractMentionIds(body).slice(0, 20);
  const viewers = await viewersOfPeople(candidates, tx);
  return new Set(candidates.filter((personId) => {
    const viewer = viewers.get(personId);
    return !!viewer && canViewTask(viewer, loaded.facts);
  }));
}

const excerpt = (body: string) => {
  const plain = body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, "@$1").replace(/\s+/g, " ").trim();
  return plain.length > 140 ? `${plain.slice(0, 139)}…` : plain;
};

export async function addComment(taskId: string, input: { body: string; parentId: string | null }, author: { id: string; fullName: string }): Promise<{ comment: CommentRow; mentioned: string[]; told: string[] }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await findComment(input.parentId, tx);
      if (!parent || parent.taskId !== taskId) throw new ActionError("comment_not_found");
      // One level of threads: a reply to a reply joins the same thread.
      parentId = parent.parentId ?? parent.id;
    }
    const allowed = await allowedMentions(tx, loaded, input.body);
    const body = dropMentions(input.body, allowed);
    const mentioned = [...allowed].filter((id) => id !== author.id);
    const [comment] = await tx.insert(schema.workComment).values({ taskId, authorPersonId: author.id, parentId, body, mentions: [...allowed] }).returning();
    await logActivity(tx, taskId, author.id, [{ type: "commented", to: { id: comment.id } }]);
    await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));

    const params = { name: author.fullName, excerpt: excerpt(body) };
    await notify({ recipients: mentioned, kind: "tasks.mentioned", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, ...params }, link: taskLink(taskId) }, tx);
    const told = await notifyFollowers(tx, loaded, author.id, "tasks.commented", params, mentioned);
    // From now on the author and the people they called in hear about the task.
    await autoFollow(tx, taskId, [author.id, ...mentioned].filter((id) => followStateOf(loaded, id) === "none"));
    return { comment, mentioned, told };
  });
}

export async function editComment(commentId: string, body: string, author: { id: string; fullName: string }): Promise<{ before: CommentRow; after: CommentRow; mentioned: string[] }> {
  return db().transaction(async (tx) => {
    const before = await findComment(commentId, tx);
    if (!before) throw new ActionError("comment_not_found");
    const loaded = await loadTask(before.taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const allowed = await allowedMentions(tx, loaded, body);
    const [after] = await tx.update(schema.workComment).set({ body: dropMentions(body, allowed), mentions: [...allowed], editedAt: new Date() }).where(eq(schema.workComment.id, commentId)).returning();
    // Only people the edit newly calls in are told; nobody is told twice about one comment.
    const mentioned = [...allowed].filter((id) => id !== author.id && !before.mentions.includes(id));
    await notify({ recipients: mentioned, kind: "tasks.mentioned", params: { key: taskKey(loaded.team.key, loaded.work.number), title: loaded.task.title, name: author.fullName, excerpt: excerpt(after.body) }, link: taskLink(before.taskId) }, tx);
    await autoFollow(tx, before.taskId, mentioned.filter((id) => followStateOf(loaded, id) === "none"));
    return { before, after, mentioned };
  });
}

export async function deleteComment(commentId: string, actorPersonId: string): Promise<CommentRow> {
  return db().transaction(async (tx) => {
    const [row] = await tx.update(schema.workComment).set({ deletedAt: new Date() }).where(and(eq(schema.workComment.id, commentId), isNull(schema.workComment.deletedAt))).returning();
    if (!row) throw new ActionError("comment_not_found");
    await logActivity(tx, row.taskId, actorPersonId, [{ type: "comment_deleted", from: { id: row.id } }]);
    return row;
  });
}

export async function toggleReaction(commentId: string, emoji: Reaction, personId: string): Promise<{ comment: CommentRow; added: boolean }> {
  if (!REACTIONS.includes(emoji)) throw new ActionError("reaction_invalid");
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.workComment).where(and(eq(schema.workComment.id, commentId), isNull(schema.workComment.deletedAt))).for("update").limit(1);
    if (!row) throw new ActionError("comment_not_found");
    const people = row.reactions[emoji] ?? [];
    const added = !people.includes(personId);
    const next = { ...row.reactions, [emoji]: added ? [...people, personId] : people.filter((id) => id !== personId) };
    if (next[emoji].length === 0) delete next[emoji];
    const [comment] = await tx.update(schema.workComment).set({ reactions: next }).where(eq(schema.workComment.id, commentId)).returning();
    return { comment, added };
  });
}

/** The picker's list: the people around the task who may see it. A typed token for anyone else is checked the same way on save. */
export async function listMentionable(loaded: LoadedTask): Promise<{ id: string; fullName: string }[]> {
  const [teamMembers, projectMembers] = await Promise.all([
    db().select({ id: schema.workTeamMember.personId }).from(schema.workTeamMember).where(eq(schema.workTeamMember.teamId, loaded.team.id)),
    loaded.project ? db().select({ id: schema.workProjectMember.personId }).from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, loaded.project.id)) : [],
  ]);
  const ids = [...new Set([...teamMembers, ...projectMembers].map((row) => row.id).concat(followersOf(loaded), loaded.task.createdByPersonId ?? []))];
  if (ids.length === 0) return [];
  const [people, viewers] = await Promise.all([
    db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, ids)).orderBy(asc(schema.person.fullName)),
    viewersOfPeople(ids),
  ]);
  return people.filter((person) => {
    const viewer = viewers.get(person.id);
    return !!viewer && canViewTask(viewer, loaded.facts);
  });
}
