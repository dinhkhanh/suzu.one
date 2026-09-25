"use server";
// Feedback about SuZu One: send it (anyone signed in), attach a screenshot, triage it.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "@/modules/platform/files/service";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, FEEDBACK_PRIORITIES, FEEDBACK_REPLY_MAX, FEEDBACK_SCREENSHOT_OWNER_TYPE, FEEDBACK_STATUSES } from "./enums";
import { canTriageFeedback } from "./policy";
import { getFeedback, submitFeedback, triageFeedback } from "./service";

// A checkbox posts "on" when ticked and nothing when not; JSON callers may send a boolean.
const checkbox = z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((value) => value === true || value === "on");
// The form sends the page it was opened on as null when there is none (the /feedback page itself),
// so "absent" is undefined, null or blank alike.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const submitPipeline = createAction({
  name: "feedback.submit",
  input: z.object({
    category: z.enum(FEEDBACK_CATEGORIES),
    message: z.string().trim().min(5).max(FEEDBACK_MESSAGE_MAX),
    blocking: checkbox,
    pagePath: optionalText(300),
    screenshotFileId: z.union([z.uuid(), z.literal("")]).optional().transform((value) => (value ? value : null)),
  }),
  // Everybody who can sign in uses the app, so everybody may say what is wrong with it.
  authorize: () => true,
  run: async ({ user, input }) => {
    const row = await submitFeedback({ personId: user.person.id, entityId: user.person.primaryEntityId, unitPath: user.person.orgUnitPath }, input, user.request.userAgent);
    revalidatePath("/feedback");
    // The category and the page only: the text is the person's own words and stays on the record.
    return { data: { id: row.id }, audit: { resource: { type: "app_feedback", id: row.id, entityId: row.entityId }, summary: `${row.category}${row.area ? ` · ${row.area}` : ""}` } };
  },
});

export async function submitFeedbackAction(input: unknown) {
  return submitPipeline(input);
}

// ── Screenshot ──────────────────────────────────────────────────────────────────────────────
// Uploaded before the feedback exists, so owned by the uploader and recorded on the feedback by
// id — the same shape as a request's attachments. Images only.
const IMAGE = /\.(png|jpe?g|webp)$/i;

const beginScreenshotPipeline = createAction({
  name: "feedback.screenshot.begin",
  input: z.object({ fileName: z.string().trim().min(1).max(255).regex(IMAGE), sizeBytes: z.number().int().positive() }),
  authorize: () => true,
  run: async ({ user, input }) => {
    // A screenshot can catch anything on screen, a payslip included: kept at the highest tier and
    // opened only by the sender and the people who triage (see openScreenshotPipeline).
    const upload = await beginUpload({ ownerType: FEEDBACK_SCREENSHOT_OWNER_TYPE, ownerId: user.person.id, entityId: user.person.primaryEntityId, tier: "compensation" }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: user.person.primaryEntityId }, summary: input.fileName } };
  },
});

export async function beginFeedbackScreenshotAction(input: unknown) {
  return beginScreenshotPipeline(input);
}

const completeScreenshotPipeline = createAction({
  name: "feedback.screenshot.complete",
  input: z.object({ fileId: z.uuid() }),
  // Only the pending upload this person started a moment ago.
  authorize: async (user, input) => {
    const [row] = await db()
      .select({ id: schema.storedFile.id })
      .from(schema.storedFile)
      .where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, FEEDBACK_SCREENSHOT_OWNER_TYPE), eq(schema.storedFile.ownerId, user.person.id), eq(schema.storedFile.status, "pending")))
      .limit(1);
    return !!row;
  },
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function completeFeedbackScreenshotAction(input: unknown) {
  return completeScreenshotPipeline(input);
}

const openScreenshotPipeline = createAction({
  name: "feedback.screenshot.open",
  input: z.object({ feedbackId: z.uuid(), fileId: z.uuid() }),
  // The sender, and whoever triages their feedback — not the read-only inbox: a screenshot may
  // show more than the words do.
  authorize: async (user, input) => {
    const view = await getFeedback(input.feedbackId);
    if (!view || view.row.screenshotFileId !== input.fileId) return false;
    return view.row.personId === user.person.id || canTriageFeedback(user.principal, view.target);
  },
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.deletedAt || file.ownerType !== FEEDBACK_SCREENSHOT_OWNER_TYPE) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function openFeedbackScreenshotAction(input: unknown) {
  return openScreenshotPipeline(input);
}

// ── Triage ──────────────────────────────────────────────────────────────────────────────────

const triagePipeline = createAction({
  name: "feedback.triage",
  input: z.object({
    id: z.uuid(),
    status: z.enum(FEEDBACK_STATUSES),
    priority: z.enum(FEEDBACK_PRIORITIES),
    reply: optionalText(FEEDBACK_REPLY_MAX),
    internalNote: optionalText(FEEDBACK_REPLY_MAX),
  }),
  authorize: async (user, input) => {
    const view = await getFeedback(input.id);
    return !!view && canTriageFeedback(user.principal, view.target);
  },
  run: async ({ user, input }) => {
    const { before, after } = await triageFeedback(input.id, user.person.id, input);
    revalidatePath("/feedback");
    revalidatePath(`/feedback/${input.id}`);
    return {
      data: { status: after.status },
      audit: {
        resource: { type: "app_feedback", id: after.id, entityId: after.entityId },
        summary: `${before.status} → ${after.status}`,
        before: { status: before.status, priority: before.priority, replied: !!before.reply },
        after: { status: after.status, priority: after.priority, replied: !!after.reply },
      },
    };
  },
});

export async function triageFeedbackAction(input: unknown) {
  return triagePipeline(input);
}

