// The generic request builder's use-cases (FR-REQ-01, 02, 04). The only entry point other modules
// and the composition root use.
//
// A request type defined in the database is turned into an ordinary `RequestTypeDefinition` by
// `genericRequestType`, so the approval engine treats it exactly like leave or a resignation: the
// same inbox, the same delegation, the same history, the same flow administration. What is *not*
// generic — the effect of an approval — is nothing here: a purchase request that is approved is
// simply approved, and finance reads it. Types whose approval must *do* something belong to the
// module that owns the doing.
//
// A request may be filed *under* another (FR-REQ-05): a business trip's advance, and the payment
// that settles it once the trip is over. The parent type's rules (engine/follow-ups.ts) say which
// types and when; the child is an ordinary request of its own type that remembers its parent.
import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestTypeDefinition, type RequestView, resubmitRequest, type SubmitInput, submitRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { carryOver, type FollowUpGate, type FollowUpRule, followUpGate, followUpProblems, LIVE_STATUSES } from "./engine/follow-ups";
import { conditionFieldsOf, flowConditionData, type FormDefinition, type FormValues, formProblems, validateSubmission } from "./engine/form";
import { ATTACHMENT_OWNER_TYPE, type RequestCategory } from "./enums";
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

// The catalogue is reference data read by every inbox and picker, so the whole (small) table lives
// in the shared cache (src/lib/cache). `saveRequestType` and `setRequestTypeActive` drop it once
// their change is committed; the TTL bounds writers outside the app (the seed script). The key
// carries the row's shape: an entry an older deployment stored has no follow-up rules in it.
const TYPES_CACHE = "requests:types:v2";
const TYPES_TTL = 60 * 60;

const readTypes = (executor: Executor) => executor.select().from(schema.requestType).orderBy(schema.requestType.sortOrder, schema.requestType.code);
const cachedTypes = () => cached(TYPES_CACHE, TYPES_TTL, () => readTypes(db()));

export async function listRequestTypes(options: { activeOnly?: boolean; executor?: Executor } = {}): Promise<RequestTypeRow[]> {
  // A transaction reads its own rows; everything else the cached catalogue.
  const rows = options.executor ? await readTypes(options.executor) : await cachedTypes();
  return options.activeOnly ? rows.filter((row) => row.active) : rows;
}

/** Read fresh, not from the cache: actions authorize on it. */
export async function findRequestType(id: string): Promise<RequestTypeRow | null> {
  const [row] = await db().select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1);
  return row ?? null;
}

export async function findRequestTypeByCode(code: string, executor?: Executor): Promise<RequestTypeRow | null> {
  if (!executor) return (await cachedTypes()).find((row) => row.code === code) ?? null;
  const [row] = await executor.select().from(schema.requestType).where(eq(schema.requestType.code, code)).limit(1);
  return row ?? null;
}

/**
 * The types this person may file on their own right now: active, either the group's or their own
 * entity's, and not one that is only ever filed under another request (FR-REQ-05).
 */
export async function listAvailableTypes(entityId: string | null): Promise<RequestTypeRow[]> {
  const rows = await listRequestTypes({ activeOnly: true });
  return rows.filter((row) => row.standalone && (row.entityId === null || row.entityId === entityId));
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
  followUps: FollowUpRule[];
  standalone: boolean;
};

