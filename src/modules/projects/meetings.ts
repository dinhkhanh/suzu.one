// Meeting notes of a project (FR-PJM-30): kick-off, weekly, client meetings — date, attendees from
// the project's people plus outside guests as text, agenda, notes. What was decided becomes a
// decision in the RAID log, dated by the meeting and linked to it; what has to be done becomes a
// task in the project, made by the work module and linked through `project_meeting_task`. Written
// in one transaction: a meeting is never saved with half its action items.
//
// A meeting given an hour can also be put in the company calendar through the platform's adapter
// (`platform/calendar`): the event is created, updated when the meeting changes and cancelled when
// it is taken out again. With no service account the adapter records `simulated` and the page says
// so — the notes are the meeting, an invitation is a convenience on top of them.
//
// The retrospective is a meeting of kind "retro" too, but it is held on the close-out page
// (`close.ts`), once per project; here it is only listed.
import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { TIME_ZONE } from "@/i18n/config";
import { type CalendarDelivery, putInCalendar, removeFromCalendar } from "../platform/calendar/service";
import { createWorkTaskIn, listAssignable, taskKey } from "../work/service";
import { type ActionItem, type MeetingKind, meetingProblems, meetingWindow, normaliseMeetingTime } from "./engine/raid";
import { listRaid, type RaidView } from "./raid-log";

export type MeetingRow = typeof schema.projectMeeting.$inferSelect;

export type MeetingInput = {
  kind: Exclude<MeetingKind, "retro">;
  title: string;
  heldOn: IsoDate;
  /** Vietnam-local "HH:MM", and how long it runs. Optional: notes are often written up afterwards. */
  startTime: string | null;
  durationMinutes: number | null;
  attendeeIds: string[];
  externalAttendees: string | null;
  agenda: string | null;
  notes: string | null;
  /** New decisions taken at the meeting; each becomes a decision item of the log. */
  decisions: { title: string; description: string | null }[];
  /** New action items; each becomes a task in the project. */
  actionItems: ActionItem[];
};

export const findMeeting = async (meetingId: string): Promise<MeetingRow | undefined> => (await db().select().from(schema.projectMeeting).where(eq(schema.projectMeeting.id, meetingId)).limit(1))[0];

/** The project's people, as the attendee and assignee pickers offer them: its members and its team's. */
export async function meetingPeople(projectId: string): Promise<{ id: string; fullName: string }[]> {
  const [project] = await db().select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  return project ? listAssignable(project.teamId, projectId) : [];
}

/**
 * Records a meeting, or adds to one of this project's: the fields are replaced, the decisions and
 * action items given are added (the ones made before live on in the log and on the board).
 */
export async function saveMeeting(projectId: string, meetingId: string | null, input: MeetingInput, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ before: MeetingRow | null; after: MeetingRow; decisionIds: string[]; taskIds: string[] }> {
  const before = meetingId ? ((await findMeeting(meetingId)) ?? null) : null;
  if (meetingId && (!before || before.projectId !== projectId || before.kind === "retro")) throw new ActionError("meeting_not_found");
  const people = await meetingPeople(projectId);
  const attendeeIds = [...new Set(input.attendeeIds)];
  // An attendee who has since left the project stays on the notes they were in.
  const known = new Set([...people.map((person) => person.id), ...(before?.attendeeIds ?? [])]);
  const values = normaliseMeetingTime({ ...input, attendeeIds });
  const [problem] = meetingProblems(values, { today, people: known });
  if (problem) throw new ActionError(problem);
  // Assignees must be people of the project now, not merely people who once attended.
  const current = new Set(people.map((person) => person.id));
  if (input.actionItems.some((item) => item.assigneePersonId && !current.has(item.assigneePersonId))) throw new ActionError("meeting_assignee_not_member");
  const [project] = await db().select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project) throw new ActionError("project_not_found");

  const fields = { kind: input.kind, title: input.title.trim(), heldOn: input.heldOn, startTime: values.startTime, durationMinutes: values.durationMinutes, attendeeIds, externalAttendees: input.externalAttendees, agenda: input.agenda, notes: input.notes };
  return db().transaction(async (tx) => {
    const [after] = before
      ? await tx.update(schema.projectMeeting).set({ ...fields, updatedAt: new Date() }).where(eq(schema.projectMeeting.id, before.id)).returning()
      : await tx.insert(schema.projectMeeting).values({ projectId, ...fields, createdByPersonId: actorPersonId }).returning();
    const decisions = input.decisions.length
      ? await tx
          .insert(schema.projectRaidItem)
          .values(input.decisions.map((decision) => ({ projectId, kind: "decision", title: decision.title.trim(), description: decision.description, decidedOn: input.heldOn, meetingId: after.id, createdByPersonId: actorPersonId })))
          .returning({ id: schema.projectRaidItem.id })
      : [];
    const taskIds: string[] = [];
    for (const item of input.actionItems) {
      const { task } = await createWorkTaskIn(tx, { teamId: project.teamId, projectId, title: item.title.trim(), assigneePersonId: item.assigneePersonId, dueDate: item.dueDate }, actorPersonId);
      taskIds.push(task.id);
    }
    if (taskIds.length) await tx.insert(schema.projectMeetingTask).values(taskIds.map((taskId) => ({ meetingId: after.id, taskId })));
    return { before, after, decisionIds: decisions.map((row) => row.id), taskIds };
  });
}

