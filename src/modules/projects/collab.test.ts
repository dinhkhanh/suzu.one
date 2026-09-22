// Collaboration on a project against a real Postgres (PGlite): an issue becomes a task once and
// keeps the link; a meeting's decisions land in the log and its action items become tasks; open
// high risks and issues reach the status facts and the portfolio counts; and the project's
// document space is open to its people — members, lead, the team's leads — and closed to a
// colleague who may read the project but is not one of them, in every place the knowledge base
// shows a page: the space list, a page, the file list, search and the assistant's retrieval.
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
import { pageVisibleSql } from "../kb/access-sql";
import { retrieveKbChunks } from "../kb/chunks";
import { doc, heading, paragraph } from "../kb/engine/build";
import { listSpaceFiles } from "../kb/files";
import { levelOf, listTree, loadPage, publishPage, saveDraft } from "../kb/pages";
import { type KbViewer, viewerKeys } from "../kb/policy";
import { searchKb } from "../kb/search";
import { listSpaces, loadSpace } from "../kb/spaces";
import type { Principal } from "../platform/rbac/policy";
import { createProject, setProjectMember } from "../work/projects";
import { createTeam, setTeamMember } from "../work/teams";
import { ensureProjectSpace, getProjectDocuments, projectSpaceKey } from "./documents";
import { getMeeting, listMeetings, putMeetingInCalendar, removeMeetingFromCalendar, saveMeeting } from "./meetings";
import { loadRaidCounts, loadStatusFacts } from "./metrics";
import { ensurePlan } from "./plans";
import { issueToTask, listRaid, saveRaidItem, setRaidStatus } from "./raid-log";

type Who = "long" | "tam" | "huy" | "lan" | "khoi" | "other";
const ids = {} as Record<Who | "szm" | "team" | "otherTeam" | "project", string>;
const viewers = {} as Record<Who, KbViewer>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const today = "2026-10-20";
const blank = { description: null, ownerPersonId: null, dueDate: null, severity: null, decidedOn: null, evidenceUrl: null, evidenceFileId: null };

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const [unit] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  for (const key of ["long", "tam", "huy", "lan", "khoi", "other"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, orgUnitId: unit.id }).returning();
    ids[key] = row.id;
    const principal: Principal = { personId: row.id, workforceType: "employee", grants: [] };
    viewers[key] = { principal, personId: row.id, keys: viewerKeys(principal, { entityId: szm.id, unitId: unit.id, unitPath: [unit.id] }) };
  }
  // Long leads the Social team; Tam leads the project; Huy (in the team) and Lan (from outside it)
  // are its members. Khoi sits in the same unit and entity and — the project being open to the
  // entity — may read the project, but is not one of its people. "Other" leads another team.
  const team = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.team = team.id;
  for (const personId of [ids.tam, ids.huy]) await setTeamMember(team.id, personId, "member");
  ids.otherTeam = (await createTeam({ key: "DES", name: "Design", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.other)).id;
  const project = await createProject({ teamId: team.id, name: "TVC Tết 2027", description: null, clientId: null, status: "active", visibility: "entity", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.tam);
  ids.project = project.id;
  await setProjectMember(project.id, ids.huy, "member");
  await setProjectMember(project.id, ids.lan, "member");
  await ensurePlan(project.id);
});

