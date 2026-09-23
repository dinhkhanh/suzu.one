// Opening a project for its plan pages: the work policy decides whether the viewer may, the plan
// is read as it stands (its defaults when nothing has made it yet; the account manager and a
// withdrawn kick-off as they are now) without writing anything, and the money is taken out unless
// the viewer holds `pjm:commercial` over the project's entity.
import "server-only";
import { recordAudit } from "../platform/audit/service";
import type { CurrentUser } from "../platform/auth/session";
import type { RequestView } from "../platform/approvals/service";
import type { ProjectFacts, WorkViewer } from "../work/policy";
import { findProject, loadViewer, projectFacts, type ProjectRow, readsPrivateByPortfolio, type TeamRow } from "../work/service";
import { getBriefRequest } from "./kickoff";
import { defaultPlan, isProjectClosed, planAsItStands, type PlanRow, type PlanView, readPlan, shapePlan } from "./plans";
import { canEditClientSide, canEditFees, canEditPlan, canPostStatus, canSeeFees, canViewPlan, type PlanFacts } from "./policy";

type Found = NonNullable<Awaited<ReturnType<typeof findProject>>>;

export type ProjectContext = {
  project: Found["project"];
  team: Found["team"];
  facts: PlanFacts;
  viewer: WorkViewer;
  plan: PlanView;
  can: { editPlan: boolean; editClientSide: boolean; seeFees: boolean; editFees: boolean; postStatus: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectReader = Pick<CurrentUser, "person" | "principal"> & Partial<Pick<CurrentUser, "userId" | "email" | "request">>;

/**
 * A private project opened by a leader who is none of its people (the owner's decision of
 * 2026-09-23, Q25) leaves a trail, as a compensation-tier read does: who looked, at which project,
 * and on what authority — never the project's content. Nothing else about the read changes; the
 * project's own people are not logged for reading their own work.
 */
export async function auditPrivateRead(user: ProjectReader, viewer: WorkViewer, facts: ProjectFacts, projectName: string): Promise<void> {
  if (!readsPrivateByPortfolio(viewer, facts)) return;
  await recordAudit({
    action: "projects.private.read",
    actor: { userId: user.userId ?? null, personId: user.person.id, email: user.email ?? null },
    request: user.request,
    resource: { type: "work_project", id: facts.id, entityId: facts.entityId },
    summary: projectName.slice(0, 300),
    after: { visibility: "private", via: "pjm:portfolio", teamId: facts.team.id },
  });
}

/**
 * The same trail for one **task** of a private project (Q25). Opening a task is where the private
 * work itself is read — its title, its discussion, its versions — and a task is reachable by its
 * link, its key and a notification without ever passing the project's board, so recording only the
 * board would leave the deeper read unrecorded. A task outside a project records nothing, and so
 * does a task of a project whose people the reader is one of.
 */
export async function auditPrivateTaskRead(user: ProjectReader, viewer: WorkViewer, task: { project: ProjectRow | null; team: TeamRow }): Promise<void> {
  if (!task.project) return;
  await auditPrivateRead(user, viewer, projectFacts(task.project, task.team), task.project.name);
}

/** null = no such project, or one the viewer may not open — the page answers notFound() either way. */
export async function openProject(user: ProjectReader, projectId: string): Promise<ProjectContext | null> {
  if (!UUID.test(projectId)) return null;
  const [found, viewer] = await Promise.all([findProject(projectId), loadViewer(user)]);
  if (!found) return null;
  const workFacts = projectFacts(found.project, found.team);
  if (!canViewPlan(viewer, workFacts)) return null;
  await auditPrivateRead(user, viewer, workFacts, found.project.name);
  const plan = await planAsItStands((await readPlan(projectId)) ?? defaultPlan(found.project));
  const facts: PlanFacts = { ...workFacts, closed: !!plan.closedAt };
  const seeFees = canSeeFees(viewer, facts);
  return {
    project: found.project,
    team: found.team,
    facts,
    viewer,
    plan: shapePlan(plan, seeFees),
    can: { editPlan: canEditPlan(viewer, facts), editClientSide: canEditClientSide(viewer, facts), seeFees, editFees: canEditFees(viewer, facts), postStatus: canPostStatus(viewer, facts) },
  };
}

/**
 * For an approver who may not open the project itself — the owners, asked when a private
 * project's team has no other lead: the brief and its request, nothing else. null = not a party.
 */
export async function openBriefForApprover(user: Pick<CurrentUser, "person" | "principal">, projectId: string): Promise<{ projectName: string; plan: Pick<PlanRow, "brief" | "kind" | "jobNumber" | "briefStatus">; request: RequestView } | null> {
  if (!UUID.test(projectId)) return null;
  const found = await findProject(projectId);
  if (!found) return null;
  const plan = await readPlan(projectId);
  if (!plan) return null;
  const request = await getBriefRequest({ personId: user.person.id, principal: user.principal }, plan);
  if (!request) return null;
  return { projectName: found.project.name, plan: { brief: plan.brief, kind: plan.kind, jobNumber: plan.jobNumber, briefStatus: plan.briefStatus }, request };
}

/**
 * A project as the actions' rules see it: the viewer, the work facts and whether it is closed. No
 * visibility check here — each action applies its own rule to these facts. null = no such project.
 */
export async function planProjectFor(user: Pick<CurrentUser, "person" | "principal">, projectId: string | null): Promise<{ viewer: WorkViewer; facts: PlanFacts; project: Found["project"] } | null> {
  if (!projectId || !UUID.test(projectId)) return null;
  const [found, viewer, closed] = await Promise.all([findProject(projectId), loadViewer(user), isProjectClosed(projectId)]);
  return found ? { viewer, facts: { ...projectFacts(found.project, found.team), closed }, project: found.project } : null;
}
