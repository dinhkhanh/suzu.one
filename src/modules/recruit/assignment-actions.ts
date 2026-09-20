"use server";
// Sending, cancelling and rating a take-home (FR-REC-07), each through the one pipeline.
//
// **The link is returned to the caller exactly once**, in `data`, and is never stored, logged or
// audited: only its hash is on the row. The screen that receives it shows it to the recruiter to
// paste into the candidate's email. Asking for it again means issuing a new one, which is the
// same rule the approval deep links follow.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { cancelAssignment, findAssignment, mayRunAssignmentOn, rateAssignment, sendAssignment } from "./assignments";
import { SCORE_MAX, SCORE_MIN } from "./enums";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));

const sendAssignmentPipeline = createAction({
  name: "recruit.assignment.send",
  input: z.object({
    applicationId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    brief: z.string().trim().min(10).max(20_000),
    dueAt: z.coerce.date(),
  }),
  authorize: (user, input) => mayRunAssignmentOn({ principal: user.principal, personId: user.person.id }, input.applicationId),
  run: async ({ user, input }) => {
    const { assignment, token } = await sendAssignment(input, user.person.id);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    return {
      // The one copy of the link. Nothing below it, and nothing in the audit row, contains it.
      data: { id: assignment.id, link: `/careers/assignment/${token}` },
      audit: {
        resource: { type: "recruit_assignment", id: assignment.id },
        summary: assignment.title,
        after: { dueAt: assignment.dueAt.toISOString() },
      },
    };
  },
});

const cancelAssignmentPipeline = createAction({
  name: "recruit.assignment.cancel",
  input: z.object({ assignmentId: z.uuid() }),
  authorize: async (user, input) => {
    const assignment = await findAssignment(input.assignmentId);
    return !!assignment && (await mayRunAssignmentOn({ principal: user.principal, personId: user.person.id }, assignment.applicationId));
  },
  run: async ({ user, input }) => {
    const assignment = await cancelAssignment(input.assignmentId, user.person.id);
    revalidatePath(`/recruit/applications/${assignment.applicationId}`);
    return { data: { status: assignment.status }, audit: { resource: { type: "recruit_assignment", id: assignment.id }, summary: assignment.title, after: { status: assignment.status } } };
  },
});

const rateAssignmentPipeline = createAction({
  name: "recruit.assignment.rate",
  input: z.object({ assignmentId: z.uuid(), rating: z.coerce.number().int().min(SCORE_MIN).max(SCORE_MAX), note: optional(z.string().trim().max(4000)) }),
  authorize: async (user, input) => {
    const assignment = await findAssignment(input.assignmentId);
    return !!assignment && (await mayRunAssignmentOn({ principal: user.principal, personId: user.person.id }, assignment.applicationId));
  },
  run: async ({ user, input }) => {
    const assignment = await rateAssignment(input.assignmentId, input, user.person.id);
    revalidatePath(`/recruit/applications/${assignment.applicationId}`);
    return {
      data: { status: assignment.status },
      // The rating is a judgement of a person's work; the audit log says it happened.
      audit: { resource: { type: "recruit_assignment", id: assignment.id }, summary: assignment.title, after: { status: assignment.status, rated: true } },
    };
  },
});

// A `"use server"` file may export nothing but async functions (tests/server-actions.test.ts).

export async function sendAssignmentAction(input: unknown) {
  return sendAssignmentPipeline(input);
}

export async function cancelAssignmentAction(input: unknown) {
  return cancelAssignmentPipeline(input);
}

export async function rateAssignmentAction(input: unknown) {
  return rateAssignmentPipeline(input);
}
