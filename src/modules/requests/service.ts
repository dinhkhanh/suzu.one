// The generic request builder's use-cases (FR-REQ-01, 02, 04). The only entry point other modules
// and the composition root use.
//
// A request type defined in the database is turned into an ordinary `RequestTypeDefinition` by
// `genericRequestType`, so the approval engine treats it exactly like leave or a resignation: the
// same inbox, the same delegation, the same history, the same flow administration. What is *not*
// generic — the effect of an approval — is nothing here: a purchase request that is approved is
// simply approved, and finance reads it. Types whose approval must *do* something belong to the
// module that owns the doing.
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestTypeDefinition, type RequestView, resubmitRequest, type SubmitInput, submitRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { conditionFieldsOf, flowConditionData, type FormDefinition, type FormValues, formProblems, validateSubmission } from "./engine/form";
import type { RequestCategory } from "./enums";
import { EXPENSE_CLAIM_CODE, postApprovedClaim } from "./expense-posting";

type Executor = Tx | ReturnType<typeof db>;
export type RequestTypeRow = typeof schema.requestType.$inferSelect;
export type RequestSubmissionRow = typeof schema.requestSubmission.$inferSelect;

/** Every approval type this module owns is spelled `request:<code>` — one namespace, no clashes. */
export const APPROVAL_TYPE_PREFIX = "request:";
export const approvalTypeOf = (code: string) => `${APPROVAL_TYPE_PREFIX}${code}`;
export const codeOfApprovalType = (type: string) => (type.startsWith(APPROVAL_TYPE_PREFIX) ? type.slice(APPROVAL_TYPE_PREFIX.length) : null);

export { REQUEST_CATEGORIES, type RequestCategory } from "./enums";

// ── A database row as a request type the approval engine understands ────────────────────────

/**
 * The bridge. Everything a `RequestTypeDefinition` needs in code — who else may look, whether it
 * may be ticked unopened, what a flow may condition on — is derived from the stored row, so a type
 * an administrator invents on Tuesday behaves like one that shipped with the product.
 */
export function genericRequestType(row: Pick<RequestTypeRow, "code" | "form" | "nameVi">): RequestTypeDefinition {
  return defineRequestType({
    type: approvalTypeOf(row.code),
    // Notifications and emails are written in Vietnamese, the company's working language.
    name: row.nameVi,
    // Only ever a fallback: a saved `approval_flow` row for this type is what actually runs, and
    // the administration screen makes the designer save one. The line manager is the safe default.
    flow: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] },
    conditionFields: conditionFieldsOf(row.form),
    // A form was filled in to be read. Nothing generic is ticked off an inbox unopened.
    bulkApprovable: () => false,
    // Whoever may administer request types follows them; approvers and the requester are let in
    // by the engine itself. One exception: an expense claim is a payment, so whoever pays the
    // company's people may read it — finance cannot settle what it may not see (FR-REQ-03).
    canView: (viewer, subject) => can(viewer, "org:manage", {}) || (row.code === EXPENSE_CLAIM_CODE && can(viewer, "payroll:pay", subject ?? {})),
  });
}

// ── Reading the catalogue ───────────────────────────────────────────────────────────────────

export async function listRequestTypes(options: { activeOnly?: boolean; executor?: Executor } = {}): Promise<RequestTypeRow[]> {
  const executor = options.executor ?? db();
  return executor
    .select()
    .from(schema.requestType)
    .where(options.activeOnly ? eq(schema.requestType.active, true) : undefined)
    .orderBy(schema.requestType.sortOrder, schema.requestType.code);
}

export async function findRequestType(id: string): Promise<RequestTypeRow | null> {
  const [row] = await db().select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1);
  return row ?? null;
}

export async function findRequestTypeByCode(code: string, executor: Executor = db()): Promise<RequestTypeRow | null> {
  const [row] = await executor.select().from(schema.requestType).where(eq(schema.requestType.code, code)).limit(1);
  return row ?? null;
}

/** The types this person may file right now: active, and either the group's or their own entity's. */
export async function listAvailableTypes(entityId: string | null): Promise<RequestTypeRow[]> {
  const rows = await listRequestTypes({ activeOnly: true });
  return rows.filter((row) => row.entityId === null || row.entityId === entityId);
}

// ── Designing one ───────────────────────────────────────────────────────────────────────────

export type SaveTypeInput = {
  code: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string | null;
  descriptionEn: string | null;
  category: RequestCategory;
  entityId: string | null;
  form: FormDefinition;
  icon: string | null;
  sortOrder: number;
  active: boolean;
  slaRemindAfterDays: number;
  slaEscalateAfterDays: number;
  slaEscalateTo: Record<string, unknown> | null;
};

