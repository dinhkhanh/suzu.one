// The conversation on a task against a real Postgres (PGlite): who a mention may reach, who hears
// about a comment and a move, that following gives no rights, and that reminders go out once.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { addComment, deleteComment, editComment, listComments, listMentionable, toggleReaction } from "./comments";
import { mentionToken } from "./engine/mentions";
import { followersOf, followStateOf, setFollowing } from "./followers";
import { sendWorkReminders } from "./jobs";
import { canEditTask, canViewTask } from "./policy";
import { createProject, setProjectMember } from "./projects";
import { createWorkTask, listActivity, listVisibleTaskIds, loadTask, updateWorkTask } from "./tasks";
import { createTeam, listStates, setTeamMember } from "./teams";
import { viewerOfPerson } from "./viewer";

const ids = {} as Record<"szm" | "szc" | "long" | "tam" | "huy" | "khoi" | "video" | "teamProject" | "privateProject" | "task" | "privateTask", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const named = (key: "long" | "tam" | "huy" | "khoi") => ({ id: ids[key], fullName: { long: "Long Dang", tam: "Tam Bui", huy: "Huy Ho", khoi: "Khoi Ly" }[key] });

async function addPerson(name: string, entityId: string) {
  const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase().replaceAll(" ", ".")}@suzu.group`, status: "active", primaryEntityId: entityId }).returning();
  return row.id;
}
async function noticesOf(personId: string, kind?: string) {
  const rows = await db().select().from(schema.notification).where(eq(schema.notification.recipientPersonId, personId));
  return rows.filter((row) => !kind || row.kind === kind);
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  for (const [key, name, entity] of [["long", "Long Dang", szm.id], ["tam", "Tam Bui", szm.id], ["huy", "Huy Ho", szm.id], ["khoi", "Khoi Ly", szc.id]] as const) ids[key] = await addPerson(name, entity);
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.video = video.id;
  for (const personId of [ids.tam, ids.huy]) await setTeamMember(video.id, personId, "member");
  const project = (name: string, visibility: "team" | "private", actor: string) => createProject({ teamId: video.id, name, description: null, clientId: null, status: "active", visibility, leadPersonId: null, startDate: null, dueDate: null }, actor);
  ids.teamProject = (await project("TVC Tet", "team", ids.long)).id;
  ids.privateProject = (await project("Pitch — confidential", "private", ids.tam)).id;
  ids.task = (await createWorkTask({ teamId: video.id, projectId: ids.teamProject, title: "Rough cut", assigneePersonId: ids.huy, requesterPersonId: ids.long }, ids.long)).task.id;
  ids.privateTask = (await createWorkTask({ teamId: video.id, projectId: ids.privateProject, title: "Pitch deck" }, ids.tam)).task.id;
});

describe("comments and mentions", () => {
  it("tell the mentioned person once, the other followers about the comment, and never the author", async () => {
    const body = `${mentionToken("Tam Bui", ids.tam)} xem bản dựng https://drive.google.com/file/d/abc`;
    const { comment, mentioned, told } = await addComment(ids.task, { body, parentId: null }, named("long"));
    expect(mentioned).toEqual([ids.tam]);
    // Huy is the assignee; Long (requester and author) hears nothing about his own comment.
    expect(told).toEqual([ids.huy]);
    expect((await noticesOf(ids.tam)).map((row) => row.kind)).toEqual(["tasks.mentioned"]);
    expect((await noticesOf(ids.huy, "tasks.commented"))).toHaveLength(1);
    expect(await noticesOf(ids.long, "tasks.commented")).toHaveLength(0);
    expect((await noticesOf(ids.huy, "tasks.commented"))[0].params).toMatchObject({ name: "Long Dang", excerpt: "@Tam Bui xem bản dựng https://drive.google.com/file/d/abc" });
    // The mentioned person follows from now on; the author was already the requester.
    const loaded = (await loadTask(ids.task))!;
    expect(followStateOf(loaded, ids.tam)).toBe("following");
    expect(followersOf(loaded).sort()).toEqual([ids.huy, ids.long, ids.tam].sort());
    expect((await listActivity(ids.task)).some((entry) => entry.type === "commented")).toBe(true);
    expect(comment.mentions).toEqual([ids.tam]);
  });

  it("drop a mention of someone who cannot see the task: plain text, no notice, no follower", async () => {
    const { comment, mentioned } = await addComment(ids.privateTask, { body: `${mentionToken("Huy Ho", ids.huy)} và ${mentionToken("Khoi Ly", ids.khoi)} xem nhé`, parentId: null }, named("tam"));
    // Long leads the team and sees the private project; Huy (plain member) and Khoi (another entity) do not.
    expect(mentioned).toEqual([]);
    expect(comment.body).toBe("@Huy Ho và @Khoi Ly xem nhé");
    expect(await noticesOf(ids.huy, "tasks.mentioned")).toHaveLength(0);
    expect(await noticesOf(ids.khoi)).toHaveLength(0);
    expect((await listMentionable((await loadTask(ids.privateTask))!)).map((person) => person.id).sort()).toEqual([ids.long, ids.tam].sort());
  });

  it("keep replies one level deep, and only inside the same task", async () => {
    const root = await addComment(ids.task, { body: "v2 đã lên", parentId: null }, named("huy"));
    const reply = await addComment(ids.task, { body: "ok", parentId: root.comment.id }, named("tam"));
    const nested = await addComment(ids.task, { body: "cảm ơn", parentId: reply.comment.id }, named("huy"));
    expect(nested.comment.parentId).toBe(root.comment.id);
    expect(await fails(addComment(ids.privateTask, { body: "x", parentId: root.comment.id }, named("tam")))).toBe("comment_not_found");
  });

  it("edit tells only the newly mentioned; a deleted comment keeps its place while it has replies", async () => {
    const { comment } = await addComment(ids.task, { body: "ai duyệt?", parentId: null }, named("huy"));
    const before = (await noticesOf(ids.tam, "tasks.mentioned")).length;
    const { mentioned } = await editComment(comment.id, `${mentionToken("Tam Bui", ids.tam)} duyệt giúp`, named("huy"));
    expect(mentioned).toEqual([ids.tam]);
    expect(await noticesOf(ids.tam, "tasks.mentioned")).toHaveLength(before + 1);
    expect((await editComment(comment.id, `${mentionToken("Tam Bui", ids.tam)} duyệt giúp nhé`, named("huy"))).mentioned).toEqual([]);

    await addComment(ids.task, { body: "để mình", parentId: comment.id }, named("tam"));
    await deleteComment(comment.id, ids.huy);
    const shown = (await listComments(ids.task)).find((row) => row.id === comment.id);
    expect(shown).toMatchObject({ deleted: true, body: "" });
    expect(await fails(editComment(comment.id, "again", named("huy")))).toBe("comment_not_found");
    const lonely = await addComment(ids.task, { body: "nhầm", parentId: null }, named("huy"));
    await deleteComment(lonely.comment.id, ids.huy);
    expect((await listComments(ids.task)).some((row) => row.id === lonely.comment.id)).toBe(false);
  });

  it("toggle reactions per person", async () => {
    const { comment } = await addComment(ids.task, { body: "xong", parentId: null }, named("huy"));
    expect((await toggleReaction(comment.id, "👍", ids.tam)).comment.reactions).toEqual({ "👍": [ids.tam] });
    expect((await toggleReaction(comment.id, "👍", ids.long)).comment.reactions["👍"]).toHaveLength(2);
    expect((await toggleReaction(comment.id, "👍", ids.tam)).added).toBe(false);
    expect((await toggleReaction(comment.id, "👍", ids.long)).comment.reactions).toEqual({});
  });
});

