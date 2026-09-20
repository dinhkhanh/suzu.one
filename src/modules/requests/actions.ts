"use server";
// Every mutation of the request builder. Designing a type is `org:manage` — the same permission
// that governs the approval flow it runs on. Filing one is everybody's.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { approverRuleSchema, conditionSchema } from "@/modules/platform/approvals/flows";
import { FIELD_TYPES, MAX_FIELDS, MAX_OPTIONS, MAX_TEXT } from "./engine/form";
import { canFileRequests, canManageRequestTypes } from "./policy";
import { REQUEST_CATEGORIES } from "./enums";
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
  min: optionalNumber,
  max: optionalNumber,
  minDate: optionalDay,
  maxDate: optionalDay,
  minLength: optionalNumber,
  maxLength: optionalNumber,
  pattern: optionalText(200),
  visibleWhen: z.preprocess(blankToNull, conditionSchema.nullable().default(null)),
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
        before: before ? { form: before.form, active: before.active, nameVi: before.nameVi } : null,
        after: { form: after.form, active: after.active, nameVi: after.nameVi },
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

// The answers arrive as a flat record; the engine coerces and checks each one against its field.
const answers = z.record(z.string().max(40), z.union([z.string().max(MAX_TEXT), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).nullable()).default({});

const filePipeline = createAction({
  name: "request.file",
  input: z.object({ code: z.string().trim().min(1).max(40), values: answers }),
  authorize: (user) => canFileRequests(user.principal),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(user.person.id);
    const filed = await fileRequest(input, { personId: user.person.id, entityId: target?.entityId ?? null, departmentId: target?.departmentId ?? null, teamId: target?.teamId ?? null, managerId: target?.managerId ?? null }, formatDong);
    revalidatePath("/requests");
    revalidatePath("/approvals");
    return { data: filed, audit: { resource: { type: `approval:request:${input.code}`, id: filed.requestId, entityId: target?.entityId ?? null }, summary: input.code, after: { outcome: filed.outcome } } };
  },
});

export async function fileRequestAction(input: unknown) {
  return filePipeline(input);
}

const refilePipeline = createAction({
  name: "request.refile",
  input: z.object({ requestId: z.uuid(), values: answers }),
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
    revalidatePath("/approvals");
    revalidatePath(`/approvals/request/${request.id}`);
    revalidatePath("/requests");
    return {
      data: { outcome },
      audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: `${input.decision}: ${request.summary}`, before: { status: before.status }, after: { status: request.status } },
    };
  },
});

export async function decideRequestAction(input: unknown) {
  return decidePipeline(input);
}