export async function saveRequestType(id: string | null, input: SaveTypeInput, actorPersonId: string): Promise<{ before: RequestTypeRow | null; after: RequestTypeRow }> {
  const problems = formProblems(input.form);
  if (problems.length > 0) throw new ActionError(`form_${problems[0]}`);
  if (input.slaEscalateAfterDays > 0 && input.slaRemindAfterDays > 0 && input.slaEscalateAfterDays < input.slaRemindAfterDays) throw new ActionError("sla_escalate_before_remind");

  return db().transaction(async (tx) => {
    const [before] = id ? await tx.select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1).for("update") : [];
    if (id && !before) throw new ActionError("request_type_not_found");
    // A code is part of every request already filed under it; renaming it would orphan them.
    if (before && before.code !== input.code) throw new ActionError("request_type_code_fixed");
    const [clash] = await tx.select({ id: schema.requestType.id }).from(schema.requestType).where(eq(schema.requestType.code, input.code)).limit(1);
    if (clash && clash.id !== id) throw new ActionError("request_type_code_taken");

    const values = { ...input, updatedByPersonId: actorPersonId, updatedAt: new Date() };
    const [after] = before
      ? await tx.update(schema.requestType).set(values).where(eq(schema.requestType.id, before.id)).returning()
      : await tx.insert(schema.requestType).values(values).returning();
    return { before: before ?? null, after };
  });
}

/** Switching a type off keeps every request filed under it; it only disappears from the picker. */
export async function setRequestTypeActive(id: string, active: boolean, actorPersonId: string): Promise<{ before: RequestTypeRow; after: RequestTypeRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1).for("update");
    if (!before) throw new ActionError("request_type_not_found");
    const [after] = await tx.update(schema.requestType).set({ active, updatedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.requestType.id, id)).returning();
    return { before, after };
  });
}

// ── Filing one ──────────────────────────────────────────────────────────────────────────────

export type FileRequestInput = { code: string; values: FormValues };

/**
 * What a type that is more than a form adds to a submission (FR-REQ-03: an expense claim's lines).
 * Everything here is optional; a plain request supplies none of it and behaves exactly as before.
 */
export type FileExtras = {
  /** Overrides the figure the form would derive — a claim adds its lines up rather than trusting a typed total. */
  amount?: number;
  /** Stored-file ids to record beside the form's own, so the attachment rule covers them too. */
  extraFileIds?: readonly string[];
  /** Merged over what a flow condition may test. */
  conditionData?: Record<string, unknown>;
  /** Runs in the same transaction once the submission row exists. */
  afterInsert?: (tx: Tx, submissionId: string) => Promise<void>;
};

/** The field a type calls its amount, by convention: the first money field on the form. */
export function amountFieldOf(form: FormDefinition): string | null {
  return form.fields.find((field) => field.type === "money")?.key ?? null;
}

/**
 * One line for inboxes, emails and the Chat card. Built from the answers, never from a field the
 * form marked as holding anything restricted — a summary is read on lock screens.
 */
function summarize(type: RequestTypeRow, values: FormValues, formatMoney: (amount: number) => string, override?: number): string {
  const amountField = amountFieldOf(type.form);
  const amount = override ?? (amountField && typeof values[amountField] === "number" ? (values[amountField] as number) : null);
  const firstText = type.form.fields.find((field) => (field.type === "text" || field.type === "textarea") && typeof values[field.key] === "string" && (values[field.key] as string).length > 0);
  const words = firstText ? String(values[firstText.key]).replaceAll(/\s+/g, " ").slice(0, 120) : "";
  return [amount === null ? null : formatMoney(amount), words || null].filter(Boolean).join(" · ") || type.nameVi;
}

export type FiledRequest = { requestId: string; submissionId: string; outcome: string };