describe("followers", () => {
  it("get no rights from following: a follower of a private task still cannot see or edit it", async () => {
    await db().insert(schema.workTaskPerson).values({ taskId: ids.privateTask, personId: ids.huy, role: "follower" });
    const loaded = (await loadTask(ids.privateTask))!;
    const huy = (await viewerOfPerson(db(), ids.huy))!;
    expect(loaded.followerIds).toEqual([ids.huy]);
    expect(canViewTask(huy, loaded.facts)).toBe(false);
    expect(canEditTask(huy, loaded.facts)).toBe(false);
    expect(await listVisibleTaskIds(huy)).not.toContain(ids.privateTask);
    // …and hears nothing about it either.
    const before = (await noticesOf(ids.huy)).length;
    await addComment(ids.privateTask, { body: "bản mới", parentId: null }, named("tam"));
    expect(await noticesOf(ids.huy)).toHaveLength(before);
  });

  it("hear about a move to another state — except the person who moved it and whoever was just handed it", async () => {
    const done = (await listStates([ids.video])).find((state) => state.category === "in_review")!;
    const count = async (personId: string) => (await noticesOf(personId, "tasks.status_changed")).length;
    const [long, tam, huy] = await Promise.all([count(ids.long), count(ids.tam), count(ids.huy)]);
    await updateWorkTask(ids.task, { stateId: done.id }, ids.huy);
    expect([await count(ids.long), await count(ids.tam), await count(ids.huy)]).toEqual([long + 1, tam + 1, huy]);
    expect((await noticesOf(ids.long, "tasks.status_changed")).at(-1)?.params).toMatchObject({ name: "Huy Ho", state: done.name, title: "Rough cut" });
  });

  it("the requester can mute, a follower can leave, the assignee cannot", async () => {
    expect(await setFollowing(ids.task, ids.long, false)).toEqual({ before: "following", after: "muted" });
    expect(await setFollowing(ids.task, ids.tam, false)).toEqual({ before: "following", after: "none" });
    expect(await fails(setFollowing(ids.task, ids.huy, false))).toBe("follow_working");
    expect(followersOf((await loadTask(ids.task))!)).toEqual([ids.huy]);
    expect(await setFollowing(ids.task, ids.long, true)).toEqual({ before: "muted", after: "following" });
    // A muted requester who is mentioned stays muted: the mention itself still reaches them.
    await setFollowing(ids.task, ids.long, false);
    await addComment(ids.task, { body: `${mentionToken("Long Dang", ids.long)} ơi`, parentId: null }, named("huy"));
    expect(followStateOf((await loadTask(ids.task))!, ids.long)).toBe("muted");
  });
});

