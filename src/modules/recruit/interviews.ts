import "server-only";
// Interview scheduling and scorecards (FR-REC-06).
//
// Two things in this file carry the weight.
//
// **Scheduling runs on internal data.** Google Calendar is not available — no keys, and the
// incremental OAuth scopes were never set up — so the `interview` row is the schedule, `calendar.ts`
// is an adapter that may also push it to Google when somebody configures one, and `engine/ics.ts`
// hands every participant a file their own calendar reads. Nothing here depends on an integration
// existing, which is why it works today.
//
// **Blind feedback is enforced here, not on a page.** FR-REC-06 says an interviewer's feedback is
// hidden from the other interviewers until they have submitted their own. `scorecardsFor` below is
// the only way to read a scorecard, and it will not return anybody else's to an interviewer who has
// not submitted theirs. A rule that lived in a component would be a rule that a hand-posted request
// walks past; the test for it calls this function.
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { TIME_ZONE } from "@/i18n/config";
import { getLeaveOnDays } from "@/modules/leave/service";
import { notify } from "@/modules/platform/notifications/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { calendarDriver, type CalendarResult } from "./calendar";
import {
  DEFAULT_INTERVIEW_KIT,
  INTERVIEW_CLOSED,
  type InterviewKind,
  type InterviewMode,
  type InterviewRecommendation,
  type InterviewStatus,
  SCORE_MAX,
  SCORE_MIN,
  type ScorecardCriterion,
} from "./enums";
import { type BusyBlock, clashesWith, daysTouched, schedulingProblems } from "./engine/schedule";
import { icsFileName, renderIcs } from "./engine/ics";
import { canScheduleInterview, canScoreInterview, canViewInterview, type OpeningTarget } from "./policy";
import { findApplication, findCandidate, findOpening, isOpeningMember, recordApplicationEvent, stagesOf } from "./service";

type Executor = Tx | ReturnType<typeof db>;

export type InterviewRow = typeof schema.interview.$inferSelect;
export type ScorecardRow = typeof schema.interviewScorecard.$inferSelect;

const now = () => new Date();
const targetOf = (opening: { entityId: string; departmentId: string | null; teamId: string | null }): OpeningTarget => ({
  entityId: opening.entityId,
  departmentId: opening.departmentId,
  teamId: opening.teamId,
});

// ── Reading one interview ───────────────────────────────────────────────────────────────────

export async function findInterview(interviewId: string, executor: Executor = db()): Promise<InterviewRow | undefined> {
  const [row] = await executor.select().from(schema.interview).where(eq(schema.interview.id, interviewId)).limit(1);
  return row;
}

/**
 * Does "My interviews" belong in this person's navigation? True for anybody who has ever been in
 * the room — which is a row, not a role, so the layout has to ask. Cosmetic: the page re-checks,
 * and it only ever shows interviews this person is on.
 */
export async function interviewsModuleOpen(personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const [row] = await db().select({ id: schema.interviewInterviewer.id }).from(schema.interviewInterviewer).where(eq(schema.interviewInterviewer.personId, personId)).limit(1);
  return !!row;
}

/** Is this person in the room? The one fact `policy.ts` cannot work out for itself. */
export async function isInterviewer(interviewId: string, personId: string | null, executor: Executor = db()): Promise<boolean> {
  if (!personId) return false;
  const [row] = await executor
    .select({ id: schema.interviewInterviewer.id })
    .from(schema.interviewInterviewer)
    .where(and(eq(schema.interviewInterviewer.interviewId, interviewId), eq(schema.interviewInterviewer.personId, personId)))
    .limit(1);
  return !!row;
}

/** Is this person interviewing anywhere on this application? Decides who may open its CV. */
export async function isInterviewerOnApplication(applicationId: string, personId: string | null, executor: Executor = db()): Promise<boolean> {
  if (!personId) return false;
  const [row] = await executor
    .select({ id: schema.interviewInterviewer.id })
    .from(schema.interviewInterviewer)
    .innerJoin(schema.interview, eq(schema.interview.id, schema.interviewInterviewer.interviewId))
    .where(and(eq(schema.interview.applicationId, applicationId), eq(schema.interviewInterviewer.personId, personId)))
    .limit(1);
  return !!row;
}

