// The kick-off gate (FR-PJM-03): the brief goes to the approval engine before the project becomes
// Active. The approver is a lead of the project's team — asked by name, since "a lead of this work
// team" is not an org-chart rule — and the engine falls back to the owners when there is none (or
// the only lead is the author). Approved → the brief is frozen, the baseline is taken and a planned
// project becomes active, all in the decision's transaction. Returned → the author edits and sends
// the same request round again. A project whose brief is not approved stays planned: tasks can
// still be made (the gate is shown, never forced on the work).
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestTypeDefinition, type RequestView, resubmitRequest, submitRequest } from "../platform/approvals/service";
import type { Principal } from "../platform/rbac/policy";
import { captureProjectBaseline, captureTaskBaselines } from "./baselines";
import { briefProblems, type BriefStatus, briefSubmittable, type ProjectKind } from "./engine/brief";
import { ensurePlan, type PlanRow, reconcileBrief } from "./plans";

export type BriefRequestPayload = { projectId: string; jobNumber: string | null; projectName: string };

// The default flow in code, as the flow administration shows it: `work:manage` holders over the
// project's place. A submission names the team's leads instead (`briefFlowFor`); an administrator's
// flow for the type replaces both.
export const projectBriefRequest = defineRequestType({
  type: "project_brief",
  flow: { steps: [{ key: "team_lead", mode: "any", approvers: [{ rule: "permission", permission: "work:manage" }] }] },
  // A kick-off is read, not ticked: the approver opens the brief.
  bulkApprovable: () => false,
  // Nobody reads a kick-off for holding a permission: a private project's brief stays with its
  // people. Its requester and its approvers are the parties, and nobody else opens the request.
  canView: () => false,
});

/**
 * The type with the leads of the project's team as the approvers. With none, a private project's
 * step names nobody, so the engine asks the owners — never the `work:manage` holders of the default
 * flow, who may not open a private project.
 */
const briefFlowFor = (leadIds: readonly string[], isPrivate: boolean): RequestTypeDefinition => ({
  ...projectBriefRequest,
  flow: leadIds.length ? { steps: [{ key: "team_lead", mode: "any", approvers: leadIds.map((personId) => ({ rule: "person" as const, personId })) }] } : isPrivate ? { steps: [{ key: "team_lead", mode: "any", approvers: [] }] } : projectBriefRequest.flow,
});

async function lockPlan(tx: Tx, projectId: string): Promise<PlanRow> {
  await ensurePlan(projectId, tx);
  const [plan] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1).for("update");
  return plan;
}

/** The author sends the brief to the gate — or, after a return, sends the same request round again. */
export async function submitBrief(projectId: string, actorPersonId: string): Promise<{ plan: PlanRow; requestId: string; resubmitted: boolean }> {
  return db().transaction(async (tx) => {
    // A kick-off withdrawn or returned from the approvals inbox left the brief "submitted": it is
    // the author's again before this submission is judged (reads never write it back).
    const plan = await reconcileBrief(tx, await lockPlan(tx, projectId));
    if (!briefSubmittable(plan.briefStatus as BriefStatus)) throw new ActionError("brief_not_submittable");
    const problems = briefProblems(plan.brief, plan.kind as ProjectKind);
    if (problems.length) throw new ActionError("brief_incomplete", { fields: problems });
    const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
    const payload: BriefRequestPayload = { projectId, jobNumber: plan.jobNumber, projectName: project.name };
    const summary = [plan.jobNumber, project.name].filter(Boolean).join(" · ").slice(0, 300);

    const [returned] = plan.briefApprovalRequestId ? await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, plan.briefApprovalRequestId), eq(schema.approvalRequest.status, "returned"), eq(schema.approvalRequest.requesterPersonId, actorPersonId))).limit(1) : [];
    if (returned) {
      await resubmitRequest(tx, projectBriefRequest, returned.id, actorPersonId, { summary, payload });
      const [after] = await tx.update(schema.projectPlan).set({ briefStatus: "submitted", updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId)).returning();
      return { plan: after, requestId: returned.id, resubmitted: true };
    }

    const leads = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, project.teamId), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.createdAt));
    const { request, outcome } = await submitRequest(tx, briefFlowFor(leads.map((row) => row.personId), project.visibility === "private"), {
      entityId: project.entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: null,
      subjectType: "work_project",
      subjectId: projectId,
      summary,
      payload,
      link: `/projects/${projectId}`,
      target: { entityId: project.entityId },
    });
    await tx.update(schema.projectPlan).set({ briefStatus: "submitted", briefApprovalRequestId: request.id, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    // A configured flow with no step that applies approves at once.
    const after = outcome === "approved" ? await applyKickoff(tx, projectId, new Date()) : await lockPlan(tx, projectId);
    return { plan: after, requestId: request.id, resubmitted: false };
  });
}

