// The plan of a project (FR-PJM-01, 02, 09, 14): one `project_plan` row per `work_project`.
//
// Work never imports projects, so a project is created without its plan. The plan is made
// idempotently by the first change anything makes to it (`ensurePlan`, inside that change's
// transaction), and the daily job backfills every project still missing one (`backfillPlans`).
// Making it hands out the job number. Reading never writes: a page opened before either has
// happened reads the plan's defaults (`readPlan`), with no job number yet.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { ProjectKind } from "./engine/brief";
import { briefEditable, type BriefStatus } from "./engine/brief";
import { totalOfRoles } from "./engine/budget";
import { formatJobNumber, jobPrefix, jobYear } from "./engine/job-number";
import type { ProjectBrief, RoleBudget } from "./schema";

type Executor = Tx | ReturnType<typeof db>;
export type PlanRow = typeof schema.projectPlan.$inferSelect;

/** Inside the caller's transaction, or in one of its own: the plan must never exist half-made. */
const inTransaction = <T>(tx: Tx | undefined, work: (tx: Tx) => Promise<T>): Promise<T> => (tx ? work(tx) : db().transaction(work));

/**
 * The next job number of a prefix and year. The upsert takes the counter row's lock, so two
 * projects numbered at the same moment wait for each other and never share or skip a number.
 */
export async function nextJobNumber(tx: Executor, prefix: string, year: number): Promise<string> {
  const [row] = await tx
    .insert(schema.projectJobCounter)
    .values({ prefix, year, last: 1 })
    .onConflictDoUpdate({ target: [schema.projectJobCounter.prefix, schema.projectJobCounter.year], set: { last: sql`${schema.projectJobCounter.last} + 1` } })
    .returning({ last: schema.projectJobCounter.last });
  return formatJobNumber({ prefix, year, sequence: row.last });
}

async function planOf(executor: Executor, projectId: string): Promise<PlanRow | undefined> {
  const [row] = await executor.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  return row;
}

/**
 * The plan of a project, made if it does not exist yet. The project row is locked first, so two
 * requests that both find no plan make one between them — and one job number, not two.
 */
export async function ensurePlan(projectId: string, executor?: Tx): Promise<PlanRow> {
  const existing = await planOf(executor ?? db(), projectId);
  if (existing) return existing;
  return inTransaction(executor, async (tx) => {
    const [project] = await tx
      .select({ id: schema.workProject.id, clientId: schema.workProject.clientId, entityCode: schema.entity.code })
      .from(schema.workProject)
      .leftJoin(schema.entity, eq(schema.entity.id, schema.workProject.entityId))
      .where(eq(schema.workProject.id, projectId))
      .limit(1)
      .for("update", { of: schema.workProject });
    if (!project) throw new ActionError("project_not_found");
    const again = await planOf(tx, projectId);
    if (again) return again;
    const [manager] = await tx.select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), eq(schema.workProjectMember.role, "account_manager"))).limit(1);
    const jobNumber = await nextJobNumber(tx, jobPrefix(project.entityCode), jobYear(todayInVietnam()));
    const kind: ProjectKind = project.clientId ? "client" : "internal";
    const [plan] = await tx.insert(schema.projectPlan).values({ projectId, kind, jobNumber, accountManagerPersonId: manager?.personId ?? null }).returning();
    return plan;
  });
}

/**
 * The plan a project has before anything made it: what the table's defaults and `ensurePlan` would
 * write, minus the job number, which is handed out only when the row is made. Never stored.
 */
export function defaultPlan(project: { id: string; clientId: string | null; createdAt?: Date }, accountManagerPersonId: string | null = null): PlanRow {
  // Dated from the project, so an update cadence counts from when the work began.
  const since = project.createdAt ?? new Date();
  return {
    projectId: project.id,
    kind: project.clientId ? "client" : "internal",
    jobNumber: null,
    accountManagerPersonId,
    brief: {},
    briefStatus: "draft",
    briefApprovalRequestId: null,
    briefApprovedAt: null,
    budgetMinutes: null,
    budgetByRole: [],
    feeVnd: null,
    budgetAlerted: [],
    baseline: null,
    health: null,
    healthUpdatedAt: null,
    updateCadenceDays: 7,
    driveUrl: null,
    kbSpaceId: null,
    closedAt: null,
    closedByPersonId: null,
    closeReport: null,
    createdAt: since,
    updatedAt: since,
  };
}

