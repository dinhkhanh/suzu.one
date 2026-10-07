"use server";
// Every mutation of the request builder. Designing a type is `org:manage` — the same permission
// that governs the approval flow it runs on. Filing one is everybody's.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { reportError } from "@/lib/observability/report";
import { getPersonTarget } from "@/modules/core-hr/service";
import { approverRuleSchema, conditionSchema } from "@/modules/platform/approvals/flows";
import { FOLLOW_UP_OPENS, MAX_FOLLOW_UPS, MAX_PER_PARENT } from "./engine/follow-ups";
import { FIELD_TYPES, MAX_FIELDS, MAX_OPTIONS } from "./engine/form";
import { fileRequestInput, requestAnswers } from "./inputs";
import { canFileRequests, canManageRequestTypes, canPayRequests } from "./policy";
import { REQUEST_CATEGORIES, REQUEST_PAYOUTS } from "./enums";
import { CONFIRMATION_LETTER_CODE, type IssuedLetter, issueConfirmationLetter } from "./letters";
import { markRequestPaid, payoutEntityOf } from "./payments";
import { decideGenericRequest, fileRequest, findRequestType, getGenericRequest, refileRequest, saveRequestType, setRequestTypeActive } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
const optionalNumber = z.preprocess(blankToNull, z.coerce.number().nullable().default(null));
const optionalDay = z.preprocess(blankToNull, z.iso.date().nullable().default(null));

const fieldOption = z.object({ value: z.string().trim().min(1).max(60), labelVi: z.string().trim().min(1).max(120), labelEn: z.string().trim().min(1).max(120) });

const formField = z.object({
  key: z.string().trim().min(1).max(40),
  type: z.enum(FIELD_TYPES),
  labelVi: z.string().trim().min(1).max(160),
  labelEn: z.string().trim().min(1).max(160),
  hintVi: optionalText(300),
  hintEn: optionalText(300),
  required: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(false),
  options: z.array(fieldOption).max(MAX_OPTIONS).optional(),
  multiple: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(false),
  min: optionalNumber,
  max: optionalNumber,
  minDate: optionalDay,
  maxDate: optionalDay,
  minLength: optionalNumber,
  maxLength: optionalNumber,
  pattern: optionalText(200),
  visibleWhen: z.preprocess(blankToNull, conditionSchema.nullable().default(null)),
});

// FR-REQ-05: one type filed under this one's requests. The engine checks the rest against the catalogue.
const followUpRule = z.object({
  code: z.string().trim().min(1).max(40),
  opensWhen: z.enum(FOLLOW_UP_OPENS),
  notBeforeField: z.preprocess(blankToNull, z.string().trim().max(40).nullable().default(null)),
  max: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(MAX_PER_PARENT).nullable().default(null)),
});

// The designer posts the whole form as JSON text — a field list is not a flat form.
const jsonText = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }, schema);

const savePipeline = createAction({
  name: "request_type.save",
  input: z.object({
    id: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
    code: z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
    nameVi: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    descriptionVi: optionalText(500),
    descriptionEn: optionalText(500),
    category: z.enum(REQUEST_CATEGORIES),
    entityId: z.preprocess(blankToNull, z.uuid().nullable().default(null)),
    icon: optionalText(40),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
    active: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(true),
    slaRemindAfterDays: z.coerce.number().int().min(0).max(90).default(0),
    slaEscalateAfterDays: z.coerce.number().int().min(0).max(180).default(0),
    slaEscalateTo: jsonText(approverRuleSchema.nullable().default(null)),
    form: jsonText(z.object({ fields: z.array(formField).max(MAX_FIELDS) })),
    followUps: jsonText(z.array(followUpRule).max(MAX_FOLLOW_UPS)).default([]),
    standalone: z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean()).default(true),
    payout: z.enum(REQUEST_PAYOUTS).default("none"),
  }),
  authorize: (user, input) => canManageRequestTypes(user.principal, input.entityId),
  run: async ({ user, input }) => {
    const { id, ...values } = input;
    const { before, after } = await saveRequestType(id, values, user.person.id);
    revalidatePath("/admin/request-types");
    revalidatePath("/requests/new");
    return {
      data: { id: after.id, code: after.code },
      audit: {
        resource: { type: "request_type", id: after.id, entityId: after.entityId },
        summary: `${after.code}: ${after.nameVi}`,
        before: before ? { form: before.form, active: before.active, nameVi: before.nameVi, followUps: before.followUps, standalone: before.standalone, payout: before.payout } : null,
        after: { form: after.form, active: after.active, nameVi: after.nameVi, followUps: after.followUps, standalone: after.standalone, payout: after.payout },
      },
    };
  },
});

export async function saveRequestTypeAction(input: unknown) {
  return savePipeline(input);
}