describe("the RAID log (FR-PJM-29)", () => {
  it("checks each kind's fields and clears the ones a kind does not use", async () => {
    expect(await fails(saveRaidItem(ids.project, null, { ...blank, kind: "risk", title: "Mưa ngày quay" }, ids.huy, today))).toBe("raid_severity_required");
    expect(await fails(saveRaidItem(ids.project, null, { ...blank, kind: "decision", title: "Chốt KV B" }, ids.huy, today))).toBe("raid_decided_on_required");
    expect(await fails(saveRaidItem(ids.project, null, { ...blank, kind: "decision", title: "Chốt KV B", decidedOn: "2026-10-21" }, ids.huy, today))).toBe("raid_decided_in_future");
    expect(await fails(saveRaidItem(ids.project, null, { ...blank, kind: "issue", title: "x", severity: "low", ownerPersonId: ids.khoi }, ids.huy, today))).toBe("raid_owner_not_member");
    const { after } = await saveRaidItem(ids.project, null, { ...blank, kind: "assumption", title: "Khách gửi đủ hình trước 10/10", severity: "high", decidedOn: "2026-10-01" }, ids.huy, today);
    expect(after).toMatchObject({ kind: "assumption", severity: null, decidedOn: null, status: "open", createdByPersonId: ids.huy });
  });

  it("turns an open issue into a task of the project, once, and keeps the link", async () => {
    const { after: issue } = await saveRaidItem(ids.project, null, { ...blank, kind: "issue", title: "Diễn viên huỷ lịch quay", severity: "high", ownerPersonId: ids.huy, dueDate: "2026-10-25" }, ids.tam, today);
    const { item, taskId, key } = await issueToTask(issue.id, { assigneePersonId: null, dueDate: null }, ids.tam);
    expect(item.taskId).toBe(taskId);
    expect(key).toMatch(/^SOC-\d+$/);
    const [work] = await db().select({ projectId: schema.workTask.projectId, assignee: schema.task.assigneePersonId, dueDate: schema.task.dueDate, title: schema.task.title }).from(schema.workTask).innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId)).where(eq(schema.workTask.taskId, taskId));
    // To the item's owner, by the item's due date, in the project.
    expect(work).toEqual({ projectId: ids.project, assignee: ids.huy, dueDate: "2026-10-25", title: "Diễn viên huỷ lịch quay" });
    expect(await fails(issueToTask(issue.id, { assigneePersonId: null, dueDate: null }, ids.tam))).toBe("raid_not_convertible");
    const listed = (await listRaid(ids.project)).find((row) => row.id === issue.id)!;
    expect(listed.task).toMatchObject({ id: taskId, key, status: "todo" });
    // A risk is not a task in waiting.
    const { after: risk } = await saveRaidItem(ids.project, null, { ...blank, kind: "risk", title: "Mưa ngày quay", severity: "high" }, ids.huy, today);
    expect(await fails(issueToTask(risk.id, { assigneePersonId: null, dueDate: null }, ids.tam))).toBe("raid_not_convertible");
  });

  it("tells whoever an item is given to — once, and never the person doing the giving", async () => {
    const notices = async (personId: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, "projects.raid_assigned")));
    // An earlier item of this log already went to Huy, so it is the change that is counted here.
    const before = (await notices(ids.huy)).length;
    const { after } = await saveRaidItem(ids.project, null, { ...blank, kind: "risk", title: "Thiếu bối cảnh dự phòng", severity: "medium", ownerPersonId: ids.huy }, ids.tam, today);
    expect(await notices(ids.huy)).toHaveLength(before + 1);
    // Saving it again without moving it says nothing new.
    await saveRaidItem(ids.project, after.id, { ...blank, kind: "risk", title: "Thiếu bối cảnh dự phòng", severity: "high", ownerPersonId: ids.huy }, ids.tam, today);
    expect(await notices(ids.huy)).toHaveLength(before + 1);
    // Handing it on tells the new owner; taking it yourself tells nobody.
    await saveRaidItem(ids.project, after.id, { ...blank, kind: "risk", title: "Thiếu bối cảnh dự phòng", severity: "high", ownerPersonId: ids.lan }, ids.tam, today);
    const [notice] = await notices(ids.lan);
    expect(notice.params).toEqual({ project: "TVC Tết 2027", title: "Thiếu bối cảnh dự phòng" });
    await saveRaidItem(ids.project, after.id, { ...blank, kind: "risk", title: "Thiếu bối cảnh dự phòng", severity: "high", ownerPersonId: ids.tam }, ids.tam, today);
    expect(await notices(ids.tam)).toHaveLength(0);
    await setRaidStatus(after.id, "closed");
  });

  it("feeds open high risks and open issues to the status facts and the portfolio", async () => {
    const plan = await ensurePlan(ids.project);
    expect(await loadStatusFacts(ids.project, plan, today)).toMatchObject({ highRisks: 1, openIssues: 1 });
    const risk = (await listRaid(ids.project, { kind: "risk" }))[0];
    await setRaidStatus(risk.id, "closed");
    expect(await loadStatusFacts(ids.project, plan, today)).toMatchObject({ highRisks: 0, openIssues: 1 });
    expect((await loadRaidCounts([ids.project])).get(ids.project)).toEqual({ highRisks: 0, openIssues: 1 });
  });
});