export async function saveRequestType(id: string | null, input: SaveTypeInput, actorPersonId: string): Promise<{ before: RequestTypeRow | null; after: RequestTypeRow }> {
  const problems = formProblems(input.form);
  if (problems.length > 0) throw new ActionError(`form_${problems[0]}`);
  if (input.slaEscalateAfterDays > 0 && input.slaRemindAfterDays > 0 && input.slaEscalateAfterDays < input.slaRemindAfterDays) throw new ActionError("sla_escalate_before_remind");

  const result = await db().transaction(async (tx) => {
    const [before] = id ? await tx.select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1).for("update") : [];
    if (id && !before) throw new ActionError("request_type_not_found");
    // A code is part of every request already filed under it; renaming it would orphan them.
    if (before && before.code !== input.code) throw new ActionError("request_type_code_fixed");
    const [clash] = await tx.select({ id: schema.requestType.id }).from(schema.requestType).where(eq(schema.requestType.code, input.code)).limit(1);
    if (clash && clash.id !== id) throw new ActionError("request_type_code_taken");
    // Checked against the catalogue as this transaction sees it: a follow-up must name a type that
    // exists, and no type may end up under itself however deep the chain.
    const catalogue = await tx.select({ code: schema.requestType.code, followUps: schema.requestType.followUps }).from(schema.requestType);
    const followUpProblem = followUpProblems(input, catalogue)[0];
    if (followUpProblem) throw new ActionError(followUpProblem);

    const values = { ...input, updatedByPersonId: actorPersonId, updatedAt: new Date() };
    const [after] = before
      ? await tx.update(schema.requestType).set(values).where(eq(schema.requestType.id, before.id)).returning()
      : await tx.insert(schema.requestType).values(values).returning();
    return { before: before ?? null, after };
  });
  await invalidate(TYPES_CACHE);
  return result;
}

/** Switching a type off keeps every request filed under it; it only disappears from the picker. */
export async function setRequestTypeActive(id: string, active: boolean, actorPersonId: string): Promise<{ before: RequestTypeRow; after: RequestTypeRow }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.requestType).where(eq(schema.requestType.id, id)).limit(1).for("update");
    if (!before) throw new ActionError("request_type_not_found");
    const [after] = await tx.update(schema.requestType).set({ active, updatedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(schema.requestType.id, id)).returning();
    return { before, after };
  });
  await invalidate(TYPES_CACHE);
  return result;
}

// ── Filing one ──────────────────────────────────────────────────────────────────────────────

/** `parentRequestId`: the request this one is filed under (FR-REQ-05), when it is a follow-up. */
export type FileRequestInput = { code: string; values: FormValues; parentRequestId?: string | null };

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

/**
 * Every attachment id is a finished, not-deleted upload of a request attachment by the requester —
 * a request is not a way to reach somebody else's file by its id (the same rule as attendance
 * evidence). One query for all of them.
 */
async function checkAttachments(tx: Tx, fileIds: readonly string[], requesterPersonId: string): Promise<void> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) return;
  const [row] = await tx
    .select({ owned: count() })
    .from(schema.storedFile)
    .where(and(inArray(schema.storedFile.id, unique), eq(schema.storedFile.ownerType, ATTACHMENT_OWNER_TYPE), eq(schema.storedFile.ownerId, requesterPersonId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt)));
  if ((row?.owned ?? 0) !== unique.length) throw new ActionError("form_value_not_a_file");
}

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
    const parentSubmissionId = input.parentRequestId ? await checkParent(tx, input.parentRequestId, type.code, requester.personId) : null;
    if (!type.standalone && !parentSubmissionId) throw new ActionError("request_type_needs_parent");

    const { values, problems } = validateSubmission(type.form, input.values);
    // The form on screen checks the same rules; anything reaching here bypassed it.
    if (problems.length > 0) throw new ActionError(`form_value_${problems[0].problem}`, problems);

    const amountField = amountFieldOf(type.form);
    const amount = extras.amount ?? (amountField && typeof values[amountField] === "number" ? Math.round(values[amountField] as number) : null);
    const fileIds = [
      ...type.form.fields.filter((field) => field.type === "file").flatMap((field) => (Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [])),
      ...(extras.extraFileIds ?? []),
    ];
    await checkAttachments(tx, fileIds, requester.personId);

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
      .values({ approvalRequestId: request.id, requestTypeId: type.id, typeCode: type.code, values, attachmentFileIds: fileIds.length ? fileIds : null, amount, parentSubmissionId })
      .returning({ id: schema.requestSubmission.id });
    await extras.afterInsert?.(tx, submission.id);
    return { requestId: request.id, submissionId: submission.id, outcome };
  });
}