/**
 * Plans for many projects at once, for reading: those that exist in one query, the defaults for
 * the rest (with the account manager their member role names). Writes nothing.
 */
export async function readPlans(projectIds: readonly string[], executor: Executor = db()): Promise<Map<string, PlanRow>> {
  const ids = [...new Set(projectIds)];
  const result = new Map<string, PlanRow>();
  if (ids.length === 0) return result;
  for (const row of await executor.select().from(schema.projectPlan).where(inArray(schema.projectPlan.projectId, ids))) result.set(row.projectId, row);
  const missing = ids.filter((id) => !result.has(id));
  if (missing.length === 0) return result;
  const [projects, managers] = await Promise.all([
    executor.select({ id: schema.workProject.id, clientId: schema.workProject.clientId, createdAt: schema.workProject.createdAt }).from(schema.workProject).where(inArray(schema.workProject.id, missing)),
    executor.select({ projectId: schema.workProjectMember.projectId, personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(inArray(schema.workProjectMember.projectId, missing), eq(schema.workProjectMember.role, "account_manager"))),
  ]);
  const managerOf = new Map(managers.map((row) => [row.projectId, row.personId]));
  for (const project of projects) result.set(project.id, defaultPlan(project, managerOf.get(project.id) ?? null));
  return result;
}

/** The plan of one project, for reading: stored, else its defaults. null = no such project. */
export async function readPlan(projectId: string, executor: Executor = db()): Promise<PlanRow | null> {
  return (await readPlans([projectId], executor)).get(projectId) ?? null;
}

/** Every project without a plan gets one (the daily job). Oldest first, so job numbers follow the order projects began. */
export async function backfillPlans(): Promise<{ created: number }> {
  const missing = await db()
    .select({ id: schema.workProject.id })
    .from(schema.workProject)
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
    .where(isNull(schema.projectPlan.projectId))
    .orderBy(schema.workProject.createdAt);
  for (const row of missing) await ensurePlan(row.id);
  return { created: missing.length };
}

// ── The account manager (FR-PJM-14) ─────────────────────────────────────────────────────────
//
// Two records say who it is: the plan's column (what the portfolio and the billing hand-off read)
// and the `account_manager` member role (what grants the rights). The member role is the source of
// truth — it is what the work screens change — and the column follows it.

/** The account manager the member roles name, when the plan's column disagrees; undefined = it agrees. */
async function managerNow(executor: Executor, plan: PlanRow): Promise<string | null | undefined> {
  const managers = await executor.select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, plan.projectId), eq(schema.workProjectMember.role, "account_manager")));
  const ids = managers.map((row) => row.personId);
  if (plan.accountManagerPersonId ? ids.includes(plan.accountManagerPersonId) : ids.length === 0) return undefined;
  return ids[0] ?? null;
}

/** Brings the plan's column in line with the member roles. Returns the plan as it now stands. */
export async function syncAccountManager(executor: Executor, plan: PlanRow): Promise<PlanRow> {
  const manager = await managerNow(executor, plan);
  if (manager === undefined) return plan;
  const [after] = await executor.update(schema.projectPlan).set({ accountManagerPersonId: manager, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, plan.projectId)).returning();
  return after ?? { ...plan, accountManagerPersonId: manager };
}

/**
 * The plan as a page reads it, without writing: the account manager the member roles name, and the
 * kick-off as the approval engine now has it (a request withdrawn or returned from the inbox). The
 * stored columns catch up at the next change to the plan and in the nightly job.
 */
export async function planAsItStands(plan: PlanRow, executor: Executor = db()): Promise<PlanRow> {
  const manager = await managerNow(executor, plan);
  const [request] = plan.briefStatus === "submitted" && plan.briefApprovalRequestId ? await executor.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, plan.briefApprovalRequestId)).limit(1) : [];
  const brief = request ? briefNow(plan, request.status) : null;
  return { ...plan, ...(manager === undefined ? {} : { accountManagerPersonId: manager }), ...(brief ?? {}) };
}

/**
 * The engine's own "withdraw" (and "return", decided from its inbox) knows nothing of plans: a
 * submitted brief whose request is no longer pending is the author's again. null = nothing to change.
 */
