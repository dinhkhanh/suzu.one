"use server";
// Interview and scorecard mutations, each through the one pipeline (parse → authenticate →
// authorize → run → audit).
//
// Two things are deliberate and worth stating once:
//
//   · **A scorecard's authorization is "were you in the room"**, read from
//     `interview_interviewer` — not from a role and not from a field in the request. The recruiter
//     who booked the interview is refused here, on purpose.
//   · **No audit entry carries a rating, a recommendation or a word of the feedback.** The audit
//     log is read across the company; a scorecard is read by the panel. What is recorded is that a
//     card was saved or submitted, by whom, on which interview.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { INTERVIEW_KINDS, INTERVIEW_MODES, INTERVIEW_RECOMMENDATIONS, INTERVIEW_STATUSES, SCORE_MAX, SCORE_MIN } from "./enums";
import { findInterview, isInterviewer, rescheduleInterview, saveScorecard, scheduleInterview, setInterviewStatus } from "./interviews";
import { canScheduleInterview, canScoreInterview } from "./policy";
import { findApplication, findOpening, isOpeningMember } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
/** `datetime-local` gives "2026-09-24T09:30" with no zone; the browser's zone is the office's. */
const instant = z.coerce.date();
const personIds = z.preprocess((value) => (Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : []), z.array(z.uuid()).max(12));

const openingTargetOf = (row: { entityId: string; departmentId: string | null; teamId: string | null }) => ({ entityId: row.entityId, departmentId: row.departmentId, teamId: row.teamId });

/** May this person book on this application? Resolved from the opening every time, never trusted. */
async function mayScheduleOn(user: { principal: Parameters<typeof canScheduleInterview>[0]; person: { id: string } }, applicationId: string): Promise<boolean> {
  const application = await findApplication(applicationId);
  if (!application) return false;
  const opening = await findOpening(application.openingId);
  if (!opening) return false;
  return canScheduleInterview(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
}

const scheduleInterviewPipeline = createAction({
  name: "recruit.interview.schedule",
  input: z.object({
    applicationId: z.uuid(),
    stageId: optional(z.uuid()),
    kind: z.enum(INTERVIEW_KINDS),
    title: z.string().trim().min(2).max(200),
    startAt: instant,
    endAt: instant,
    mode: z.enum(INTERVIEW_MODES),
    location: optional(z.string().trim().max(300)),
    meetingUrl: optional(z.url().max(500)),
    notesForCandidate: optional(z.string().trim().max(2000)),
    interviewerPersonIds: personIds,
  }),
  authorize: (user, input) => mayScheduleOn(user, input.applicationId),
  run: async ({ user, input }) => {
    const { interview, calendar } = await scheduleInterview(input, user.person.id);
    const opening = await findOpening(interview.openingId);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    revalidatePath("/recruit/interviews");
    return {
      data: { id: interview.id, calendar: calendar.status },
      audit: {
        resource: { type: "interview", id: interview.id, entityId: opening?.entityId ?? null },
        summary: `${interview.title} · ${interview.kind}`,
        after: { startAt: interview.startAt.toISOString(), mode: interview.mode, interviewers: input.interviewerPersonIds.length, calendar: calendar.status },
      },
    };
  },
});

const rescheduleInterviewPipeline = createAction({
  name: "recruit.interview.reschedule",
  input: z.object({
    interviewId: z.uuid(),
    startAt: instant,
    endAt: instant,
    location: optional(z.string().trim().max(300)),
    meetingUrl: optional(z.url().max(500)),
    interviewerPersonIds: personIds,
  }),
  authorize: async (user, input) => {
    const interview = await findInterview(input.interviewId);
    return !!interview && (await mayScheduleOn(user, interview.applicationId));
  },
  run: async ({ user, input }) => {
    const { interview, calendar } = await rescheduleInterview(input.interviewId, input, user.person.id);
    revalidatePath(`/recruit/interviews/${input.interviewId}`);
    revalidatePath(`/recruit/applications/${interview.applicationId}`);
    return {
      data: { id: interview.id, calendar: calendar.status },
      audit: { resource: { type: "interview", id: interview.id }, summary: interview.title, after: { startAt: interview.startAt.toISOString(), calendar: calendar.status } },
    };
  },
});

const setInterviewStatusPipeline = createAction({
  name: "recruit.interview.status",
  input: z.object({ interviewId: z.uuid(), status: z.enum(INTERVIEW_STATUSES), reason: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const interview = await findInterview(input.interviewId);
    return !!interview && (await mayScheduleOn(user, interview.applicationId));
  },
  run: async ({ user, input }) => {
    const interview = await setInterviewStatus(input.interviewId, input.status, input.reason, user.person.id);
    revalidatePath(`/recruit/interviews/${input.interviewId}`);
    revalidatePath(`/recruit/applications/${interview.applicationId}`);
    return { data: { status: interview.status }, audit: { resource: { type: "interview", id: interview.id }, summary: interview.title, after: { status: interview.status } } };
  },
});

const saveScorecardPipeline = createAction({
  name: "recruit.scorecard.save",
  input: z.object({
    interviewId: z.uuid(),
    // `ratings.<criterion key>` from the form; unknown keys are dropped by the service against the
    // interview's own kit, so a hand-posted criterion never reaches the row.
    ratings: z.record(z.string().max(64), z.coerce.number().int().min(SCORE_MIN).max(SCORE_MAX)).default({}),
    recommendation: optional(z.enum(INTERVIEW_RECOMMENDATIONS)),
    strengths: optional(z.string().trim().max(4000)),
    concerns: optional(z.string().trim().max(4000)),
    notes: optional(z.string().trim().max(4000)),
    submit: z.preprocess((value) => value === "on" || value === true, z.boolean()),
  }),
  // Only somebody who was in the room, whatever else they hold.
  authorize: async (user, input) => canScoreInterview(user.principal, await isInterviewer(input.interviewId, user.person.id)),
  run: async ({ user, input }) => {
    const card = await saveScorecard(input.interviewId, user.person.id, input, { submit: input.submit });
    revalidatePath(`/recruit/interviews/${input.interviewId}`);
    revalidatePath("/recruit/interviews");
    return {
      data: { id: card.id, submitted: !!card.submittedAt },
      // Deliberately nothing about what it said — see the note at the top of this file.
      audit: { resource: { type: "interview_scorecard", id: card.id }, summary: input.interviewId, after: { submitted: !!card.submittedAt, criteriaScored: Object.keys(card.ratings).length } },
    };
  },
});

// A `"use server"` file may export nothing but async functions (tests/server-actions.test.ts).

export async function scheduleInterviewAction(input: unknown) {
  return scheduleInterviewPipeline(input);
}

export async function rescheduleInterviewAction(input: unknown) {
  return rescheduleInterviewPipeline(input);
}

export async function setInterviewStatusAction(input: unknown) {
  return setInterviewStatusPipeline(input);
}

export async function saveScorecardAction(input: unknown) {
  return saveScorecardPipeline(input);
}