const activePipeline = createAction({
  name: "request_type.set_active",
  input: z.object({ id: z.uuid(), active: z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean()) }),
  authorize: async (user, input) => {
    const row = await findRequestType(input.id);
    return !!row && canManageRequestTypes(user.principal, row.entityId);
  },
  run: async ({ user, input }) => {
    const { before, after } = await setRequestTypeActive(input.id, input.active, user.person.id);
    revalidatePath("/admin/request-types");
    revalidatePath("/requests/new");
    return { data: { id: after.id }, audit: { resource: { type: "request_type", id: after.id, entityId: after.entityId }, summary: after.code, before: { active: before.active }, after: { active: after.active } } };
  },
});

export async function setRequestTypeActiveAction(input: unknown) {
  return activePipeline(input);
}

// ── Filing ──────────────────────────────────────────────────────────────────────────────────

// Whole-đồng figures with no decimals and no separators — the reader's own formatting would put
// the request's summary into the *approver's* language, which is not where it is written.
const formatDong = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;

const filePipeline = createAction({
  name: "request.file",
  input: fileRequestInput,
  authorize: (user) => canFileRequests(user.principal),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(user.person.id);
    const filed = await fileRequest(input, { personId: user.person.id, entityId: target?.entityId ?? null, unitPath: target?.unitPath ?? [], managerId: target?.managerId ?? null }, formatDong);
    revalidatePath("/requests");
    revalidatePath("/approvals");
    if (input.parentRequestId) revalidatePath(`/approvals/request/${input.parentRequestId}`);
    return {
      data: filed,
      audit: { resource: { type: `approval:request:${input.code}`, id: filed.requestId, entityId: target?.entityId ?? null }, summary: input.code, after: { outcome: filed.outcome, parentRequestId: input.parentRequestId } },
    };
  },
});

export async function fileRequestAction(input: unknown) {
  return filePipeline(input);
}

const refilePipeline = createAction({
  name: "request.refile",
  input: z.object({ requestId: z.uuid(), values: requestAnswers }),
  authorize: async (user, input) => {
    const view = await getGenericRequest({ personId: user.person.id, principal: user.principal }, input.requestId);
    return !!view && view.isRequester && view.request.status === "returned";
  },
  run: async ({ user, input }) => {
    await refileRequest(input.requestId, user.person.id, input.values, formatDong);
    revalidatePath("/requests");
    revalidatePath(`/approvals/request/${input.requestId}`);
    return { data: { requestId: input.requestId }, audit: { resource: { type: "approval:request", id: input.requestId }, summary: "resubmitted" } };
  },
});

export async function refileRequestAction(input: unknown) {
  return refilePipeline(input);
}

const decidePipeline = createAction({
  name: "request.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: optionalText(1000) }),
  authorize: async (user, input) => !!(await getGenericRequest({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome } = await decideGenericRequest(input.requestId, user.person.id, { action: input.decision, comment: input.comment });
    // REQ-02: an approved confirmation letter is made at once, by the documents module, as the
    // approver who finished it. If they may not make it (a salary letter needs the compensation
    // tier), the approval stands and HR makes the letter from the person page.
    let letter: IssuedLetter | null = null;
    if (outcome === "approved" && request.type === `request:${CONFIRMATION_LETTER_CODE}`) {
      try {
        letter = await issueConfirmationLetter(request.id, { principal: user.principal, personId: user.person.id });
      } catch (error) {
        await reportError(error, { event: "requests.confirmation_letter.failed", source: "action" });
      }
    }
    revalidatePath("/approvals");
    revalidatePath(`/approvals/request/${request.id}`);
    revalidatePath("/requests");
    return {
      data: { outcome },
      audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: `${input.decision}: ${request.summary}`, before: { status: before.status }, after: { status: request.status, ...(letter && "documentId" in letter ? { documentId: letter.documentId, documentNumber: letter.number } : {}) } },
    };
  },
});

export async function decideRequestAction(input: unknown) {
  return decidePipeline(input);
}

// ── Paying (REQ-01) ─────────────────────────────────────────────────────────────────────────

const paidPipeline = createAction({
  name: "request.mark_paid",
  input: z.object({ requestId: z.uuid(), paidOn: z.iso.date(), reference: z.string().trim().min(1).max(120) }),
  // Finance of the request's own entity.
  authorize: async (user, input) => {
    const where = await payoutEntityOf(input.requestId);
    return !!where && canPayRequests(user.principal, where.entityId);
  },
  run: async ({ user, input }) => {
    const { before, after } = await markRequestPaid(input.requestId, { paidOn: input.paidOn, reference: input.reference }, user.person.id);
    revalidatePath("/requests/pay");
    revalidatePath(`/approvals/request/${input.requestId}`);
    return {
      data: { paidAmount: after.paidAmount },
      audit: {
        resource: { type: `approval:request:${after.code}`, id: input.requestId, entityId: after.entityId },
        summary: `paid ${after.paidAmount} on ${input.paidOn} (${input.reference})`,
        before: { paidOn: before.paidOn },
        after: { paidOn: after.paidOn, paidAmount: after.paidAmount, paidReference: after.paidReference, nettedAdvance: after.settlement.nettedAdvance },
      },
    };
  },
});

export async function markRequestPaidAction(input: unknown) {
  return paidPipeline(input);
}