/**
 * May a request of `code` be filed under this parent, by this person, today? Returns the parent's
 * submission id, or throws the reason. The parent's submission row is locked first, so two
 * follow-ups sent together cannot both slip under a limit of one.
 */
async function checkParent(tx: Tx, parentRequestId: string, code: string, requesterPersonId: string): Promise<string> {
  const [parent] = await tx
    .select({ submission: schema.requestSubmission, followUps: schema.requestType.followUps, status: schema.approvalRequest.status, requesterPersonId: schema.approvalRequest.requesterPersonId })
    .from(schema.requestSubmission)
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .where(eq(schema.requestSubmission.approvalRequestId, parentRequestId))
    .limit(1)
    .for("update", { of: schema.requestSubmission });
  // Somebody else's trip is not a way to reach an advance: only its requester files under it.
  if (!parent || parent.requesterPersonId !== requesterPersonId) throw new ActionError("follow_up_parent_not_found");
  const rule = parent.followUps.find((entry) => entry.code === code);
  if (!rule) throw new ActionError("follow_up_not_allowed");

  const [row] = await tx
    .select({ live: count() })
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .where(and(eq(schema.requestSubmission.parentSubmissionId, parent.submission.id), eq(schema.requestSubmission.typeCode, code), inArray(schema.approvalRequest.status, [...LIVE_STATUSES])));
  const gate = followUpGate(rule, { status: parent.status, values: parent.submission.values as FormValues }, Number(row?.live ?? 0), todayInVietnam());
  if (!gate.open) throw new ActionError(`follow_up_${gate.reason}`);
  return parent.submission.id;
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
    // Only the requester sends a returned request round again (the engine refuses anyone else).
    await checkAttachments(tx, fileIds, actorPersonId);

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

// ── A request's family (FR-REQ-05) ──────────────────────────────────────────────────────────

/** One request above or below the one on screen: enough to recognise it and follow the link. */
export type FamilyMember = { requestId: string; code: string; nameVi: string; nameEn: string; summary: string; status: string; amount: number | null; createdAt: Date };

/** One follow-up type the parent's rules name, with how it stands under this parent. */
export type FollowUpStanding = {
  code: string;
  nameVi: string;
  nameEn: string;
  /** How many still count against the rule's limit, and what the approved ones come to. */
  live: number;
  approvedAmount: number;
  /** For the parent's requester only: whether they may file one now, and if not, why. */
  gate: FollowUpGate | null;
};

export type RequestFamily = { parent: FamilyMember | null; children: FamilyMember[]; followUps: FollowUpStanding[] };

const memberColumns = {
  requestId: schema.approvalRequest.id,
  code: schema.requestSubmission.typeCode,
  nameVi: schema.requestType.nameVi,
  nameEn: schema.requestType.nameEn,
  summary: schema.approvalRequest.summary,
  status: schema.approvalRequest.status,
  amount: schema.requestSubmission.amount,
  createdAt: schema.approvalRequest.createdAt,
};

const members = () =>
  db()
    .select(memberColumns)
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId));

/**
 * The request a viewed one was filed under, the ones filed under it, and — for its requester —
 * which follow-ups they may file now. Whoever may open the request sees the summary line of its
 * parent and of its children (the same line an inbox shows); opening one of them is that request's
 * own access rule, so an advance's approver reads which trip it is for without being let into it.
 */