export type InterviewerRow = { personId: string; fullName: string; isLead: boolean; workEmail: string | null };

async function interviewersOf(interviewIds: readonly string[], executor: Executor = db()): Promise<Map<string, InterviewerRow[]>> {
  if (interviewIds.length === 0) return new Map();
  const rows = await executor
    .select({
      interviewId: schema.interviewInterviewer.interviewId,
      personId: schema.person.id,
      fullName: schema.person.fullName,
      workEmail: schema.person.workEmail,
      isLead: schema.interviewInterviewer.isLead,
    })
    .from(schema.interviewInterviewer)
    .innerJoin(schema.person, eq(schema.person.id, schema.interviewInterviewer.personId))
    .where(inArray(schema.interviewInterviewer.interviewId, [...interviewIds]))
    .orderBy(desc(schema.interviewInterviewer.isLead), asc(schema.person.fullName));

  const byInterview = new Map<string, InterviewerRow[]>();
  for (const row of rows) {
    const list = byInterview.get(row.interviewId) ?? [];
    list.push({ personId: row.personId, fullName: row.fullName, isLead: row.isLead, workEmail: row.workEmail });
    byInterview.set(row.interviewId, list);
  }
  return byInterview;
}

export type InterviewView = {
  interview: InterviewRow;
  interviewers: InterviewerRow[];
  candidateName: string;
  candidateId: string;
  applicationId: string;
  openingId: string;
  openingTitle: string;
  openingCode: string;
  stageName: string | null;
  /** The CV behind this conversation, for the interviewer who is about to have it. */
  cvFileId: string | null;
  canSchedule: boolean;
  amInterviewing: boolean;
};

export async function getInterviewView(viewer: { principal: Principal; personId: string | null }, interviewId: string): Promise<InterviewView | null> {
  const interview = await findInterview(interviewId);
  if (!interview) return null;
  const opening = await findOpening(interview.openingId);
  const application = await findApplication(interview.applicationId);
  if (!opening || !application) return null;

  const [member, interviewing] = await Promise.all([isOpeningMember(opening.id, viewer.personId), isInterviewer(interviewId, viewer.personId)]);
  const target = targetOf(opening);
  if (!canViewInterview(viewer.principal, target, member, interviewing)) return null;

  const candidate = await findCandidate(application.candidateId);
  if (!candidate) return null;
  const stage = interview.stageId ? (await stagesOf(opening.pipelineId)).find((row) => row.id === interview.stageId) : undefined;

  return {
    interview,
    interviewers: (await interviewersOf([interviewId])).get(interviewId) ?? [],
    candidateName: candidate.fullName,
    candidateId: candidate.id,
    applicationId: application.id,
    openingId: opening.id,
    openingTitle: opening.title,
    openingCode: opening.code,
    stageName: stage?.name ?? null,
    cvFileId: application.cvFileId,
    canSchedule: canScheduleInterview(viewer.principal, target, member),
    amInterviewing: interviewing,
  };
}

export type InterviewListRow = {
  id: string;
  title: string;
  kind: InterviewKind;
  mode: InterviewMode;
  status: InterviewStatus;
  startAt: Date;
  endAt: Date;
  location: string | null;
  meetingUrl: string | null;
  interviewers: InterviewerRow[];
};

/** Every interview on one application — the panel on its page. The caller has already been checked. */
export async function listInterviewsOfApplication(applicationId: string, executor: Executor = db()): Promise<InterviewListRow[]> {
  const rows = await executor.select().from(schema.interview).where(eq(schema.interview.applicationId, applicationId)).orderBy(asc(schema.interview.startAt));
  const byInterview = await interviewersOf(
    rows.map((row) => row.id),
    executor,
  );
  return rows.map((row) => ({ ...row, interviewers: byInterview.get(row.id) ?? [] }));
}