export function briefNow(plan: Pick<PlanRow, "briefStatus" | "briefApprovalRequestId">, requestStatus: string | null): Pick<PlanRow, "briefStatus" | "briefApprovalRequestId"> | null {
  if (plan.briefStatus !== "submitted" || !plan.briefApprovalRequestId || requestStatus === "pending") return null;
  return requestStatus === "returned" ? { briefStatus: "returned", briefApprovalRequestId: plan.briefApprovalRequestId } : { briefStatus: "draft", briefApprovalRequestId: null };
}

/** `briefNow` written back, inside a change that holds the plan's lock. Returns the plan as it now stands. */
export async function reconcileBrief(tx: Tx, plan: PlanRow): Promise<PlanRow> {
  if (plan.briefStatus !== "submitted" || !plan.briefApprovalRequestId) return plan;
  const [request] = await tx.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, plan.briefApprovalRequestId)).limit(1);
  const next = briefNow(plan, request?.status ?? null);
  if (!next) return plan;
  const [after] = await tx.update(schema.projectPlan).set({ ...next, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, plan.projectId)).returning();
  return after;
}

/**
 * The same, by project, inside the caller's transaction — for the work module's account handover,
 * which changes the member role and must leave the plan agreeing with it in the same commit.
 */
export async function syncProjectAccountManager(tx: Tx, projectId: string): Promise<PlanRow> {
  return syncAccountManager(tx, await ensurePlan(projectId, tx));
}

/**
 * Names the account manager: the person gets the member role, whoever held it before becomes an
 * ordinary member (they keep working in the project), and the plan's column follows.
 */
export async function setAccountManager(projectId: string, personId: string | null): Promise<{ before: string | null; after: string | null }> {
  return db().transaction(async (tx) => {
    const plan = await ensurePlan(projectId, tx);
    if (personId) {
      const [person] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
      if (!person || person.status === "offboarded") throw new ActionError("person_not_found");
    }
    const current = await tx.select().from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), eq(schema.workProjectMember.role, "account_manager")));
    for (const row of current) if (row.personId !== personId) await tx.update(schema.workProjectMember).set({ role: "member" }).where(eq(schema.workProjectMember.id, row.id));
    if (personId) {
      // The project's lead stays its lead; the account manager is a second hat only for somebody else.
      const [existing] = await tx.select().from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), eq(schema.workProjectMember.personId, personId))).limit(1);
      if (existing?.role === "lead") throw new ActionError("account_manager_is_lead");
      if (existing) await tx.update(schema.workProjectMember).set({ role: "account_manager" }).where(eq(schema.workProjectMember.id, existing.id));
      else await tx.insert(schema.workProjectMember).values({ projectId, personId, role: "account_manager" });
    }
    await tx.update(schema.projectPlan).set({ accountManagerPersonId: personId, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    return { before: plan.accountManagerPersonId, after: personId };
  });
}

// ── Settings, brief, fee ────────────────────────────────────────────────────────────────────

export type PlanSettingsInput = { kind: ProjectKind; budgetMinutes: number | null; budgetByRole: RoleBudget[]; updateCadenceDays: number; driveUrl: string | null };

/**
 * The hours budget is the budget by role when one is given: two numbers that must agree are one
 * number too many. Approved change requests (FR-PJM-11) move the total without touching the roles,
 * so a total made from roles keeps what the changes added.
 */
export async function updatePlanSettings(projectId: string, input: PlanSettingsInput): Promise<{ before: PlanRow; after: PlanRow }> {
  return db().transaction(async (tx) => {
    const before = await ensurePlan(projectId, tx);
    const roles = input.budgetByRole.filter((role) => role.role.trim() && role.minutes > 0);
    const budgetMinutes = roles.length ? Math.max(0, totalOfRoles(roles) + (await changedMinutes(tx, projectId))) : input.budgetMinutes;
    // A budget raised back under a threshold can warn again when it is crossed again.
    const budgetAlerted = budgetMinutes === before.budgetMinutes ? before.budgetAlerted : [];
    const [after] = await tx.update(schema.projectPlan).set({ kind: input.kind, budgetMinutes, budgetByRole: roles, budgetAlerted, updateCadenceDays: input.updateCadenceDays, driveUrl: input.driveUrl, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId)).returning();
    return { before, after };
  });
}