/**
 * The effect of an approved brief: frozen, baseline taken — the project's dates, the hours budget
 * and every milestone's date, plus each linked task's dates — and a planned project goes live.
 */
async function applyKickoff(tx: Tx, projectId: string, now: Date): Promise<PlanRow> {
  const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1).for("update");
  await lockPlan(tx, projectId);
  const baseline = await captureProjectBaseline(tx, projectId, now);
  const [after] = await tx.update(schema.projectPlan).set({ briefStatus: "approved", briefApprovedAt: now, baseline, updatedAt: now }).where(eq(schema.projectPlan.projectId, projectId)).returning();
  // Every task of the project, linked to the plan or not, keeps its dates as its baseline.
  await captureTaskBaselines(tx, projectId);
  if (project.status === "planned") await tx.update(schema.workProject).set({ status: "active", updatedAt: now }).where(eq(schema.workProject.id, projectId));
  return after;
}

export type BriefDecision = { action: "approve" | "reject" | "return"; comment: string | null };

/**
 * The approver's answer. Rejected or returned, the brief is the author's again ("returned"): after
 * a return the same request goes round again; after a rejection the next submission is a new one.
 */
export async function decideBrief(actorPersonId: string, requestId: string, decision: BriefDecision): Promise<{ projectId: string; outcome: string; plan: PlanRow; entityId: string | null; before: { status: string } }> {
  return db().transaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, projectBriefRequest, requestId, actorPersonId, decision);
    const { projectId } = request.payload as BriefRequestPayload;
    let plan = await lockPlan(tx, projectId);
    if (plan.briefApprovalRequestId !== request.id) throw new ActionError("approval_not_found");
    if (outcome === "approved") plan = await applyKickoff(tx, projectId, new Date());
    else if (outcome === "returned" || outcome === "rejected") {
      [plan] = await tx
        .update(schema.projectPlan)
        .set({ briefStatus: "returned", briefApprovalRequestId: outcome === "returned" ? request.id : null, updatedAt: new Date() })
        .where(eq(schema.projectPlan.projectId, projectId))
        .returning();
    }
    return { projectId, outcome, plan, entityId: request.entityId, before: { status: before.status } };
  });
}

/** The kick-off request as the viewer may see it; null = none, or none of their business. */
export async function getBriefRequest(viewer: { personId: string; principal: Principal }, plan: Pick<PlanRow, "briefApprovalRequestId">): Promise<RequestView | null> {
  return plan.briefApprovalRequestId ? getRequest(viewer, projectBriefRequest, plan.briefApprovalRequestId) : null;
}

/** The project a kick-off request is about — for the decide action's authorization. */
export async function briefRequestProject(requestId: string): Promise<string | null> {
  const [row] = await db().select({ payload: schema.approvalRequest.payload }).from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), inArray(schema.approvalRequest.type, [projectBriefRequest.type]))).limit(1);
  return (row?.payload as BriefRequestPayload | undefined)?.projectId ?? null;
}