export type MyInterviewRow = InterviewListRow & {
  candidateName: string;
  openingTitle: string;
  applicationId: string;
  /** Have I filled mine in? The only thing "my interviews" really needs to nag about. */
  scorecardSubmitted: boolean;
  /**
   * Still ahead of me. Decided by the **database's** clock: a server component may not call
   * `Date.now()` (`react-hooks/purity`), and a page that split the list itself would be a page
   * that does.
   */
  upcoming: boolean;
};

/**
 * What I am interviewing, past and future. This is the list an interviewer who is on no hiring team
 * has — the whole of their access to recruitment — so it is keyed on `interview_interviewer` and
 * nothing else.
 */
export async function listMyInterviews(personId: string, options: { limit?: number } = {}): Promise<MyInterviewRow[]> {
  const rows = await db()
    .select({
      interview: schema.interview,
      candidateName: schema.candidate.fullName,
      openingTitle: schema.jobOpening.title,
      applicationId: schema.jobApplication.id,
      submittedAt: schema.interviewScorecard.submittedAt,
      upcoming: sql<boolean>`(${schema.interview.status} = 'scheduled' and ${schema.interview.endAt} >= now())`,
    })
    .from(schema.interviewInterviewer)
    .innerJoin(schema.interview, eq(schema.interview.id, schema.interviewInterviewer.interviewId))
    .innerJoin(schema.jobApplication, eq(schema.jobApplication.id, schema.interview.applicationId))
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.jobApplication.candidateId))
    .innerJoin(schema.jobOpening, eq(schema.jobOpening.id, schema.interview.openingId))
    .leftJoin(
      schema.interviewScorecard,
      and(eq(schema.interviewScorecard.interviewId, schema.interview.id), eq(schema.interviewScorecard.interviewerPersonId, personId)),
    )
    .where(eq(schema.interviewInterviewer.personId, personId))
    .orderBy(desc(schema.interview.startAt))
    .limit(options.limit ?? 100);

  const byInterview = await interviewersOf(rows.map((row) => row.interview.id));
  return rows.map((row) => ({
    ...row.interview,
    interviewers: byInterview.get(row.interview.id) ?? [],
    candidateName: row.candidateName,
    openingTitle: row.openingTitle,
    applicationId: row.applicationId,
    scorecardSubmitted: !!row.submittedAt,
    upcoming: row.upcoming,
  }));
}

// ── Availability ────────────────────────────────────────────────────────────────────────────

export type AvailabilityRow = {
  personId: string;
  fullName: string;
  /** Other interviews this person is already in, in the window asked about. */
  busy: BusyBlock[];
  /**
   * Days they are on approved leave. **A day, not a reason**: `leave/service.ts` knows the type and
   * this deliberately throws it away — a recruiter needs to know somebody is away, not why.
   */
  awayDays: string[];
};

/**
 * Who can actually be in the room. Built from two internal sources and no external one: this
 * module's own interviews, and the leave module's approved days through its published entry point
 * (never its tables). There is no free/busy feed to consult, so what this cannot see — a meeting in
 * somebody's personal calendar — it does not pretend to.
 */
export async function interviewerAvailability(personIds: readonly string[], window: { from: Date; to: Date }, executor: Executor = db()): Promise<AvailabilityRow[]> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return [];

  const people = await executor.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, ids));

  const busyRows = await executor
    .select({
      personId: schema.interviewInterviewer.personId,
      interviewId: schema.interview.id,
      title: schema.interview.title,
      startAt: schema.interview.startAt,
      endAt: schema.interview.endAt,
    })
    .from(schema.interviewInterviewer)
    .innerJoin(schema.interview, eq(schema.interview.id, schema.interviewInterviewer.interviewId))
    .where(
      and(
        inArray(schema.interviewInterviewer.personId, ids),
        ne(schema.interview.status, "cancelled"),
        lte(schema.interview.startAt, window.to),
        gte(schema.interview.endAt, window.from),
      ),
    )
    .orderBy(asc(schema.interview.startAt));

  const days = daysTouched({ startAt: window.from, endAt: window.to }, TIME_ZONE);
  const leave = await getLeaveOnDays(ids, days[0], days[days.length - 1], executor);

  return people.map((person) => ({
    personId: person.id,
    fullName: person.fullName,
    busy: busyRows.filter((row) => row.personId === person.id).map((row) => ({ interviewId: row.interviewId, title: row.title, startAt: row.startAt, endAt: row.endAt })),
    // Only the date survives. See the note on the type.
    awayDays: [...new Set(leave.filter((row) => row.personId === person.id).map((row) => row.date))].sort(),
  }));
}