export async function updateBrief(projectId: string, brief: ProjectBrief): Promise<{ before: ProjectBrief; after: ProjectBrief }> {
  return db().transaction(async (tx) => {
    const plan = await ensurePlan(projectId, tx);
    const [row] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1).for("update");
    // A kick-off withdrawn from the approvals inbox left the brief "submitted": editable again now.
    const locked = await reconcileBrief(tx, row);
    if (!briefEditable(locked.briefStatus as BriefStatus)) throw new ActionError("brief_locked");
    await tx.update(schema.projectPlan).set({ brief, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    return { before: plan.brief, after: brief };
  });
}

/** The fee in VND (`pjm:commercial`; the action checks). */
export async function setFee(projectId: string, feeVnd: number | null): Promise<{ before: number | null; after: number | null }> {
  return db().transaction(async (tx) => {
    const plan = await ensurePlan(projectId, tx);
    await tx.update(schema.projectPlan).set({ feeVnd, updatedAt: new Date() }).where(eq(schema.projectPlan.projectId, projectId));
    return { before: plan.feeVnd, after: feeVnd };
  });
}

// ── Reading with the money taken out ────────────────────────────────────────────────────────

/** A plan as a reader gets it: `feeVnd` is present only for readers with `pjm:commercial`. */
export type PlanView = Omit<PlanRow, "feeVnd"> & { feeVnd?: number | null };

export function shapePlan(plan: PlanRow, seesFees: boolean): PlanView {
  const { feeVnd, ...rest } = plan;
  return seesFees ? { ...rest, feeVnd } : rest;
}

/** Minutes the approved change requests of a project added to (or took from) its hours budget. */
async function changedMinutes(executor: Executor, projectId: string): Promise<number> {
  const [row] = await executor
    .select({ minutes: sql<number>`coalesce(sum((${schema.projectChangeRequest.impact} ->> 'minutesDelta')::int), 0)::int` })
    .from(schema.projectChangeRequest)
    .where(and(eq(schema.projectChangeRequest.projectId, projectId), eq(schema.projectChangeRequest.status, "approved")));
  return Number(row?.minutes ?? 0);
}

/**
 * The nightly reconciliation (with `backfillPlans`): every plan's account-manager column brought in
 * line with the member roles, and every kick-off whose request left "pending" outside this module
 * (withdrawn or returned from the inbox) given back to its author. What pages show without writing
 * (`planAsItStands`), stored.
 */
export async function reconcilePlans(): Promise<{ managers: number; briefs: number }> {
  const plans = await db().select().from(schema.projectPlan);
  const managers = await db().select({ projectId: schema.workProjectMember.projectId, personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(eq(schema.workProjectMember.role, "account_manager"));
  const managersOf = Map.groupBy(managers, (row) => row.projectId);
  const submitted = plans.filter((plan) => plan.briefStatus === "submitted" && plan.briefApprovalRequestId);
  const requests = submitted.length ? await db().select({ id: schema.approvalRequest.id, status: schema.approvalRequest.status }).from(schema.approvalRequest).where(inArray(schema.approvalRequest.id, submitted.map((plan) => plan.briefApprovalRequestId!))) : [];
  const statusOf = new Map(requests.map((row) => [row.id, row.status]));
  const result = { managers: 0, briefs: 0 };
  for (const plan of plans) {
    const ids = (managersOf.get(plan.projectId) ?? []).map((row) => row.personId);
    const managerAgrees = plan.accountManagerPersonId ? ids.includes(plan.accountManagerPersonId) : ids.length === 0;
    const briefStale = submitted.includes(plan) && !!briefNow(plan, statusOf.get(plan.briefApprovalRequestId!) ?? null);
    if (managerAgrees && !briefStale) continue;
    await db().transaction(async (tx) => {
      const [locked] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, plan.projectId)).limit(1).for("update");
      if (!locked) return;
      const synced = await syncAccountManager(tx, locked);
      if (synced.accountManagerPersonId !== locked.accountManagerPersonId) result.managers += 1;
      if ((await reconcileBrief(tx, synced)).briefStatus !== synced.briefStatus) result.briefs += 1;
    });
  }
  return result;
}

/** Closed (FR-PJM-59): the plan is read-only. A project without a plan yet is not closed. */
export async function isProjectClosed(projectId: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor.select({ closedAt: schema.projectPlan.closedAt }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  return !!row?.closedAt;
}

/** A project's kind without making its plan: a project with no plan yet is not a retainer. */
export async function planKindOf(projectId: string): Promise<string | null> {
  const [row] = await db().select({ kind: schema.projectPlan.kind }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  return row?.kind ?? null;
}
