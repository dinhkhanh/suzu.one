// The billing hand-off (FR-PJM-56): "ready to invoice" items for finance in the project's entity.
// No invoicing happens here — finance invoices in its own system and records the number and date
// (or waives the item with a reason); the CRM and accounting take it from there later.
//
// An item is made by what earns it: a billing milestone marked done, a retainer month that ended
// (its monthly fee), a signed acceptance — or by hand. Each automatic source is made once, held by
// the database's unique indexes (one per milestone, per retainer month, per acceptance), so a job
// that runs twice or two people pressing "done" at once still hand finance one item.
//
// Amounts are `pjm:commercial`: finance's queue is theirs by definition; anywhere else the amount
// is taken out for a reader without it (`shapeBillingItem`).
import "server-only";
import { and, count, desc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { Principal } from "../platform/rbac/policy";
import { listPeopleHolding } from "../platform/rbac/service";
import { type BillingSource, type BillingStatus, billingDecidable } from "./engine/acceptance";
import { ensurePlan } from "./plans";
import { billingReach, canDecideBilling } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type BillingItemRow = typeof schema.projectBillingItem.$inferSelect;

/** Finance-capable people of an entity: named holders of `pjm:commercial` over it, never the owners' "*". */
export const financeOf = (executor: Executor, entityId: string | null): Promise<string[]> => listPeopleHolding("pjm:commercial", { entityId }, { includeWildcard: false, executor });

export type NewBillingItem = {
  projectId: string;
  source: BillingSource;
  acceptanceId?: string | null;
  milestoneId?: string | null;
  retainerPeriodId?: string | null;
  description: string;
  reference?: string | null;
  amountVnd: number | null;
  createdByPersonId: string | null;
};

/**
 * Makes the item if its source has none yet, inside the caller's transaction, and tells finance.
 * Returns the item either way; `created` says whether this call made it.
 */
export async function ensureBillingItem(tx: Tx, input: NewBillingItem): Promise<{ item: BillingItemRow; created: boolean }> {
  const [project] = await tx.select({ id: schema.workProject.id, name: schema.workProject.name, entityId: schema.workProject.entityId, clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, input.projectId)).limit(1);
  if (!project) throw new ActionError("project_not_found");
  const plan = await ensurePlan(input.projectId, tx);
  const [created] = await tx
    .insert(schema.projectBillingItem)
    .values({
      projectId: project.id,
      entityId: project.entityId,
      jobNumber: plan.jobNumber,
      clientId: project.clientId,
      source: input.source,
      acceptanceId: input.acceptanceId ?? null,
      milestoneId: input.milestoneId ?? null,
      retainerPeriodId: input.retainerPeriodId ?? null,
      description: input.description.slice(0, 300),
      reference: input.reference ?? null,
      amountVnd: input.amountVnd,
      createdByPersonId: input.createdByPersonId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await notify({ recipients: await financeOf(tx, project.entityId), kind: "projects.billing_ready", params: { project: project.name, job: plan.jobNumber ?? "—" }, link: "/projects/billing" }, tx);
    return { item: created, created: true };
  }
  const bySource: SQL | undefined =
    input.source === "milestone" && input.milestoneId
      ? and(eq(schema.projectBillingItem.milestoneId, input.milestoneId), eq(schema.projectBillingItem.source, "milestone"))
      : input.source === "retainer" && input.retainerPeriodId
        ? and(eq(schema.projectBillingItem.retainerPeriodId, input.retainerPeriodId), eq(schema.projectBillingItem.source, "retainer"))
        : input.acceptanceId
          ? eq(schema.projectBillingItem.acceptanceId, input.acceptanceId)
          : undefined;
  if (!bySource) throw new ActionError("billing_conflict");
  const [existing] = await tx.select().from(schema.projectBillingItem).where(bySource).limit(1);
  if (!existing) throw new ActionError("billing_conflict");
  return { item: existing, created: false };
}

/** A signed acceptance attached to the item it signs off (a milestone's or a month's), unless it already carries one. */
export async function attachAcceptance(tx: Tx, itemId: string, acceptanceId: string): Promise<void> {
  await tx.update(schema.projectBillingItem).set({ acceptanceId, updatedAt: new Date() }).where(and(eq(schema.projectBillingItem.id, itemId), isNull(schema.projectBillingItem.acceptanceId)));
}

/**
 * The project's plan row, locked: every path that bills a share of the fee — a milestone, the
 * whole-project acceptance's remainder — takes it first, so two of them never read "billed so far"
 * at the same moment and bill the same money twice.
 */
export async function lockFee(tx: Tx, projectId: string): Promise<void> {
  await ensurePlan(projectId, tx);
  await tx.select({ projectId: schema.projectPlan.projectId }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).for("update");
}

/** Has a whole-project acceptance already billed the project's fee (an item finance did not waive)? */
async function wholeProjectBilled(tx: Tx, projectId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.projectBillingItem.id })
    .from(schema.projectBillingItem)
    .innerJoin(schema.projectAcceptance, eq(schema.projectAcceptance.id, schema.projectBillingItem.acceptanceId))
    .where(and(eq(schema.projectBillingItem.projectId, projectId), eq(schema.projectAcceptance.scope, "project"), ne(schema.projectBillingItem.status, "waived")))
    .limit(1);
  return !!row;
}