/**
 * Which of a proposed slot's interviewers are already booked. A clash is **shown, never refused**:
 * a recruiter may be moving one of the two, or may know the other is about to be cancelled, and a
 * system that refuses a booking it does not understand is a system people book around.
 */
export async function clashesFor(
  personIds: readonly string[],
  window: { from: Date; to: Date },
  exceptInterviewId?: string,
): Promise<{ personId: string; fullName: string; clashes: BusyBlock[] }[]> {
  const availability = await interviewerAvailability(personIds, window);
  return availability
    .map((row) => ({ personId: row.personId, fullName: row.fullName, clashes: clashesWith({ startAt: window.from, endAt: window.to }, row.busy, exceptInterviewId) }))
    .filter((row) => row.clashes.length > 0);
}

/**
 * Who the schedule form offers as an interviewer: this opening's hiring team, and the active staff
 * of the department it is hiring into. Not the whole company — a picker of four hundred names is a
 * picker nobody reads — and the list is built on the server, so it is also the set the form can
 * post from without the action having to trust it (the action re-checks the scheduler's right to
 * schedule, and an unknown person id simply fails the foreign key).
 */
export async function interviewerOptions(openingId: string): Promise<{ personId: string; fullName: string }[]> {
  const opening = await findOpening(openingId);
  if (!opening) return [];
  const rows = await db()
    .select({ personId: schema.person.id, fullName: schema.person.fullName })
    .from(schema.person)
    .where(
      and(
        ne(schema.person.status, "offboarded"),
        opening.departmentId
          ? sql`(${schema.person.departmentId} = ${opening.departmentId} or exists (select 1 from ${schema.jobOpeningMember} m where m.opening_id = ${openingId} and m.person_id = ${schema.person.id}))`
          : eq(schema.person.primaryEntityId, opening.entityId),
      ),
    )
    .orderBy(asc(schema.person.fullName))
    .limit(100);
  return rows;
}

// ── Scheduling ──────────────────────────────────────────────────────────────────────────────

export type InterviewInput = {
  applicationId: string;
  stageId: string | null;
  kind: InterviewKind;
  title: string;
  startAt: Date;
  endAt: Date;
  mode: InterviewMode;
  location: string | null;
  meetingUrl: string | null;
  notesForCandidate: string | null;
  interviewerPersonIds: string[];
};

/** The kit this interview will ask for: the opening's, or the module's default when it has none. */
const kitFor = (opening: { interviewKit: ScorecardCriterion[] }): ScorecardCriterion[] => (opening.interviewKit.length > 0 ? opening.interviewKit : [...DEFAULT_INTERVIEW_KIT]);

/** Stable across reschedules, so a calendar updates the event rather than adding a second one. */
const uidFor = (interviewId: string): string => `interview-${interviewId}@suzu.one`;

async function pushToCalendar(interview: InterviewRow, interviewers: InterviewerRow[], candidateName: string, openingTitle: string): Promise<CalendarResult> {
  const driver = calendarDriver();
  return driver.create({
    uid: uidFor(interview.id),
    summary: `${interview.title} — ${candidateName}`,
    // Never a figure and never the CV: a calendar entry is read on a phone on a train.
    description: `${openingTitle}\n${interview.notesForCandidate ?? ""}`.trim(),
    location: interview.location,
    start: interview.startAt,
    end: interview.endAt,
    timeZone: TIME_ZONE,
    attendees: interviewers.filter((row) => row.workEmail).map((row) => ({ email: row.workEmail!, name: row.fullName })),
    wantsMeeting: interview.mode === "video" && !interview.meetingUrl,
  });
}

