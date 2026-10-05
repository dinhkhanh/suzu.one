// Resignation requests (FR-CHR-11): the second request type on the approval engine. The employee
// files it from "My profile"; the line manager answers (the engine falls back to the owners when
// there is none); an approval becomes a *pending* resignation event. HR then carries it out as a
// termination from the person page — the last day, notice period and handover are HR's to
// confirm, so the approval itself ends nothing.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { notify } from "@/modules/platform/notifications/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { recordLifecycleEvent } from "./lifecycle-events";
import { getPersonTarget, inTransaction } from "./service";

export type ResignationPayload = { lastWorkingDay: IsoDate; reason: string | null };

export const resignationRequest = defineRequestType({
  type: "resignation",
  flow: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] },
  // HR follows every resignation in their scope from the start.
  canView: (viewer, subject) => !!subject && can(viewer, "person:manage", subject),
});

export type ResignationBlocker = "no_employment" | "already_terminated" | "resignation_open" | "resignation_approved";

/**
 * Why this person may not file a resignation now, or null when they may. Everything is asked of
 * the **current** employment: a resignation approved during an earlier one (before a rehire), or
 * one whose termination HR called off, no longer stands in the way. What does: an end date already
 * set, a request still waiting for an answer, or an approved resignation HR has yet to carry out.
 */
export async function resignationBlocker(personId: string, executor: Tx | ReturnType<typeof db> = db()): Promise<ResignationBlocker | null> {
  const [employment] = await executor.select().from(schema.employment).where(eq(schema.employment.personId, personId)).orderBy(desc(schema.employment.startDate)).limit(1);
  if (!employment) return "no_employment";
  if (employment.endDate) return "already_terminated";
  const [open] = await executor
    .select({ id: schema.approvalRequest.id })
    .from(schema.approvalRequest)
    .where(and(eq(schema.approvalRequest.type, resignationRequest.type), eq(schema.approvalRequest.subjectPersonId, personId), inArray(schema.approvalRequest.status, ["pending", "returned"])))
    .limit(1);
  if (open) return "resignation_open";
  const [approved] = await executor
    .select({ id: schema.lifecycleEvent.id })
    .from(schema.lifecycleEvent)
    .where(and(eq(schema.lifecycleEvent.employmentId, employment.id), eq(schema.lifecycleEvent.type, "resignation"), eq(schema.lifecycleEvent.status, "pending")))
    .limit(1);
  return approved ? "resignation_approved" : null;
}

export async function submitResignation(personId: string, input: ResignationPayload) {
  return inTransaction(async (tx) => {
    const target = await getPersonTarget(personId, tx);
    if (!target?.entityId) throw new ActionError("no_employment");
    const blocker = await resignationBlocker(personId, tx);
    if (blocker) throw new ActionError(blocker);
    if (input.lastWorkingDay < todayInVietnam()) throw new ActionError("resignation_date_past");

    const { request } = await submitRequest(tx, resignationRequest, {
      entityId: target.entityId,
      requesterPersonId: personId,
      subjectPersonId: personId,
      // Read by the manager in the inbox and the email, in Vietnamese like the other summaries.
      summary: `Ngày làm việc cuối: ${input.lastWorkingDay.split("-").reverse().join("/")}`,
      payload: input,
      link: (requestId) => `/approvals/resignation/${requestId}`,
    });
    return { request };
  });
}

export async function decideResignation(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return inTransaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, resignationRequest, requestId, actorPersonId, decision);
    let eventId: string | null = null;
    if (outcome === "approved" && request.subjectPersonId) {
      const payload = request.payload as ResignationPayload;
      const [latest] = await tx.select().from(schema.employment).where(eq(schema.employment.personId, request.subjectPersonId)).orderBy(desc(schema.employment.startDate)).limit(1);
      if (!latest) throw new ActionError("no_employment");
      const event = await recordLifecycleEvent(
        tx,
        { personId: request.subjectPersonId, employmentId: latest.id, entityId: latest.entityId, type: "resignation", effectiveDate: payload.lastWorkingDay, status: "pending", reason: payload.reason, approvalRequestId: request.id },
        actorPersonId,
      );
      eventId = event.id;
      // HR's cue to prepare the termination and the offboarding checklist.
      const target = await getPersonTarget(request.subjectPersonId, tx);
      const [person] = await tx.select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, request.subjectPersonId)).limit(1);
      const hr = target ? await listPeopleHolding("person:manage", target, { includeWildcard: false, executor: tx }) : [];
      await notify({ recipients: hr.filter((id) => id !== request.subjectPersonId), kind: "hr.resignation_approved", params: { name: person?.fullName ?? "", date: payload.lastWorkingDay }, link: `/people/${request.subjectPersonId}` }, tx);
    }
    return { request, before, outcome, eventId };
  });
}

export type ResignationView = RequestView & { payload: ResignationPayload };

export async function getResignation(viewer: { personId: string; principal: Principal }, requestId: string): Promise<ResignationView | null> {
  const view = await getRequest(viewer, resignationRequest, requestId);
  return view ? { ...view, payload: view.request.payload as ResignationPayload } : null;
}
