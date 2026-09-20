// Hiring requests (FR-REC-01): a manager asks for a head, the ask is approved, the approved ask
// becomes an opening with nothing retyped.
//
// The request rides the existing approval engine, so it gets the inbox, delegation, the SLA clock,
// deep links from a notification and bulk approve for free. Two things about how it is wired:
//
//   · **The payload carries no money.** A request's payload and summary are read by approvers, the
//     inbox, notifications, Google Chat cards and the audit log. The budget is a compensation-tier
//     fact, so it stays on the `hiring_request` row where `policy.ts` decides who is shown it, and
//     the payload holds nothing but the id and the plain facts of the ask.
//   · **Approval does not create the opening.** It authorises one. A recruiter then writes the
//     advertisement from the approved ask — which is the point at which somebody decides what the
//     job is actually called and what the pipeline should be.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { notify } from "@/modules/platform/notifications/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import type { EmploymentType } from "./enums";
import { canReadRecruitMoney } from "./policy";
import { findHiringRequest, type HiringRequestRow, inTransaction } from "./service";

/** What the approval request's payload holds — deliberately no figure among it. */
export type HiringRequestPayload = { hiringRequestId: string; positionTitle: string; headcount: number; employmentType: EmploymentType; targetStartDate: IsoDate | null };

/**
 * Line manager, then whoever runs recruitment where the head would sit. The second step is a
 * `permission` rule rather than a role, so the flow keeps working whichever of `hr_admin`,
 * `hr_staff` or `recruiter` the company actually grants. An administrator overrides the whole
 * thing per entity in Admin → Approval flows, and can test `headcount` to add a step.
 */
export const hiringRequestType = defineRequestType({
  type: "hiring",
  flow: {
    steps: [
      { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
      { key: "recruitment", mode: "any", approvers: [{ rule: "permission", permission: "recruit:manage" }] },
    ],
  },
  conditionFields: ["headcount"],
  // Never bulk-approvable: a head is a budget decision, and the budget is on the request's own
  // page rather than in the summary the inbox shows.
  bulkApprovable: () => false,
  canView: (viewer, subject) => can(viewer, "recruit:manage", subject ?? {}),
});

export type HiringRequestInput = {
  entityId: string;
  departmentId: string | null;
  teamId: string | null;
  positionTitle: string;
  jobLevel: string | null;
  headcount: number;
  employmentType: EmploymentType;
  workLocation: string | null;
  reason: string;
  targetStartDate: IsoDate | null;
  hiringManagerPersonId: string | null;
};

export type HiringBudgetInput = { budgetMinVnd: number | null; budgetMaxVnd: number | null };

function checkBudget(budget: HiringBudgetInput) {
  for (const value of [budget.budgetMinVnd, budget.budgetMaxVnd]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new ActionError("recruit_budget_invalid");
  if (budget.budgetMinVnd !== null && budget.budgetMaxVnd !== null && budget.budgetMinVnd > budget.budgetMaxVnd) throw new ActionError("recruit_budget_range_invalid");
}

/**
 * Files the ask. `budget` is null when the person filing may not read compensation — they ask for
 * a head and leave the money to whoever sets bands, which is the common case for a team lead.
 */
export async function submitHiringRequest(input: HiringRequestInput, budget: HiringBudgetInput | null, requestedByPersonId: string): Promise<{ hiringRequest: HiringRequestRow; requestId: string }> {
  if (!Number.isSafeInteger(input.headcount) || input.headcount < 1 || input.headcount > 100) throw new ActionError("recruit_headcount_invalid");
  if (input.targetStartDate && input.targetStartDate < todayInVietnam()) throw new ActionError("recruit_start_date_past");
  if (budget) checkBudget(budget);

  return inTransaction(async (tx) => {
    const [entity] = await tx.select({ id: schema.entity.id, isActive: schema.entity.isActive }).from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
    if (!entity?.isActive) throw new ActionError("recruit_entity_not_found");

    const [hiringRequest] = await tx
      .insert(schema.hiringRequest)
      .values({
        ...input,
        ...(budget ?? { budgetMinVnd: null, budgetMaxVnd: null }),
        hiringManagerPersonId: input.hiringManagerPersonId ?? requestedByPersonId,
        requestedByPersonId,
        status: "pending",
      })
      .returning();

    const payload: HiringRequestPayload = {
      hiringRequestId: hiringRequest.id,
      positionTitle: hiringRequest.positionTitle,
      headcount: hiringRequest.headcount,
      employmentType: hiringRequest.employmentType,
      targetStartDate: hiringRequest.targetStartDate as IsoDate | null,
    };
    const { request } = await submitRequest(tx, hiringRequestType, {
      entityId: hiringRequest.entityId,
      requesterPersonId: requestedByPersonId,
      // The ask is about a job, not about a person — but the flow's line-manager step has to
      // resolve against somebody, and that somebody is the manager who is asking.
      subjectPersonId: requestedByPersonId,
      subjectType: "hiring_request",
      subjectId: hiringRequest.id,
      // Read in an inbox, an email and a chat card. Never a figure.
      summary: `${hiringRequest.positionTitle} × ${hiringRequest.headcount}`,
      payload: payload as unknown as Record<string, unknown>,
      conditionData: { headcount: hiringRequest.headcount },
      link: (requestId) => `/recruit/hiring/${hiringRequest.id}?request=${requestId}`,
      target: { entityId: hiringRequest.entityId, departmentId: hiringRequest.departmentId, teamId: hiringRequest.teamId },
    });
    await tx.update(schema.hiringRequest).set({ approvalRequestId: request.id, updatedAt: new Date() }).where(eq(schema.hiringRequest.id, hiringRequest.id));
    return { hiringRequest: { ...hiringRequest, approvalRequestId: request.id }, requestId: request.id };
  });
}

/**
 * One approver's answer. An approval marks the ask approved and tells the recruiters there is a
 * head to fill; it does not create an opening, because writing the advertisement is a separate
 * piece of work by a different person.
 */
export async function decideHiringRequest(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return inTransaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, hiringRequestType, requestId, actorPersonId, decision);
    const hiringRequestId = (request.payload as unknown as HiringRequestPayload).hiringRequestId;
    let hiringRequest: HiringRequestRow | undefined;

    if (outcome === "approved" || outcome === "rejected") {
      [hiringRequest] = await tx
        .update(schema.hiringRequest)
        .set({ status: outcome === "approved" ? "approved" : "rejected", updatedAt: new Date() })
        .where(and(eq(schema.hiringRequest.id, hiringRequestId), inArray(schema.hiringRequest.status, ["pending"])))
        .returning();
    }

    if (outcome === "approved" && hiringRequest) {
      const target = { entityId: hiringRequest.entityId, departmentId: hiringRequest.departmentId, teamId: hiringRequest.teamId };
      const recruiters = await listPeopleHolding("recruit:manage", target, { includeWildcard: false, executor: tx });
      await notify(
        {
          recipients: recruiters.filter((id) => id !== actorPersonId),
          kind: "recruit.hiring_approved",
          params: { title: hiringRequest.positionTitle, count: String(hiringRequest.headcount) },
          link: `/recruit/hiring/${hiringRequest.id}`,
        },
        tx,
      );
    }
    return { request, before, outcome, hiringRequestId, hiringRequest };
  });
}