function checkDraft(input: { startAt: Date; endAt: Date; interviewerPersonIds: readonly string[] }): void {
  const problems = schedulingProblems(input, now());
  if (problems.length > 0) throw new ActionError(problems[0]);
}

async function setInterviewers(tx: Executor, interviewId: string, personIds: readonly string[]): Promise<void> {
  const wanted = [...new Set(personIds)];
  await tx.delete(schema.interviewInterviewer).where(eq(schema.interviewInterviewer.interviewId, interviewId));
  if (wanted.length === 0) return;
  await tx.insert(schema.interviewInterviewer).values(wanted.map((personId, index) => ({ interviewId, personId, isLead: index === 0 })));
}

/**
 * Books one. The calendar push happens **after** the transaction commits: it is a network call, and
 * a failed integration must not lose an interview that everybody has already agreed to. Its outcome
 * is written back onto the row, which is how the page can say "the internal event exists, Google
 * has not been told".
 */
export async function scheduleInterview(input: InterviewInput, actorPersonId: string): Promise<{ interview: InterviewRow; calendar: CalendarResult }> {
  checkDraft(input);

  const created = await db().transaction(async (tx) => {
    const application = await findApplication(input.applicationId, tx);
    if (!application) throw new ActionError("recruit_application_not_found");
    const opening = await findOpening(application.openingId, tx);
    if (!opening) throw new ActionError("recruit_opening_not_found");
    if (input.stageId) {
      const stages = await stagesOf(opening.pipelineId, tx);
      if (!stages.some((stage) => stage.id === input.stageId)) throw new ActionError("recruit_stage_not_found");
    }

    const [interview] = await tx
      .insert(schema.interview)
      .values({
        applicationId: application.id,
        openingId: opening.id,
        stageId: input.stageId,
        kind: input.kind,
        round: (await countRounds(tx, application.id)) + 1,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        mode: input.mode,
        location: input.location,
        meetingUrl: input.meetingUrl,
        notesForCandidate: input.notesForCandidate,
        criteria: kitFor(opening),
        scheduledByPersonId: actorPersonId,
      })
      .returning();
    await setInterviewers(tx, interview.id, input.interviewerPersonIds);
    await recordApplicationEvent(tx, {
      applicationId: application.id,
      type: "interview_scheduled",
      toStageId: input.stageId,
      actorPersonId,
      note: input.title,
      // The history says what kind of conversation and when, never who said what about whom.
      detail: { kind: input.kind, interviewers: new Set(input.interviewerPersonIds).size },
    });
    return interview;
  });

  const { interview, calendar } = await deliverAndRecord(created);
  await notifyInterviewers(interview, "recruit.interview_scheduled");
  return { interview, calendar };
}

async function countRounds(tx: Executor, applicationId: string): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.interview)
    .where(and(eq(schema.interview.applicationId, applicationId), ne(schema.interview.status, "cancelled")));
  return Number(row?.value ?? 0);
}

/** The calendar call and the row it writes back. Separated so scheduling and rescheduling share it. */
async function deliverAndRecord(interview: InterviewRow): Promise<{ interview: InterviewRow; calendar: CalendarResult }> {
  const interviewers = (await interviewersOf([interview.id])).get(interview.id) ?? [];
  const application = await findApplication(interview.applicationId);
  const candidate = application ? await findCandidate(application.candidateId) : undefined;
  const opening = await findOpening(interview.openingId);
  const driver = calendarDriver();
  const result = await pushToCalendar(interview, interviewers, candidate?.fullName ?? "", opening?.title ?? "");

  const [after] = await db()
    .update(schema.interview)
    .set({
      calendarDriver: driver.name,
      calendarStatus: result.status,
      calendarEventId: result.status === "sent" ? result.eventId : interview.calendarEventId,
      calendarError: result.status === "failed" ? result.error.slice(0, 500) : null,
      // A Meet link Google minted is the meeting link, unless somebody typed one.
      meetingUrl: result.status === "sent" && result.meetingUrl && !interview.meetingUrl ? result.meetingUrl : interview.meetingUrl,
      updatedAt: now(),
    })
    .where(eq(schema.interview.id, interview.id))
    .returning();
  return { interview: after, calendar: result };
}

