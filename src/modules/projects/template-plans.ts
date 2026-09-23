// Project templates v2 (FR-PJM-15): the plan half of a project template — phases, milestones with
// days from the anchor, register lines, hours budget by role and the brief to start from — kept in
// `project_template_plan` beside the task tree the work module keeps. Using a template makes both
// halves in one transaction: work makes the project and its tasks, then calls `applyTemplatePlanIn`.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import type { ProjectCreatedHook } from "../work/service";
import type { ProjectKind } from "./engine/brief";
import { briefFromTemplate, datePlan } from "./engine/template-plan";
import { ensurePlan } from "./plans";
import type { ProjectBrief, RoleBudget, TemplateLine, TemplateMilestone, TemplatePhase } from "./schema";

export type TemplatePlanRow = typeof schema.projectTemplatePlan.$inferSelect;
export type TemplatePlanInput = { kind: ProjectKind; phases: TemplatePhase[]; milestones: TemplateMilestone[]; deliverables: TemplateLine[]; budgetByRole: RoleBudget[]; brief: ProjectBrief; updateCadenceDays: number };

// A template's plan half is reference data — one small row per project template, read by every
// open of the templates list. The whole table sits in the shared cache and is picked over here;
// saving one drops the entry, and the TTL bounds anything written behind the app's back (a seed).
const PLANS_KEY = "projects:template-plans";
const PLANS_TTL = 30 * 60;

/** Inside a transaction pass the executor, and the rows come from there, not the cache. */
async function allTemplatePlans(executor?: Tx): Promise<TemplatePlanRow[]> {
  const load = (from: Tx | ReturnType<typeof db>) => from.select().from(schema.projectTemplatePlan).orderBy(schema.projectTemplatePlan.templateId);
  return executor ? load(executor) : cached(PLANS_KEY, PLANS_TTL, () => load(db()));
}

export async function listTemplatePlans(templateIds: readonly string[]): Promise<Map<string, TemplatePlanRow>> {
  if (templateIds.length === 0) return new Map();
  const wanted = new Set(templateIds);
  return new Map((await allTemplatePlans()).filter((row) => wanted.has(row.templateId)).map((row) => [row.templateId, row]));
}

/** References between the parts are indexes: a milestone's phase, a line's milestone. One that points nowhere is refused. */
function checkParts(input: TemplatePlanInput): void {
  if (input.milestones.some((milestone) => milestone.phase !== null && (milestone.phase < 0 || milestone.phase >= input.phases.length))) throw new ActionError("template_plan_invalid");
  if (input.deliverables.some((line) => line.milestone !== null && (line.milestone < 0 || line.milestone >= input.milestones.length))) throw new ActionError("template_plan_invalid");
}

export async function saveTemplatePlan(templateId: string, input: TemplatePlanInput): Promise<{ before: TemplatePlanRow | null; after: TemplatePlanRow }> {
  checkParts(input);
  const [template] = await db().select({ purpose: schema.taskTemplate.purpose }).from(schema.taskTemplate).where(eq(schema.taskTemplate.id, templateId)).limit(1);
  if (template?.purpose !== "work_project") throw new ActionError("template_not_found");
  const saved = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projectTemplatePlan).where(eq(schema.projectTemplatePlan.templateId, templateId)).limit(1).for("update");
    const values = { ...input, updatedAt: new Date() };
    const [after] = await tx.insert(schema.projectTemplatePlan).values({ templateId, ...values }).onConflictDoUpdate({ target: schema.projectTemplatePlan.templateId, set: values }).returning();
    return { before: before ?? null, after };
  });
  await invalidate(PLANS_KEY);
  return saved;
}

/** Writers outside this file (seeds, tests): a template's plan half changed. */
export const invalidateTemplatePlans = () => invalidate(PLANS_KEY);

/**
 * The plan half of a template, applied to a project the work module has just made — inside its
 * transaction, so a project never exists with half a template. A template without a plan half
 * still gives the project its plan row (and job number).
 */
export const applyTemplatePlanIn: ProjectCreatedHook = async (tx: Tx, made) => {
  await ensurePlan(made.project.id, tx);
  const [parts] = await tx.select().from(schema.projectTemplatePlan).where(eq(schema.projectTemplatePlan.templateId, made.template.id)).limit(1);
  if (!parts) return;
  const dated = datePlan(parts, made.use.anchor, made.lastStepDay);
  const phaseIds: string[] = [];
  for (const phase of dated.phases) {
    const [row] = await tx.insert(schema.projectPhase).values({ projectId: made.project.id, ...phase }).returning({ id: schema.projectPhase.id });
    phaseIds.push(row.id);
  }
  const milestoneIds: string[] = [];
  for (const milestone of dated.milestones) {
    const { phase, ...rest } = milestone;
    const [row] = await tx.insert(schema.projectMilestone).values({ projectId: made.project.id, phaseId: phase === null ? null : phaseIds[phase], ownerPersonId: made.project.leadPersonId, ...rest }).returning({ id: schema.projectMilestone.id });
    milestoneIds.push(row.id);
  }
  for (const line of dated.lines) {
    const { milestone, ...rest } = line;
    await tx.insert(schema.projectDeliverable).values({ projectId: made.project.id, milestoneId: milestone === null ? null : milestoneIds[milestone], ...rest });
  }
  await tx
    .update(schema.projectPlan)
    .set({ kind: parts.kind, budgetMinutes: dated.budgetMinutes, budgetByRole: parts.budgetByRole, brief: briefFromTemplate(parts.brief), updateCadenceDays: parts.updateCadenceDays, updatedAt: new Date() })
    .where(eq(schema.projectPlan.projectId, made.project.id));
};