// ── The calendar invitation (FR-PJM-30) ─────────────────────────────────────────────────────

/** Stable across changes, so the calendar updates one event rather than collecting copies of it. */
const uidFor = (meetingId: string): string => `project-meeting-${meetingId}@suzu.one`;

const meetingLink = (projectId: string, meetingId: string): string => `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/projects/${projectId}/meetings/${meetingId}`;

/**
 * The event a meeting is worth: its title with the project's, the hour it was given, the people on
 * the notes who have a work address, and an agenda with a link back to the page the notes live on.
 * Nothing commercial: an invitation is read on a phone, on a train, by whoever glances over.
 */
async function eventFor(meeting: MeetingRow): Promise<Parameters<typeof putInCalendar>[0]> {
  const window = meetingWindow(meeting);
  if (!window) throw new ActionError("meeting_time_required");
  const [project] = await db().select({ name: schema.workProject.name }).from(schema.workProject).where(eq(schema.workProject.id, meeting.projectId)).limit(1);
  if (!project) throw new ActionError("project_not_found");
  const attendees = meeting.attendeeIds.length
    ? await db()
        .select({ fullName: schema.person.fullName, workEmail: schema.person.workEmail })
        .from(schema.person)
        .where(and(inArray(schema.person.id, meeting.attendeeIds), sql`${schema.person.workEmail} is not null`, sql`${schema.person.status} <> 'offboarded'`))
        .orderBy(asc(schema.person.searchName))
    : [];
  const link = meetingLink(meeting.projectId, meeting.id);
  return {
    uid: uidFor(meeting.id),
    summary: `${meeting.title} — ${project.name}`,
    description: [meeting.agenda, link].filter(Boolean).join("\n\n"),
    location: null,
    start: window.start,
    end: window.end,
    timeZone: TIME_ZONE,
    attendees: attendees.map((person) => ({ email: person.workEmail!, name: person.fullName })),
    // A project meeting is a call unless somebody says otherwise; ask for the Meet link once.
    wantsMeeting: !meeting.meetingUrl,
  };
}