async function notifyInterviewers(interview: InterviewRow, kind: "recruit.interview_scheduled" | "recruit.interview_cancelled"): Promise<void> {
  const interviewers = (await interviewersOf([interview.id])).get(interview.id) ?? [];
  if (interviewers.length === 0) return;
  const application = await findApplication(interview.applicationId);
  const candidate = application ? await findCandidate(application.candidateId) : undefined;
  await notify({
    recipients: interviewers.map((row) => row.personId),
    kind,
    // The candidate's name is the point of the notification; no figure and no judgement appear.
    params: { title: interview.title, candidate: candidate?.fullName ?? "" },
    link: `/recruit/interviews/${interview.id}`,
  });
}

export async function rescheduleInterview(
  interviewId: string,
  input: { startAt: Date; endAt: Date; location: string | null; meetingUrl: string | null; interviewerPersonIds: string[] },
  actorPersonId: string,
): Promise<{ interview: InterviewRow; calendar: CalendarResult }> {
  checkDraft(input);

  const moved = await db().transaction(async (tx) => {
    const before = await findInterview(interviewId, tx);
    if (!before) throw new ActionError("recruit_interview_not_found");
    if (INTERVIEW_CLOSED.includes(before.status)) throw new ActionError("recruit_interview_closed");
    const [after] = await tx
      .update(schema.interview)
      .set({ startAt: input.startAt, endAt: input.endAt, location: input.location, meetingUrl: input.meetingUrl, updatedAt: now() })
      .where(eq(schema.interview.id, interviewId))
      .returning();
    await setInterviewers(tx, interviewId, input.interviewerPersonIds);
    await recordApplicationEvent(tx, { applicationId: after.applicationId, type: "interview_scheduled", actorPersonId, note: after.title, detail: { rescheduled: true } });
    return after;
  });

  const { interview, calendar } = await deliverAndRecord(moved);
  await notifyInterviewers(interview, "recruit.interview_scheduled");
  return { interview, calendar };
}

export async function setInterviewStatus(interviewId: string, status: InterviewStatus, reason: string | null, actorPersonId: string): Promise<InterviewRow> {
  const after = await db().transaction(async (tx) => {
    const before = await findInterview(interviewId, tx);
    if (!before) throw new ActionError("recruit_interview_not_found");
    if (before.status === status) throw new ActionError("recruit_interview_status_unchanged");
    const [row] = await tx
      .update(schema.interview)
      .set({
        status,
        cancelledAt: status === "cancelled" ? now() : null,
        cancelReason: status === "cancelled" ? reason : null,
        updatedAt: now(),
      })
      .where(eq(schema.interview.id, interviewId))
      .returning();
    if (status === "cancelled") {
      await recordApplicationEvent(tx, { applicationId: row.applicationId, type: "interview_cancelled", actorPersonId, note: reason ?? row.title });
    }
    return row;
  });

  if (status === "cancelled") {
    if (after.calendarEventId) await calendarDriver().cancel(after.calendarEventId);
    await notifyInterviewers(after, "recruit.interview_cancelled");
  }
  return after;
}

// ── The calendar file ───────────────────────────────────────────────────────────────────────

export type InterviewIcs = { fileName: string; body: string };

/**
 * The `.ics` for one interview — the part of scheduling that needs no integration at all. Guarded
 * by the same rule as the interview page: whoever may open it may download it.
 */