/**
 * A billing milestone marked done (or its acceptance signed) earns its item — once, whatever
 * happens to the milestone afterwards. Not when a whole-project acceptance has billed the fee
 * already: that item took what was left of the fee, this milestone's share included. null = no item.
 */
export async function billMilestone(tx: Tx, milestone: typeof schema.projectMilestone.$inferSelect, actorPersonId: string | null): Promise<{ item: BillingItemRow; created: boolean } | null> {
  if (!milestone.isBilling) return null;
  await lockFee(tx, milestone.projectId);
  const [existing] = await tx.select().from(schema.projectBillingItem).where(and(eq(schema.projectBillingItem.milestoneId, milestone.id), eq(schema.projectBillingItem.source, "milestone"))).limit(1);
  if (existing) return { item: existing, created: false };
  if (await wholeProjectBilled(tx, milestone.projectId)) return null;
  return ensureBillingItem(tx, { projectId: milestone.projectId, source: "milestone", milestoneId: milestone.id, description: milestone.name, amountVnd: milestone.billingAmountVnd, createdByPersonId: actorPersonId });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type BillingItemView = Omit<BillingItemRow, "amountVnd"> & { amountVnd?: number | null; projectName: string; clientName: string | null; entityName: string | null; decidedByName: string | null };

/** Without `pjm:commercial`, an item has no amount at all — not a zero, not a null: no key. */
export function shapeBillingItem<Row extends { amountVnd: number | null }>(row: Row, seesFees: boolean): Omit<Row, "amountVnd"> & { amountVnd?: number | null } {
  const { amountVnd, ...rest } = row;
  return seesFees ? { ...rest, amountVnd } : rest;
}

async function listItems(where: SQL | undefined, limit: number): Promise<(BillingItemRow & { projectName: string; clientName: string | null; entityName: string | null; decidedByName: string | null })[]> {
  const decider = alias(schema.person, "billing_decider");
  const rows = await db()
    .select({ item: schema.projectBillingItem, projectName: schema.workProject.name, clientName: schema.workClient.name, entityName: schema.entity.shortName, decidedByName: decider.fullName })
    .from(schema.projectBillingItem)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBillingItem.projectId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.projectBillingItem.clientId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.projectBillingItem.entityId))
    .leftJoin(decider, eq(decider.id, schema.projectBillingItem.decidedByPersonId))
    .where(where)
    .orderBy(desc(schema.projectBillingItem.createdAt))
    .limit(limit);
  return rows.map(({ item, ...rest }) => ({ ...item, ...rest }));
}

/** A project's items, for its acceptance page. The amount only for a reader with `pjm:commercial`. */
export async function listProjectBilling(projectId: string, seesFees: boolean): Promise<BillingItemView[]> {
  return (await listItems(eq(schema.projectBillingItem.projectId, projectId), 200)).map((row) => shapeBillingItem(row, seesFees));
}

export type BillingFilters = { entityId?: string | null; status?: BillingStatus | "all" };

/**
 * Finance's queue: the items of the entities the reader holds `pjm:commercial` over — filtered in
 * SQL, so an item of another entity is never loaded, let alone shown. A group-wide grant also sees
 * the items of group projects (no entity).
 */