describe("meetings (FR-PJM-30)", () => {
  const meeting = { kind: "client" as const, title: "Họp khách hàng tuần 42", heldOn: "2026-10-19", startTime: null as string | null, durationMinutes: null as number | null, attendeeIds: [] as string[], externalAttendees: "Chị Mai (Bibo)", agenda: "Duyệt kịch bản", notes: "Khách chọn KV B.", decisions: [] as { title: string; description: string | null }[], actionItems: [] as { title: string; assigneePersonId: string | null; dueDate: string | null }[] };

  it("takes attendees and assignees from the project's people only", async () => {
    expect(await fails(saveMeeting(ids.project, null, { ...meeting, attendeeIds: [ids.tam, ids.khoi] }, ids.tam, today))).toBe("meeting_attendee_not_member");
    expect(await fails(saveMeeting(ids.project, null, { ...meeting, actionItems: [{ title: "Gửi bản dựng", assigneePersonId: ids.khoi, dueDate: null }] }, ids.tam, today))).toBe("meeting_assignee_not_member");
    expect(await fails(saveMeeting(ids.project, null, { ...meeting, heldOn: "2026-10-22", decisions: [{ title: "x", description: null }] }, ids.tam, today))).toBe("meeting_decisions_before_held");
    expect(await fails(saveMeeting(ids.project, null, { ...meeting, actionItems: [{ title: "x", assigneePersonId: null, dueDate: "2026-10-18" }] }, ids.tam, today))).toBe("meeting_action_due_before");
  });

  it("records decisions in the log and action items as linked tasks, in one go", async () => {
    const { after, decisionIds, taskIds } = await saveMeeting(
      ids.project,
      null,
      {
        ...meeting,
        attendeeIds: [ids.tam, ids.huy, ids.lan],
        decisions: [
          { title: "Khách hàng chọn phương án KV B", description: "Qua email chị Mai 19/10" },
          { title: "Quay ngày 28/10", description: null },
        ],
        actionItems: [
          { title: "Chỉnh kịch bản theo KV B", assigneePersonId: ids.huy, dueDate: "2026-10-22" },
          { title: "Đặt studio", assigneePersonId: ids.lan, dueDate: null },
        ],
      },
      ids.tam,
      today,
    );
    expect([decisionIds.length, taskIds.length]).toEqual([2, 2]);
    const decisions = await listRaid(ids.project, { kind: "decision" });
    expect(decisions.filter((row) => row.meetingId === after.id).map((row) => [row.title, row.decidedOn, row.meeting?.title])).toEqual(
      expect.arrayContaining([
        ["Khách hàng chọn phương án KV B", "2026-10-19", "Họp khách hàng tuần 42"],
        ["Quay ngày 28/10", "2026-10-19", "Họp khách hàng tuần 42"],
      ]),
    );
    const links = await db().select().from(schema.projectMeetingTask).where(eq(schema.projectMeetingTask.meetingId, after.id));
    expect(links.map((row) => row.taskId).sort()).toEqual([...taskIds].sort());
    const tasks = await db().select({ projectId: schema.workTask.projectId }).from(schema.workTask).where(and(eq(schema.workTask.projectId, ids.project)));
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    const view = (await getMeeting(ids.project, after.id))!;
    expect(view.attendees.map((person) => person.fullName).sort()).toEqual(["huy", "lan", "tam"]);
    expect(view.actions.map((action) => [action.title, action.assigneeName, action.dueDate])).toEqual([
      ["Chỉnh kịch bản theo KV B", "huy", "2026-10-22"],
      ["Đặt studio", "lan", null],
    ]);
    expect(view.decisions).toHaveLength(2);
    // Each assignee heard about their task.
    const notices = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.huy), eq(schema.notification.kind, "tasks.work_assigned")));
    expect(notices.length).toBeGreaterThanOrEqual(1);

    // Adding to the meeting later adds, and never touches what it already made.
    const again = await saveMeeting(ids.project, after.id, { ...meeting, attendeeIds: [ids.tam], actionItems: [{ title: "Gửi lịch quay", assigneePersonId: ids.tam, dueDate: null }] }, ids.tam, today);
    expect(again.taskIds).toHaveLength(1);
    expect((await getMeeting(ids.project, after.id))!.actions).toHaveLength(3);
    const [listed] = await listMeetings(ids.project);
    expect(listed).toMatchObject({ id: after.id, decisions: 2, actionItems: 3, openActionItems: 3 });
    // Another project's meeting is not this project's to change.
    expect(await fails(saveMeeting(ids.otherTeam, after.id, meeting, ids.tam, today))).toBe("meeting_not_found");
  });

  it("keeps the hour, and drops a length nobody gave an hour to hang on", async () => {
    const { after } = await saveMeeting(ids.project, null, { ...meeting, startTime: "09:30", durationMinutes: 90 }, ids.tam, today);
    expect(after).toMatchObject({ startTime: "09:30:00", durationMinutes: 90 });
    const cleared = await saveMeeting(ids.project, after.id, { ...meeting, startTime: null, durationMinutes: 90 }, ids.tam, today);
    expect(cleared.after).toMatchObject({ startTime: null, durationMinutes: null });
  });

  it("puts a meeting with an hour in the calendar, says out loud that nothing was sent, and takes it out again", async () => {
    const { after } = await saveMeeting(ids.project, null, { ...meeting, startTime: "14:00", durationMinutes: 60, attendeeIds: [ids.tam, ids.huy] }, ids.tam, today);
    // With no service account the local driver runs: the event is ours alone and the row says so.
    const put = await putMeetingInCalendar(ids.project, after.id);
    expect(put.delivery).toMatchObject({ driver: "local", status: "simulated" });
    expect(put.meeting).toMatchObject({ calendarDriver: "local", calendarStatus: "simulated", calendarEventId: null, calendarError: null });
    // Nothing to take out of a calendar that never took it, and never another project's meeting.
    expect(await fails(removeMeetingFromCalendar(ids.project, after.id))).toBe("meeting_not_in_calendar");
    expect(await fails(putMeetingInCalendar(ids.otherTeam, after.id))).toBe("meeting_not_found");
    // A meeting nobody put an hour on has no event to make.
    const { after: undated } = await saveMeeting(ids.project, null, meeting, ids.tam, today);
    expect(await fails(putMeetingInCalendar(ids.project, undated.id))).toBe("meeting_time_required");

    // Once an event does exist — pretend Google answered — the meeting can be taken out of the calendar.
    await db().update(schema.projectMeeting).set({ calendarEventId: "evt-1", calendarStatus: "sent", calendarDriver: "google", meetingUrl: "https://meet.google.com/abc-defg-hij" }).where(eq(schema.projectMeeting.id, after.id));
    const removed = await removeMeetingFromCalendar(ids.project, after.id);
    expect(removed.meeting).toMatchObject({ calendarEventId: null, meetingUrl: null, calendarStatus: "simulated" });
  });
});