export async function icsForInterview(viewer: { principal: Principal; personId: string | null }, interviewId: string): Promise<InterviewIcs | null> {
  const view = await getInterviewView(viewer, interviewId);
  if (!view) return null;
  const { interview } = view;
  const organizer = interview.scheduledByPersonId
    ? (await db().select({ fullName: schema.person.fullName, workEmail: schema.person.workEmail }).from(schema.person).where(eq(schema.person.id, interview.scheduledByPersonId)).limit(1))[0]
    : undefined;

  const summary = `${interview.title} — ${view.candidateName}`;
  return {
    fileName: icsFileName(summary),
    body: renderIcs({
      uid: uidFor(interview.id),
      // The row's version, so a re-download after a move is an update rather than a duplicate.
      sequence: Math.floor(interview.updatedAt.getTime() / 1000) % 1_000_000,
      stamp: now(),
      start: interview.startAt,
      end: interview.endAt,
      summary,
      description: [view.openingTitle, view.openingCode, interview.notesForCandidate, interview.meetingUrl].filter(Boolean).join("\n"),
      location: interview.location,
      url: interview.meetingUrl ?? `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/recruit/interviews/${interview.id}`,
      organizer: organizer?.workEmail ? { name: organizer.fullName, email: organizer.workEmail } : null,
      attendees: view.interviewers.filter((row) => row.workEmail).map((row) => ({ name: row.fullName, email: row.workEmail! })),
      cancelled: interview.status === "cancelled",
    }),
  };
}

// ── Scorecards, and the blind rule ──────────────────────────────────────────────────────────

export type ScorecardInput = {
  ratings: Record<string, number>;
  recommendation: InterviewRecommendation | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
};

export type OthersScorecard = {
  interviewerPersonId: string;
  interviewerName: string;
  ratings: Record<string, number>;
  recommendation: InterviewRecommendation | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
  submittedAt: Date;
};

export type ScorecardsView = {
  criteria: ScorecardCriterion[];
  /** My own card, draft or submitted. Null when I am not interviewing this one. */
  mine: ScorecardRow | null;
  /** Everybody else's — **submitted ones only**, and only once mine is in. See `blind`. */
  others: OthersScorecard[];
  /**
   * True when there are other people's cards and I am not being shown them, because I have not
   * submitted mine. The page says so out loud: a blank panel with no explanation reads like a bug.
   */
  blind: boolean;
  /** How many interviewers have not submitted yet. Safe to show: a count is not an opinion. */
  awaiting: number;
  canScore: boolean;
};

/**
 * **The blind-feedback rule** (FR-REC-06). Every read of a scorecard comes through here.
 *
 *   · An **interviewer** sees their own card always, and the others' only once they have submitted
 *     their own. Not a draft — submitted. An interviewer who can read the panel and then write
 *     their card has not given independent evidence, which is the entire purpose of the rule.
 *   · A **recruiter or hiring-team member who is not interviewing** sees every submitted card.
 *     They have no card of their own to be influenced, and somebody has to be able to read the
 *     panel to decide. An unsubmitted draft is nobody's business but its author's.
 *   · Anybody else gets `null`, exactly as if the interview did not exist.
 */
export async function scorecardsFor(viewer: { principal: Principal; personId: string | null }, interviewId: string): Promise<ScorecardsView | null> {
  const view = await getInterviewView(viewer, interviewId);
  if (!view) return null;

  const rows = await db()
    .select({ card: schema.interviewScorecard, interviewerName: schema.person.fullName })
    .from(schema.interviewScorecard)
    .innerJoin(schema.person, eq(schema.person.id, schema.interviewScorecard.interviewerPersonId))
    .where(eq(schema.interviewScorecard.interviewId, interviewId))
    .orderBy(asc(schema.person.fullName));

  const mine = viewer.personId ? (rows.find((row) => row.card.interviewerPersonId === viewer.personId)?.card ?? null) : null;
  const submittedByOthers = rows.filter((row) => row.card.interviewerPersonId !== viewer.personId && row.card.submittedAt !== null);
  // The gate. `view.amInterviewing` is a row in `interview_interviewer`, not a claim in a request.
  const blind = view.amInterviewing && !mine?.submittedAt && submittedByOthers.length > 0;

  return {
    criteria: view.interview.criteria.length > 0 ? view.interview.criteria : [...DEFAULT_INTERVIEW_KIT],
    mine,
    others: blind
      ? []
      : submittedByOthers.map((row) => ({
          interviewerPersonId: row.card.interviewerPersonId,
          interviewerName: row.interviewerName,
          ratings: row.card.ratings,
          recommendation: row.card.recommendation,
          strengths: row.card.strengths,
          concerns: row.card.concerns,
          notes: row.card.notes,
          submittedAt: row.card.submittedAt!,
        })),
    blind,
    awaiting: view.interviewers.length - rows.filter((row) => row.card.submittedAt !== null).length,
    canScore: canScoreInterview(viewer.principal, view.amInterviewing),
  };
}