/** What the calendar did, written back on the meeting so the page can say what really happened. */
async function recordDelivery(meetingId: string, delivery: CalendarDelivery): Promise<MeetingRow> {
  const [after] = await db()
    .update(schema.projectMeeting)
    .set({
      calendarEventId: delivery.eventId,
      calendarDriver: delivery.driver,
      calendarStatus: delivery.status,
      calendarError: delivery.error,
      // A Meet link, once given, survives a push that brought none back.
      ...(delivery.meetingUrl ? { meetingUrl: delivery.meetingUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.projectMeeting.id, meetingId))
    .returning();
  return after;
}

/**
 * Puts the meeting in the company calendar, or rewrites the event it already has. The push happens
 * outside any transaction — it is a network call, and a calendar that is down must not lose notes
 * everybody has already agreed to — and its outcome is stored, `simulated` included.
 */
export async function putMeetingInCalendar(projectId: string, meetingId: string): Promise<{ meeting: MeetingRow; delivery: CalendarDelivery }> {
  const meeting = await findMeeting(meetingId);
  if (!meeting || meeting.projectId !== projectId || meeting.kind === "retro") throw new ActionError("meeting_not_found");
  const delivery = await putInCalendar(await eventFor(meeting), meeting.calendarEventId);
  return { meeting: await recordDelivery(meeting.id, delivery), delivery };
}

/** Calls the event off — the meeting is not happening, or its notes are leaving the calendar. */
export async function removeMeetingFromCalendar(projectId: string, meetingId: string): Promise<{ meeting: MeetingRow; delivery: CalendarDelivery }> {
  const meeting = await findMeeting(meetingId);
  if (!meeting || meeting.projectId !== projectId) throw new ActionError("meeting_not_found");
  if (!meeting.calendarEventId) throw new ActionError("meeting_not_in_calendar");
  const delivery = await removeFromCalendar(meeting.calendarEventId);
  // The Meet link belonged to the event that has just been called off.
  const [after] = await db().update(schema.projectMeeting).set({ calendarEventId: null, calendarDriver: delivery.driver, calendarStatus: delivery.status, calendarError: delivery.error, meetingUrl: null, updatedAt: new Date() }).where(eq(schema.projectMeeting.id, meeting.id)).returning();
  return { meeting: after, delivery };
}

export type MeetingListItem = MeetingRow & { authorName: string | null; decisions: number; actionItems: number; openActionItems: number };

/** Newest first, with how many decisions and action items each gave. The caller has checked the viewer may read the project. */
export async function listMeetings(projectId: string): Promise<MeetingListItem[]> {
  const meeting = schema.projectMeeting;
  return db()
    .select({
      meeting,
      authorName: schema.person.fullName,
      decisions: sql<number>`(select count(*)::int from ${schema.projectRaidItem} where ${schema.projectRaidItem.meetingId} = ${meeting.id})`,
      actionItems: sql<number>`(select count(*)::int from ${schema.projectMeetingTask} mt inner join ${schema.task} t on t.id = mt.task_id where mt.meeting_id = ${meeting.id} and t.deleted_at is null)`,
      openActionItems: sql<number>`(select count(*)::int from ${schema.projectMeetingTask} mt inner join ${schema.task} t on t.id = mt.task_id where mt.meeting_id = ${meeting.id} and t.deleted_at is null and t.status in ('todo', 'in_progress'))`,
    })
    .from(meeting)
    .leftJoin(schema.person, eq(schema.person.id, meeting.createdByPersonId))
    .where(eq(meeting.projectId, projectId))
    .orderBy(desc(meeting.heldOn), desc(meeting.createdAt))
    .then((rows) => rows.map((row) => ({ ...row.meeting, authorName: row.authorName, decisions: row.decisions, actionItems: row.actionItems, openActionItems: row.openActionItems })));
}

export type MeetingActionView = { taskId: string; key: string; title: string; status: string; assigneeName: string | null; dueDate: IsoDate | null };
export type MeetingView = MeetingRow & { authorName: string | null; attendees: { id: string; fullName: string }[]; decisions: RaidView[]; actions: MeetingActionView[] };

/** One meeting of the project with its people, decisions and action items. null = not this project's. */
export async function getMeeting(projectId: string, meetingId: string): Promise<MeetingView | null> {
  const meeting = await findMeeting(meetingId);
  if (!meeting || meeting.projectId !== projectId) return null;
  const assignee = schema.person;
  const [attendees, author, decisions, actions] = await Promise.all([
    meeting.attendeeIds.length ? db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, meeting.attendeeIds)).orderBy(asc(schema.person.searchName)) : Promise.resolve([]),
    meeting.createdByPersonId ? db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, meeting.createdByPersonId)).limit(1) : Promise.resolve([]),
    listRaid(projectId, { meetingId }),
    db()
      .select({ taskId: schema.task.id, title: schema.task.title, status: schema.task.status, dueDate: schema.task.dueDate, number: schema.workTask.number, teamKey: schema.workTeam.key, assigneeName: assignee.fullName })
      .from(schema.projectMeetingTask)
      .innerJoin(schema.task, eq(schema.task.id, schema.projectMeetingTask.taskId))
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .leftJoin(assignee, eq(assignee.id, schema.task.assigneePersonId))
      .where(and(eq(schema.projectMeetingTask.meetingId, meetingId), sql`${schema.task.deletedAt} is null`))
      .orderBy(asc(schema.workTask.number)),
  ]);
  return {
    ...meeting,
    authorName: author[0]?.fullName ?? null,
    attendees,
    decisions,
    actions: actions.map((row) => ({ taskId: row.taskId, key: taskKey(row.teamKey, row.number), title: row.title, status: row.status, assigneeName: row.assigneeName, dueDate: row.dueDate })),
  };
}