describe("the project's document space (FR-PJM-31)", () => {
  let spaceId = "";
  let pageId = "";

  beforeAll(async () => {
    const made = await ensureProjectSpace(ids.project, ids.tam);
    expect(made).toMatchObject({ created: true, pages: 4 });
    spaceId = made.spaceId;
    // Once: a second request links the same space.
    expect(await ensureProjectSpace(ids.project, ids.huy)).toEqual({ spaceId, created: false, pages: 0 });
    const space = (await loadSpace({ id: spaceId }))!;
    expect(space.space).toMatchObject({ key: projectSpaceKey(ids.project), entityId: ids.szm, kind: "open" });
    expect(space.access.map((row) => [row.subjectKey, row.level])).toEqual([[`project:${ids.project}`, "edit"]]);
    // The brief starter, filled in and published; a file uploaded to it.
    const tree = await listTree(viewers.tam, space);
    pageId = tree[0].id;
    await saveDraft(pageId, { title: "Brief TVC Tết", content: doc(heading(1, "Brief"), paragraph("Bối cảnh quay tại Ngũ Hành Sơn, tông màu đỏ vàng.")) }, { personId: ids.tam });
    await publishPage(pageId, { personId: ids.tam });
    await db().insert(schema.storedFile).values({ bucket: "test", objectPath: `kb_page/${pageId}/kv.pdf`, fileName: "kv-option-b.pdf", contentType: "application/pdf", sizeBytes: 2048, ownerType: "kb_page", ownerId: pageId, entityId: ids.szm, tier: "public_internal", status: "ready", uploadedByPersonId: ids.tam });
  });

  it("makes the starter pages as drafts for the team", async () => {
    const tree = await listTree(viewers.huy, (await loadSpace({ id: spaceId }))!);
    expect(tree.map((node) => node.title)).toEqual(["Brief TVC Tết", "Kịch bản video", "Danh sách cảnh quay (shot list)", "Biên bản họp"]);
  });

  it("is open to the project's members, its lead and the team's lead — and nobody else", async () => {
    const people: Who[] = ["tam", "huy", "lan", "long"];
    const strangers: Who[] = ["khoi", "other"];
    for (const who of people) {
      const viewer = viewers[who];
      expect((await listSpaces(viewer)).find((space) => space.id === spaceId)?.level, who).toBe("edit");
      expect(levelOf(viewer, (await loadPage(pageId))!), who).toBe("edit");
      expect((await listSpaceFiles(viewer, spaceId)).map((file) => file.fileName), who).toEqual(["kv-option-b.pdf"]);
      expect((await searchKb(viewer, { query: "Ngũ Hành Sơn" })).hits.map((hit) => hit.pageId), who).toEqual([pageId]);
      expect((await retrieveKbChunks(viewer, { query: "Ngũ Hành Sơn" })).map((chunk) => chunk.pageId), who).toContain(pageId);
      expect((await getProjectDocuments(viewer, spaceId))?.files, who).toHaveLength(1);
    }
    for (const who of strangers) {
      const viewer = viewers[who];
      expect((await listSpaces(viewer)).some((space) => space.id === spaceId), who).toBe(false);
      expect(levelOf(viewer, (await loadPage(pageId))!), who).toBeNull();
      expect(await listSpaceFiles(viewer, spaceId), who).toEqual([]);
      expect((await searchKb(viewer, { query: "Ngũ Hành Sơn" })).hits, who).toEqual([]);
      expect(await retrieveKbChunks(viewer, { query: "Ngũ Hành Sơn" }), who).toEqual([]);
      expect(await getProjectDocuments(viewer, spaceId), who).toBeNull();
    }
  });

  it("stays closed to HR's knowledge-base managers and the owner, who are not the project's people", async () => {
    for (const role of ["hr_admin", "owner"] as const) {
      const principal: Principal = { personId: ids.other, workforceType: "employee", grants: [{ role, scope: { type: "group" } }] };
      const manager = { ...viewers.other, principal };
      expect((await listSpaces(manager)).some((space) => space.id === spaceId), role).toBe(false);
      expect(levelOf(manager, (await loadPage(pageId))!), role).toBeNull();
      expect(await listSpaceFiles(manager, spaceId), role).toEqual([]);
      expect((await searchKb(manager, { query: "Ngũ Hành Sơn" })).hits, role).toEqual([]);
      expect(await retrieveKbChunks(manager, { query: "Ngũ Hành Sơn" }), role).toEqual([]);
    }
  });

  it("follows the project's membership as it changes, and the SQL filter agrees with the policy", async () => {
    await setProjectMember(ids.project, ids.lan, null);
    await setProjectMember(ids.project, ids.khoi, "viewer");
    expect(levelOf(viewers.lan, (await loadPage(pageId))!)).toBeNull();
    expect(await listSpaceFiles(viewers.lan, spaceId)).toEqual([]);
    expect(levelOf(viewers.khoi, (await loadPage(pageId))!)).toBe("edit");
    const pages = await db().select({ id: schema.kbPage.id }).from(schema.kbPage).where(eq(schema.kbPage.spaceId, spaceId));
    for (const who of Object.keys(viewers) as Who[]) {
      const bySql = new Set((await db().select({ id: schema.kbPage.id }).from(schema.kbPage).innerJoin(schema.kbSpace, eq(schema.kbSpace.id, schema.kbPage.spaceId)).where(pageVisibleSql(viewers[who]))).map((row) => row.id));
      for (const { id } of pages) expect(bySql.has(id), `${who} → ${id}`).toBe(levelOf(viewers[who], (await loadPage(id))!) !== null);
    }
  });
});