/** Scores for criteria this interview did not ask about are dropped; the rest are clamped to the scale. */
function cleanRatings(criteria: readonly ScorecardCriterion[], given: Record<string, number>): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const criterion of criteria) {
    const value = given[criterion.key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    ratings[criterion.key] = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value)));
  }
  return ratings;
}

/**
 * Writes one interviewer's card. **Submitting is final**: the row is closed to further edits,
 * because an interviewer who may revise after reading the panel is exactly the thing the blind rule
 * exists to prevent. A draft may be saved as often as they like.
 */
export async function saveScorecard(
  interviewId: string,
  interviewerPersonId: string,
  input: ScorecardInput,
  options: { submit: boolean },
): Promise<ScorecardRow> {
  return db().transaction(async (tx) => {
    const interview = await findInterview(interviewId, tx);
    if (!interview) throw new ActionError("recruit_interview_not_found");
    if (!(await isInterviewer(interviewId, interviewerPersonId, tx))) throw new ActionError("recruit_not_an_interviewer");
    if (interview.status === "cancelled") throw new ActionError("recruit_interview_closed");

    const criteria = interview.criteria.length > 0 ? interview.criteria : [...DEFAULT_INTERVIEW_KIT];
    const values = {
      ratings: cleanRatings(criteria, input.ratings),
      recommendation: input.recommendation,
      strengths: input.strengths,
      concerns: input.concerns,
      notes: input.notes,
      submittedAt: options.submit ? now() : null,
      updatedAt: now(),
    };
    // A submission has to say something; a draft may be half-finished.
    if (options.submit && !values.recommendation) throw new ActionError("recruit_scorecard_needs_recommendation");

    const [existing] = await tx
      .select()
      .from(schema.interviewScorecard)
      .where(and(eq(schema.interviewScorecard.interviewId, interviewId), eq(schema.interviewScorecard.interviewerPersonId, interviewerPersonId)))
      .limit(1);

    if (existing?.submittedAt) throw new ActionError("recruit_scorecard_submitted");

    const [card] = existing
      ? await tx.update(schema.interviewScorecard).set(values).where(eq(schema.interviewScorecard.id, existing.id)).returning()
      : await tx.insert(schema.interviewScorecard).values({ interviewId, interviewerPersonId, ...values }).returning();

    if (options.submit) {
      await recordApplicationEvent(tx, {
        applicationId: interview.applicationId,
        type: "scorecard_submitted",
        actorPersonId: interviewerPersonId,
        note: interview.title,
        // The history records **that** a card came in, never what it said: the application's
        // timeline is read by everyone running the opening, the card by whoever may read cards.
        detail: { interviewId },
      });
    }
    return card;
  });
}

/**
 * How many cards this application is still waiting for. A left join and `submitted_at is null`:
 * with no row at all the column is null too, so "never started" and "still a draft" are one
 * condition rather than two.
 */
export async function pendingScorecardCount(applicationId: string, executor: Executor = db()): Promise<number> {
  const [row] = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.interviewInterviewer)
    .innerJoin(schema.interview, eq(schema.interview.id, schema.interviewInterviewer.interviewId))
    .leftJoin(
      schema.interviewScorecard,
      and(
        eq(schema.interviewScorecard.interviewId, schema.interviewInterviewer.interviewId),
        eq(schema.interviewScorecard.interviewerPersonId, schema.interviewInterviewer.personId),
      ),
    )
    .where(and(eq(schema.interview.applicationId, applicationId), ne(schema.interview.status, "cancelled"), isNull(schema.interviewScorecard.submittedAt)));
  return Number(row?.value ?? 0);
}