export async function getRequestFamily(view: GenericRequestView, requester: { entityId: string | null }): Promise<RequestFamily> {
  const { submission, type } = view;
  const rules = type.followUps;
  const [parentRows, children, totals, catalogue] = await Promise.all([
    submission.parentSubmissionId ? members().where(eq(schema.requestSubmission.id, submission.parentSubmissionId)).limit(1) : Promise.resolve([]),
    members().where(eq(schema.requestSubmission.parentSubmissionId, submission.id)).orderBy(schema.approvalRequest.createdAt),
    rules.length
      ? db()
          .select({
            code: schema.requestSubmission.typeCode,
            live: sql<number>`count(*) filter (where ${inArray(schema.approvalRequest.status, [...LIVE_STATUSES])})`,
            approvedAmount: sql<number>`coalesce(sum(${schema.requestSubmission.amount}) filter (where ${schema.approvalRequest.status} = 'approved'), 0)`,
          })
          .from(schema.requestSubmission)
          .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
          .where(eq(schema.requestSubmission.parentSubmissionId, submission.id))
          .groupBy(schema.requestSubmission.typeCode)
      : Promise.resolve([]),
    rules.length ? cachedTypes() : Promise.resolve([]),
  ]);

  const byCode = new Map(catalogue.map((row) => [row.code, row]));
  const totalsByCode = new Map(totals.map((row) => [row.code, { live: Number(row.live), approvedAmount: Number(row.approvedAmount) }]));
  const today = todayInVietnam();
  const followUps = rules.flatMap((rule): FollowUpStanding[] => {
    const child = byCode.get(rule.code);
    if (!child) return [];
    const { live, approvedAmount } = totalsByCode.get(rule.code) ?? { live: 0, approvedAmount: 0 };
    // A type switched off, or kept to another entity, is still listed for what was filed under it,
    // but offers nothing new.
    const fileable = view.isRequester && child.active && (child.entityId === null || child.entityId === requester.entityId);
    const gate = fileable ? followUpGate(rule, { status: view.request.status, values: submission.values as FormValues }, live, today) : null;
    if (!fileable && live === 0 && !children.some((row) => row.code === rule.code)) return [];
    return [{ code: child.code, nameVi: child.nameVi, nameEn: child.nameEn, live, approvedAmount, gate }];
  });
  return { parent: parentRows[0] ?? null, children, followUps };
}

/**
 * The parent a follow-up is being filed under, checked for the filing page before the form is
 * drawn — the same rule `fileRequest` applies again when it is sent. `null` = not this person's, or
 * not a parent this type may be filed under at all.
 */
export async function followUpContext(
  viewer: { personId: string; principal: Principal; entityId: string | null },
  parentRequestId: string,
  child: RequestTypeRow,
): Promise<{ parent: GenericRequestView; gate: FollowUpGate; values: FormValues } | null> {
  const parent = await getGenericRequest(viewer, parentRequestId);
  if (!parent || !parent.isRequester) return null;
  const family = await getRequestFamily(parent, { entityId: viewer.entityId });
  const standing = family.followUps.find((entry) => entry.code === child.code);
  if (!standing?.gate) return null;
  return { parent, gate: standing.gate, values: carryOver(parent.type.form, parent.submission.values as FormValues, child.form) };
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
  /** FR-REQ-05: the request this one was filed under, and its type's name. */
  parentRequestId: string | null;
  parentNameVi: string | null;
  parentNameEn: string | null;
};

const parentSubmission = alias(schema.requestSubmission, "parent_submission");
const parentType = alias(schema.requestType, "parent_type");

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
  parentRequestId: parentSubmission.approvalRequestId,
  parentNameVi: parentType.nameVi,
  parentNameEn: parentType.nameEn,
};

const listFrom = () =>
  db()
    .select(listColumns)
    .from(schema.requestSubmission)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.requestSubmission.approvalRequestId))
    .innerJoin(schema.requestType, eq(schema.requestType.id, schema.requestSubmission.requestTypeId))
    .innerJoin(schema.person, eq(schema.person.id, schema.approvalRequest.requesterPersonId))
    .leftJoin(parentSubmission, eq(parentSubmission.id, schema.requestSubmission.parentSubmissionId))
    .leftJoin(parentType, eq(parentType.id, parentSubmission.requestTypeId));

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
  const wanted = new Set(codes);
  const rows = (await cachedTypes()).filter((row) => wanted.has(row.code));
  return new Map(rows.map((row) => [approvalTypeOf(row.code), { vi: row.nameVi, en: row.nameEn }]));
}