export async function listBillingQueue(principal: Principal, filters: BillingFilters = {}): Promise<BillingItemView[]> {
  const reach = billingReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const scope = reach.all ? undefined : inArray(schema.projectBillingItem.entityId, reach.entityIds);
  const status = filters.status && filters.status !== "all" ? eq(schema.projectBillingItem.status, filters.status) : undefined;
  const entity = filters.entityId ? eq(schema.projectBillingItem.entityId, filters.entityId) : undefined;
  return listItems(and(scope, status, entity), 500);
}

/** The entities a reader's queue can be filtered to. */
export async function billingEntities(principal: Principal): Promise<{ id: string; name: string }[]> {
  const reach = billingReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  return db()
    .select({ id: schema.entity.id, name: schema.entity.shortName })
    .from(schema.entity)
    .where(reach.all ? undefined : inArray(schema.entity.id, reach.entityIds))
    .orderBy(schema.entity.shortName);
}

export const findBillingItem = async (itemId: string): Promise<BillingItemRow | undefined> => (await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, itemId)).limit(1))[0];

/**
 * The billing item an acceptance is attached to, when this reader works the queue over the item's
 * entity. Finance is usually on no project, yet the item is raised "with the acceptance attached"
 * (FR-PJM-56): the paper and its signed scan open through the item, not through the project.
 */
export async function billingItemForAcceptance(principal: Principal, acceptanceId: string): Promise<BillingItemRow | null> {
  const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.acceptanceId, acceptanceId)).limit(1);
  return item && canDecideBilling(principal, item) ? item : null;
}

// ── Finance's answers ───────────────────────────────────────────────────────────────────────

export type BillingDecision = { action: "invoice"; invoiceNumber: string; invoiceDate: IsoDate; /** For an item made without one (a non-billing milestone's acceptance). */ amountVnd: number | null } | { action: "waive"; reason: string };

/** Invoiced (number, date) or waived (reason). The account manager hears when it is invoiced. */
export async function decideBillingItem(itemId: string, decision: BillingDecision, actorPersonId: string): Promise<{ before: BillingItemRow; after: BillingItemRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, itemId)).limit(1).for("update");
    if (!before) throw new ActionError("billing_not_found");
    if (!billingDecidable(before.status as BillingStatus)) throw new ActionError("billing_decided");
    const now = new Date();
    const values =
      decision.action === "invoice"
        ? { status: "invoiced", invoiceNumber: decision.invoiceNumber, invoiceDate: decision.invoiceDate, ...(before.amountVnd === null && decision.amountVnd !== null ? { amountVnd: decision.amountVnd } : {}) }
        : { status: "waived", waivedReason: decision.reason };
    const [after] = await tx
      .update(schema.projectBillingItem)
      .set({ ...values, decidedByPersonId: actorPersonId, decidedAt: now, updatedAt: now })
      .where(eq(schema.projectBillingItem.id, itemId))
      .returning();
    if (decision.action === "invoice") {
      const [project] = await tx.select({ name: schema.workProject.name, manager: schema.projectPlan.accountManagerPersonId }).from(schema.workProject).leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id)).where(eq(schema.workProject.id, after.projectId)).limit(1);
      if (project?.manager) await notify({ recipients: [project.manager], kind: "projects.billing_invoiced", params: { project: project.name, job: after.jobNumber ?? "—" }, link: `/projects/${after.projectId}/acceptance` }, tx);
    }
    return { before, after };
  });
}

/** An item by hand (`pjm:commercial`): an advance, an expense re-billed, anything the automatic sources miss. */
export async function createManualBillingItem(projectId: string, input: { description: string; reference: string | null; amountVnd: number | null }, actorPersonId: string): Promise<BillingItemRow> {
  return db().transaction(async (tx) => (await ensureBillingItem(tx, { projectId, source: "manual", ...input, createdByPersonId: actorPersonId })).item);
}

/** The project a job number names — finance types job numbers, not ids. */
export async function projectByJobNumber(jobNumber: string): Promise<string | null> {
  const [row] = await db().select({ projectId: schema.projectPlan.projectId }).from(schema.projectPlan).where(eq(schema.projectPlan.jobNumber, jobNumber.trim().toUpperCase())).limit(1);
  return row?.projectId ?? null;
}

/** Items still waiting for finance on a project — the close-out checklist asks. */
export async function countOpenBilling(executor: Executor, projectId: string): Promise<number> {
  const [row] = await executor.select({ value: count() }).from(schema.projectBillingItem).where(and(eq(schema.projectBillingItem.projectId, projectId), eq(schema.projectBillingItem.status, "ready")));
  return row?.value ?? 0;
}