export async function fileRequest(
  input: FileRequestInput,
  requester: { personId: string; entityId: string | null; unitPath: readonly string[]; managerId: string | null },
  formatMoney: (amount: number) => string,
  extras: FileExtras = {},
): Promise<FiledRequest> {
  return db().transaction(async (tx) => {
    const type = await findRequestTypeByCode(input.code, tx);
    if (!type || !type.active) throw new ActionError("request_type_not_found");
    if (type.entityId && type.entityId !== requester.entityId) throw new ActionError("request_type_not_for_entity");

    const { values, problems } = validateSubmission(type.form, input.values);
    // The form on screen checks the same rules; anything reaching here bypassed it.
    if (problems.length > 0) throw new ActionError(`form_value_${problems[0].problem}`, problems);

    const amountField = amountFieldOf(type.form);
    const amount = extras.amount ?? (amountField && typeof values[amountField] === "number" ? Math.round(values[amountField] as number) : null);
    const fileIds = [
      ...type.form.fields.filter((field) => field.type === "file").flatMap((field) => (Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [])),
      ...(extras.extraFileIds ?? []),
    ];

    const definition = genericRequestType(type);
    const { request, outcome } = await submitRequest(tx, definition, {
      entityId: requester.entityId,
      requesterPersonId: requester.personId,
      // A generic request is about its requester: "line manager" and "HR of…" resolve against them.
      subjectPersonId: requester.personId,
      subjectType: "request_type",
      subjectId: type.id,
      summary: summarize(type, values, formatMoney, extras.amount),
      // Answers live in the submission row; the engine's payload carries only what a flow tests.
      payload: { ...flowConditionData(type.form, values), ...extras.conditionData } as SubmitInput["payload"],
      link: (requestId) => `/approvals/request/${requestId}`,
    });

    const [submission] = await tx
      .insert(schema.requestSubmission)
      .values({ approvalRequestId: request.id, requestTypeId: type.id, typeCode: type.code, values, attachmentFileIds: fileIds.length ? fileIds : null, amount })
      .returning({ id: schema.requestSubmission.id });
    await extras.afterInsert?.(tx, submission.id);
    return { requestId: request.id, submissionId: submission.id, outcome };
  });
}

/** After "return for changes": the requester corrects the answers and sends it round again. */
export async function refileRequest(requestId: string, actorPersonId: string, values: FormValues, formatMoney: (amount: number) => string, extras: FileExtras = {}): Promise<{ requestId: string }> {
  return db().transaction(async (tx) => {
    const loaded = await loadSubmission(requestId, tx);
    if (!loaded) throw new ActionError("approval_not_found");
    const { type, submission } = loaded;
    const { values: clean, problems } = validateSubmission(type.form, values);
    if (problems.length > 0) throw new ActionError(`form_value_${problems[0].problem}`, problems);

    const amountField = amountFieldOf(type.form);
    const amount = extras.amount ?? (amountField && typeof clean[amountField] === "number" ? Math.round(clean[amountField] as number) : null);
    const fileIds = [
      ...type.form.fields.filter((field) => field.type === "file").flatMap((field) => (Array.isArray(clean[field.key]) ? (clean[field.key] as string[]) : [])),
      ...(extras.extraFileIds ?? []),
    ];

    await tx
      .update(schema.requestSubmission)
      .set({ values: clean, amount, attachmentFileIds: fileIds.length ? fileIds : null, updatedAt: new Date() })
      .where(eq(schema.requestSubmission.id, submission.id));
    await extras.afterInsert?.(tx, submission.id);
    await resubmitRequest(tx, genericRequestType(type), requestId, actorPersonId, {
      summary: summarize(type, clean, formatMoney, extras.amount),
      payload: { ...flowConditionData(type.form, clean), ...extras.conditionData } as SubmitInput["payload"],
    });
    return { requestId };
  });
}

/**
 * One approver's answer. A generic request has no effect of its own, so this is only the engine's
 * decision — but it goes through the same transaction as every other type, so the shape holds when
 * a type later grows one.
 */
export async function decideGenericRequest(requestId: string, actorPersonId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const loaded = await loadSubmission(requestId, tx);
    if (!loaded) throw new ActionError("approval_not_found");
    const decided = await decideRequest(tx, genericRequestType(loaded.type), requestId, actorPersonId, decision);
    // One type does have an effect: an approved expense claim becomes money in a payroll run. It
    // happens in this transaction, so a claim is never approved without being offered to payroll.
    if (decided.outcome === "approved" && loaded.type.code === EXPENSE_CLAIM_CODE) {
      await postApprovedClaim(tx, { submissionId: loaded.submission.id, personId: decided.request.requesterPersonId, entityId: decided.request.entityId, amount: loaded.submission.amount ?? 0 }, actorPersonId);
    }
    return decided;
  });
}

async function loadSubmission(requestId: string, executor: Executor): Promise<{ type: RequestTypeRow; submission: RequestSubmissionRow } | null> {
  const [row] = await executor
    .select({ submission: schema.requestSubmission, type: schema.requestType })
    .from(schema.requestSubmission)
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .where(eq(schema.requestSubmission.approvalRequestId, requestId))
    .limit(1);
  return row ?? null;
}

// ── Reading one ─────────────────────────────────────────────────────────────────────────────

export type GenericRequestView = RequestView & { type: RequestTypeRow; submission: RequestSubmissionRow };

export async function getGenericRequest(viewer: { personId: string; principal: Principal }, requestId: string): Promise<GenericRequestView | null> {
  const loaded = await loadSubmission(requestId, db());
  if (!loaded) return null;
  const view = await getRequest(viewer, genericRequestType(loaded.type), requestId);
  return view ? { ...view, ...loaded } : null;
}