/** Withdrawing the ask before anybody has answered it — the requester's own doing. */
export async function markHiringRequestWithdrawn(tx: Tx, hiringRequestId: string): Promise<void> {
  await tx.update(schema.hiringRequest).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(schema.hiringRequest.id, hiringRequestId));
}

export type HiringRequestView = {
  hiringRequest: HiringRequestRow;
  entityName: string | null;
  departmentName: string | null;
  requesterName: string;
  hiringManagerName: string | null;
  /** Cut by tier before it leaves the service: null = "not yours to see", not "there is none". */
  budget: { minVnd: number | null; maxVnd: number | null } | null;
  approval: RequestView | null;
};

export async function getHiringRequestView(viewer: { principal: Principal; personId: string }, hiringRequestId: string): Promise<HiringRequestView | null> {
  const hiringRequest = await findHiringRequest(hiringRequestId);
  if (!hiringRequest) return null;

  const approval = hiringRequest.approvalRequestId ? await getRequest(viewer, hiringRequestType, hiringRequest.approvalRequestId) : null;
  const target = { entityId: hiringRequest.entityId, departmentId: hiringRequest.departmentId, teamId: hiringRequest.teamId };
  const mine = viewer.personId === hiringRequest.requestedByPersonId || viewer.personId === hiringRequest.hiringManagerPersonId;
  // An approver reaches it through the approval engine, which has already decided they are a party
  // to the request; everybody else goes through the module's own rule.
  if (!approval && !mine && !can(viewer.principal, "recruit:manage", target)) return null;

  const [entity] = await db().select({ shortName: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, hiringRequest.entityId)).limit(1);
  const [department] = hiringRequest.departmentId ? await db().select({ name: schema.department.name }).from(schema.department).where(eq(schema.department.id, hiringRequest.departmentId)).limit(1) : [undefined];
  const [requester] = await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, hiringRequest.requestedByPersonId)).limit(1);
  const [manager] = hiringRequest.hiringManagerPersonId
    ? await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, hiringRequest.hiringManagerPersonId)).limit(1)
    : [undefined];

  return {
    hiringRequest,
    entityName: entity?.shortName ?? null,
    departmentName: department?.name ?? null,
    requesterName: requester?.fullName ?? "",
    hiringManagerName: manager?.fullName ?? null,
    budget: canReadRecruitMoney(viewer.principal, target) ? { minVnd: hiringRequest.budgetMinVnd, maxVnd: hiringRequest.budgetMaxVnd } : null,
    approval,
  };
}