describe("reminders", () => {
  it("go to the assignee once per day: due tomorrow and overdue, bundled per person", async () => {
    await setProjectMember(ids.teamProject, ids.huy, "member");
    await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Colour grade", assigneePersonId: ids.huy, dueDate: "2026-09-21" }, ids.long);
    await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Sound mix", assigneePersonId: ids.huy, dueDate: "2026-09-21" }, ids.long);
    await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Subtitles", assigneePersonId: ids.tam, dueDate: "2026-09-19" }, ids.long);
    await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Not yet", assigneePersonId: ids.tam, dueDate: "2026-09-25" }, ids.long);
    await createWorkTask({ teamId: ids.video, projectId: ids.teamProject, title: "Two days late: no reminder today", assigneePersonId: ids.tam, dueDate: "2026-09-18" }, ids.long);

    expect(await sendWorkReminders("2026-09-20")).toEqual({ dueSoon: 2, overdue: 1, people: 2 });
    expect((await noticesOf(ids.huy, "tasks.due_soon")).map((row) => row.params)).toEqual([expect.objectContaining({ count: 2, title: "Colour grade" })]);
    expect((await noticesOf(ids.tam, "tasks.overdue")).map((row) => [row.params, row.link])).toEqual([[expect.objectContaining({ count: 1, title: "Subtitles", dueDate: "19/09/2026" }), expect.stringMatching(/^\/work\/tasks\//)]]);
    // A retry, or the second cron trigger of the day.
    expect(await sendWorkReminders("2026-09-20")).toEqual({ dueSoon: 0, overdue: 0, people: 0 });
    // Next day: the task two days late turns three days late and is due a reminder; finished work is left alone.
    const [subtitles] = await db().select().from(schema.task).where(and(eq(schema.task.title, "Subtitles")));
    const done = (await listStates([ids.video])).find((state) => state.category === "done")!;
    await updateWorkTask(subtitles.id, { stateId: done.id }, ids.tam);
    expect(await sendWorkReminders("2026-09-21")).toEqual({ dueSoon: 0, overdue: 1, people: 1 });
  });
});