// ── Tracking (FR-REQ-04) ────────────────────────────────────────────────────────────────────

export type SubmissionListRow = {
  requestId: string;
  code: string;
  nameVi: string;
  nameEn: string;
  summary: string;
  status: string;
  amount: number | null;
  requesterName: string;
  createdAt: Date;
  decidedAt: Date | null;
};

const listColumns = {
  requestId: schema.approvalRequest.id,
  code: schema.requestSubmission.typeCode,
  nameVi: schema.requestType.nameVi,
  nameEn: schema.requestType.nameEn,
  summary: schema.approvalRequest.summary,
  status: schema.approvalRequest.status,
  amount: schema.requestSubmission.amount,
  requesterName: schema.person.fullName,
  createdAt: schema.approvalRequest.createdAt,
  decidedAt: schema.approvalRequest.decidedAt,
};

const listFrom = () =>
  db()
    .select(listColumns)
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalRequest.requesterPersonId));

/** What this person has filed, newest first. */
export async function listMySubmissions(personId: string, limit = 100): Promise<SubmissionListRow[]> {
  return listFrom().where(eq(schema.approvalRequest.requesterPersonId, personId)).orderBy(desc(schema.approvalRequest.createdAt)).limit(limit);
}

/** Everything filed under the types an administrator looks after — the tracking screen. */
export async function listSubmissions(filter: { code?: string; status?: string } = {}, limit = 200): Promise<SubmissionListRow[]> {
  return listFrom()
    .where(and(filter.code ? eq(schema.requestSubmission.typeCode, filter.code) : undefined, filter.status ? eq(schema.approvalRequest.status, filter.status as "pending") : undefined))
    .orderBy(desc(schema.approvalRequest.createdAt))
    .limit(limit);
}

export type TypeStats = { code: string; nameVi: string; nameEn: string; open: number; decided: number; medianHours: number | null };

/**
 * How each type is doing (FR-REQ-04): how many are waiting, how many were answered, and how long
 * an answer took — the median, because one forgotten request should not colour the whole type.
 */
export async function requestTypeStats(): Promise<TypeStats[]> {
  const rows = await db()
    .select({
      code: schema.requestType.code,
      nameVi: schema.requestType.nameVi,
      nameEn: schema.requestType.nameEn,
      open: sql<number>`count(*) filter (where ${schema.approvalRequest.status} in ('pending', 'returned'))`,
      decided: sql<number>`count(*) filter (where ${schema.approvalRequest.decidedAt} is not null)`,
      medianSeconds: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${schema.approvalRequest.decidedAt} - ${schema.approvalRequest.createdAt})))`,
    })
    .from(schema.requestType)
    .leftJoin(schema.requestSubmission, eq(schema.requestSubmission.requestTypeId, schema.requestType.id))
    .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .groupBy(schema.requestType.id, schema.requestType.code, schema.requestType.nameVi, schema.requestType.nameEn, schema.requestType.sortOrder)
    .orderBy(schema.requestType.sortOrder, schema.requestType.code);
  return rows.map(({ medianSeconds, open, decided, ...row }) => ({
    ...row,
    open: Number(open),
    decided: Number(decided),
    medianHours: medianSeconds == null ? null : Math.round((Number(medianSeconds) / 3600) * 10) / 10,
  }));
}

/** The stored-file owner check: is this file an attachment of a request this person may open? */
export async function submissionOfFile(fileId: string): Promise<{ requestId: string } | null> {
  const [row] = await db()
    .select({ requestId: schema.requestSubmission.approvalRequestId })
    .from(schema.requestSubmission)
    .where(sql`${fileId}::uuid = any(${schema.requestSubmission.attachmentFileIds})`)
    .limit(1);
  return row ?? null;
}

/** Every generic type as the approval engine sees it — the composition root merges these in. */
export async function registeredGenericTypes(): Promise<{ row: RequestTypeRow; definition: RequestTypeDefinition }[]> {
  const rows = await listRequestTypes();
  return rows.map((row) => ({ row, definition: genericRequestType(row) }));
}

/** The names of the types behind a set of `request:<code>` approval types, for lists and cards. */
export async function requestTypeNames(approvalTypes: readonly string[]): Promise<Map<string, { vi: string; en: string }>> {
  const codes = [...new Set(approvalTypes.map(codeOfApprovalType).filter((code): code is string => !!code))];
  if (codes.length === 0) return new Map();
  const rows = await db().select({ code: schema.requestType.code, nameVi: schema.requestType.nameVi, nameEn: schema.requestType.nameEn }).from(schema.requestType).where(inArray(schema.requestType.code, codes));
  return new Map(rows.map((row) => [approvalTypeOf(row.code), { vi: row.nameVi, en: row.nameEn }]));
}
