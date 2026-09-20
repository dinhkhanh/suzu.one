// The SLA job (FR-PLT-23): nudge an approver who has left a request sitting, and escalate when
// still nobody has answered. Runs daily on the ordinary jobs framework, and is idempotent — the
// marks on the assignee row make a nudge and an escalation happen once per turn, so running it
// twice in one morning sends nothing twice.
//
// Only the request builder's types have an SLA today (it is configuration on the type). A type in
// code that wants one adds a row; nothing here is specific to a particular form.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { issueActionToken } from "@/modules/platform/approvals/action-tokens";
import { resolveApprovers } from "@/modules/platform/approvals/service";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { notify } from "@/modules/platform/notifications/service";
import { slaActionFor } from "./engine/sla";
import { approvalTypeOf } from "./service";

export type SlaResult = { checked: number; reminded: number; escalated: number };

export async function runRequestSla(now: Date = new Date()): Promise<SlaResult> {
  const types = await db().select().from(schema.requestType).where(eq(schema.requestType.active, true));
  const watched = types.filter((type) => type.slaRemindAfterDays > 0 || (type.slaEscalateAfterDays > 0 && type.slaEscalateTo));
  const result: SlaResult = { checked: 0, reminded: 0, escalated: 0 };
  if (watched.length === 0) return result;

  const byApprovalType = new Map(watched.map((type) => [approvalTypeOf(type.code), type]));
  // Every turn that is genuinely open: the request is pending, the step is the open one, and this
  // approver has not answered. `waitingSince` is when the step opened, which for the first step is
  // when the request was filed and afterwards when the previous step was approved.
  const turns = await db()
    .select({
      assigneeId: schema.approvalAssignee.id,
      requestId: schema.approvalRequest.id,
      approverPersonId: schema.approvalAssignee.approverPersonId,
      remindedAt: schema.approvalAssignee.remindedAt,
      escalatedAt: schema.approvalAssignee.escalatedAt,
      type: schema.approvalRequest.type,
      typeName: schema.approvalRequest.typeName,
      summary: schema.approvalRequest.summary,
      link: schema.approvalRequest.link,
      entityId: schema.approvalRequest.entityId,
      requesterPersonId: schema.approvalRequest.requesterPersonId,
      subjectPersonId: schema.approvalRequest.subjectPersonId,
      waitingSince: sql<Date>`greatest(${schema.approvalRequest.createdAt}, ${schema.approvalRequest.updatedAt})`,
    })
    .from(schema.approvalAssignee)
    .innerJoin(schema.approvalStep, eq(schema.approvalStep.id, schema.approvalAssignee.stepId))
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.approvalAssignee.requestId))
    .where(and(eq(schema.approvalAssignee.status, "pending"), eq(schema.approvalStep.status, "pending"), eq(schema.approvalRequest.status, "pending")));

  for (const turn of turns) {
    const type = byApprovalType.get(turn.type);
    if (!type) continue;
    result.checked++;
    const waitingSince = new Date(turn.waitingSince);
    const action = slaActionFor(
      { remindAfterDays: type.slaRemindAfterDays, escalateAfterDays: type.slaEscalateAfterDays, hasEscalationTarget: !!type.slaEscalateTo },
      { waitingSince, remindedAt: turn.remindedAt, escalatedAt: turn.escalatedAt },
      now,
    );
    if (action === "none") continue;

    const days = Math.floor((now.getTime() - waitingSince.getTime()) / (24 * 60 * 60 * 1000));
    const params = { requestType: turn.typeName ?? turn.type, summary: turn.summary, days };

    if (action === "remind") {
      // Claim it first: two runs of the job at once must not send two nudges.
      const [claimed] = await db()
        .update(schema.approvalAssignee)
        .set({ remindedAt: now })
        .where(and(eq(schema.approvalAssignee.id, turn.assigneeId), isNull(schema.approvalAssignee.remindedAt)))
        .returning({ id: schema.approvalAssignee.id });
      if (!claimed) continue;
      const { path } = await issueActionToken(db(), turn.requestId, turn.approverPersonId, now);
      await notify({ recipients: [turn.approverPersonId], kind: "approvals.sla_reminder", params, link: turn.link, chat: { actionPath: path, actionLabel: "Duyệt" } });
      result.reminded++;
      continue;
    }

    const [claimed] = await db()
      .update(schema.approvalAssignee)
      .set({ escalatedAt: now })
      .where(and(eq(schema.approvalAssignee.id, turn.assigneeId), isNull(schema.approvalAssignee.escalatedAt)))
      .returning({ id: schema.approvalAssignee.id });
    if (!claimed) continue;

    // Whoever the type names, resolved against the *approver* who is sitting on it — "their own
    // manager" means the silent approver's manager, not the requester's.
    const escalateTo = (await resolveApprovers(db(), type.slaEscalateTo as never, turn.approverPersonId, { entityId: turn.entityId })).filter((personId) => personId !== turn.approverPersonId);
    if (escalateTo.length === 0) continue;
    const approverName = await personName(turn.approverPersonId);
    // The escalation does *not* carry an approve link: the point is that someone looks at why it
    // has been sitting there, not that a second person rubber-stamps it from a notification.
    await notify({ recipients: escalateTo, kind: "approvals.sla_escalated", params: { ...params, approver: approverName }, link: turn.link });
    result.escalated++;
  }
  return result;
}

async function personName(personId: string): Promise<string> {
  const [row] = await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  return row?.fullName ?? "—";
}

export const requestSlaJob: JobDefinition = {
  name: "request-sla",
  run: async () => runRequestSla(),
};
