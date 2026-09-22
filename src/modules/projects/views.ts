// Opening a project for its plan pages: the work policy decides whether the viewer may, the plan
// is made if missing and brought up to date (account manager, a withdrawn kick-off), and the money
// is taken out unless the viewer holds `pjm:commercial` over the project's entity.
import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "../platform/auth/session";
import type { RequestView } from "../platform/approvals/service";
import type { WorkViewer } from "../work/policy";
import { findProject, loadViewer, projectFacts } from "../work/service";
import { getBriefRequest, syncBriefState } from "./kickoff";
import { ensurePlan, isProjectClosed, type PlanRow, type PlanView, shapePlan, syncAccountManager } from "./plans";
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

async function freshPlan(projectId: string): Promise<PlanRow> {
  const plan = await syncAccountManager(db(), await ensurePlan(projectId));
  return syncBriefState(plan);
}

/** null = no such project, or one the viewer may not open — the page answers notFound() either way. */
export async function openProject(user: Pick<CurrentUser, "person" | "principal">, projectId: string): Promise<ProjectContext | null> {
  if (!UUID.test(projectId)) return null;
  const [found, viewer] = await Promise.all([findProject(projectId), loadViewer(user)]);
  if (!found) return null;
  const workFacts = projectFacts(found.project, found.team);
  if (!canViewPlan(viewer, workFacts)) return null;
  const plan = await freshPlan(projectId);
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
  const plan = await ensurePlan(projectId);
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
