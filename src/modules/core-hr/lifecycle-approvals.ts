// Configurable approval for a transfer, a promotion and a termination (FR-CHR-09). Three request
// types on the approval engine, one per change, each asked **only where an administrator has saved
// a flow for it** — for one entity or for the group, in the flow administration. Without one, HR's
// change applies at once, exactly as it always has; with one, HR's change becomes a proposal, and
// the final approval applies it in the approval's own transaction, in the proposer's name.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import vi from "../../../messages/vi.json";
import { decideRequest, defineRequestType, getRequest, hasConfiguredFlow, type RequestTypeDefinition, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { invalidateGrants } from "@/modules/platform/rbac/service";
import { type TerminationInput, terminateEmploymentIn } from "./lifecycle";
import { type AssignmentChangeKind, changeAssignmentIn, getPersonTarget, inTransaction, invalidatePersonView, type PlacementInput } from "./service";

// The default flow is what the flow administration starts from; it is not asked until a flow is
// saved. HR follows every one of these about people in their scope.
const define = (type: string) =>
  defineRequestType({
    type,
    flow: { steps: [{ key: "owner", mode: "any", approvers: [{ rule: "role", role: "owner" }] }] },
    canView: (viewer, subject) => !!subject && can(viewer, "person:manage", subject),
  });

export const transferApprovalType = define("lifecycle_transfer");
export const promotionApprovalType = define("lifecycle_promotion");
export const terminationApprovalType = define("lifecycle_termination");
const TYPES: readonly RequestTypeDefinition[] = [transferApprovalType, promotionApprovalType, terminationApprovalType];
export const LIFECYCLE_APPROVAL_TYPES = TYPES.map((definition) => definition.type);

export type AssignmentChangePayload = { kind: "transfer" | "promotion"; validFrom: IsoDate; changeReason: string | null; placement: PlacementInput };
export type TerminationPayload = Omit<TerminationInput, "resignationEventId"> & { resignationEventId: string | null };
export type LifecyclePayload = AssignmentChangePayload | TerminationPayload;

const typeFor = (kind: "transfer" | "promotion" | "termination") => (kind === "transfer" ? transferApprovalType : kind === "promotion" ? promotionApprovalType : terminationApprovalType);

/** Does this change wait for an approval in this entity? Only where a flow was saved for it. */
export async function changeNeedsApproval(kind: AssignmentChangeKind | "termination", entityId: string | null): Promise<boolean> {
  if (kind === "correction") return false;
  return hasConfiguredFlow(typeFor(kind), entityId);
}

// Read by the approver in the inbox and the email, in Vietnamese like the other summaries.
const word = createTranslator({ locale: "vi", messages: vi, namespace: "lifecycle" });
const day = (date: IsoDate) => date.split("-").reverse().join("/");

async function file(kind: "transfer" | "promotion" | "termination", personId: string, payload: LifecyclePayload, summary: string, actorPersonId: string) {
  const definition = typeFor(kind);
  return inTransaction(async (tx) => {
    const target = await getPersonTarget(personId, tx);
    if (!target?.entityId) throw new ActionError("no_employment");
    const [open] = await tx
      .select({ id: schema.approvalRequest.id })
      .from(schema.approvalRequest)
      .where(and(eq(schema.approvalRequest.type, definition.type), eq(schema.approvalRequest.subjectPersonId, personId), inArray(schema.approvalRequest.status, ["pending", "returned"])))
      .limit(1);
    if (open) throw new ActionError("lifecycle_change_open");
    const { request, outcome } = await submitRequest(tx, definition, {
      entityId: target.entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: personId,
      summary,
      payload,
      link: (requestId) => `/approvals/lifecycle/${requestId}`,
    });
    // A flow that names nobody (the proposer is its only approver) approves at once: apply it now.
    if (outcome === "approved") await apply(tx, request.type, personId, payload, actorPersonId);
    return { request, outcome };
  });
}

/** A transfer or promotion put up for approval instead of applied. */
export function proposeAssignmentChange(personId: string, input: AssignmentChangePayload, actorPersonId: string) {
  return file(input.kind, personId, input, `${word(`types.${input.kind}`)} — hiệu lực ${day(input.validFrom)}`, actorPersonId);
}

/** A termination put up for approval instead of carried out. */
export function proposeTermination(personId: string, input: TerminationPayload, actorPersonId: string) {
  return file("termination", personId, input, `${word("types.termination")} — ngày làm việc cuối ${day(input.lastDay)} (${word(`reasons.${input.reason}` as "reasons.other")})`, actorPersonId);
}

async function apply(tx: Parameters<Parameters<typeof inTransaction>[0]>[0], type: string, personId: string, payload: LifecyclePayload, proposerPersonId: string) {
  if (type === terminationApprovalType.type) {
    const termination = payload as TerminationPayload;
    // The day may have been meant as "from tomorrow" when it was proposed; it is carried out as asked.
    await terminateEmploymentIn(tx, personId, { ...termination, resignationEventId: termination.resignationEventId }, proposerPersonId);
    return;
  }
  const change = payload as AssignmentChangePayload;
  await changeAssignmentIn(tx, personId, { validFrom: change.validFrom, changeReason: change.changeReason, placement: change.placement, kind: change.kind }, proposerPersonId);
}

/** One approver's answer; the final approval carries the change out, in the proposer's name. */
export async function decideLifecycleChange(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  const [row] = await db().select({ type: schema.approvalRequest.type }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  const definition = TYPES.find((type) => type.type === row?.type);
  if (!definition) throw new ActionError("request_not_found");
  const result = await inTransaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, definition, requestId, actorPersonId, decision);
    if (outcome === "approved" && request.subjectPersonId) await apply(tx, request.type, request.subjectPersonId, request.payload as LifecyclePayload, request.requesterPersonId);
    return { request, before, outcome };
  });
  if (result.outcome === "approved" && result.request.subjectPersonId) {
    await invalidatePersonView(result.request.subjectPersonId);
    if (definition === terminationApprovalType) await invalidateGrants(result.request.subjectPersonId);
  }
  return result;
}

export type LifecycleChangeView = RequestView & { payload: LifecyclePayload; kind: "transfer" | "promotion" | "termination" };

export async function getLifecycleChange(viewer: { personId: string; principal: Principal }, requestId: string): Promise<LifecycleChangeView | null> {
  const [row] = await db().select({ type: schema.approvalRequest.type }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId)).limit(1);
  const definition = TYPES.find((type) => type.type === row?.type);
  if (!definition) return null;
  const view = await getRequest(viewer, definition, requestId);
  const kind = definition === transferApprovalType ? "transfer" : definition === promotionApprovalType ? "promotion" : "termination";
  return view ? { ...view, payload: view.request.payload as LifecyclePayload, kind } : null;
}

/** The names behind a proposed placement — the unit, the branch and the manager — for the approval page. */
export async function placementNames(placement: PlacementInput): Promise<{ unit: string | null; branch: string | null; manager: string | null }> {
  const [[unit], [branch], [manager]] = await Promise.all([
    placement.orgUnitId ? db().select({ name: schema.orgUnit.name }).from(schema.orgUnit).where(eq(schema.orgUnit.id, placement.orgUnitId)).limit(1) : [],
    placement.branchId ? db().select({ name: schema.branch.name }).from(schema.branch).where(eq(schema.branch.id, placement.branchId)).limit(1) : [],
    placement.managerId ? db().select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, placement.managerId)).limit(1) : [],
  ]);
  return { unit: unit?.name ?? null, branch: branch?.name ?? null, manager: manager?.name ?? null };
}
