// The billing hand-off (FR-PJM-56): "ready to invoice" items for finance in the project's entity.
// No invoicing happens here — finance invoices in its own system and records the number and date
// (or waives the item with a reason); the CRM and accounting take it from there later.
//
// An item is made by what earns it: a billing milestone marked done, a retainer month that ended
// (its monthly fee), a signed acceptance — or by hand. Each automatic source is made once, held by
// the database's unique indexes (one per milestone, per retainer month, per acceptance), so a job
// that runs twice or two people pressing "done" at once still hand finance one item.
//
// On a **client's** project nothing automatic is made before the client has signed for it (D27):
// the milestone and the month wait for their biên bản nghiệm thu, so a signature is the only door
// to an invoice. Internal work, which has nobody to sign, bills on "done" and on the month's end.
//
// Amounts are `pjm:commercial`: finance's queue is theirs by definition; anywhere else the amount
// is taken out for a reader without it (`shapeBillingItem`).
//
// Nothing here fails in silence: a billing milestone that hands finance nothing says why
// (`milestoneBilling`), and an amount that was wrong when the item was made is corrected, with a
// reason, for as long as the item is not invoiced (`correctBillingAmount`).
import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { Principal } from "../platform/rbac/policy";
import { listEntities } from "../platform/org/service";
import { listPeopleHolding } from "../platform/rbac/service";
import { type BillingSource, type BillingStatus, billingDecidable, type MilestoneBillingState, milestoneBillingState } from "./engine/acceptance";
import { ensurePlan } from "./plans";
import type { BillingCorrection } from "./schema";
import { billingReach, canDecideBilling } from "./policy";

type Executor = Tx | ReturnType<typeof db>;

/**
 * Is this piece of work covered by a signed biên bản nghiệm thu — its own, or the project's as a
 * whole? What every path that bills a client asks first (the owner's decision of 2026-09-23, Q22 —
 * D27): a retainer month before `closePeriod` bills it, a milestone before `billMilestone` hands
 * finance an item. Lives here, with the other billing gates, so that the retainer, the structure
 * and the acceptance modules need not import one another.
 */
export async function acceptedForBilling(executor: Executor, projectId: string, target: { retainerPeriodId?: string | null; milestoneId?: string | null }): Promise<boolean> {
  const rows = await executor
    .select({ scope: schema.projectAcceptance.scope, milestoneId: schema.projectAcceptance.milestoneId, retainerPeriodId: schema.projectAcceptance.retainerPeriodId })
    .from(schema.projectAcceptance)
    .where(and(eq(schema.projectAcceptance.projectId, projectId), eq(schema.projectAcceptance.status, "signed")));
  return rows.some((row) => row.scope === "project" || (!!target.retainerPeriodId && row.retainerPeriodId === target.retainerPeriodId) || (!!target.milestoneId && row.milestoneId === target.milestoneId));
}
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
 * A billing milestone earns its item — once, whatever happens to the milestone afterwards. Not
 * when a whole-project acceptance has billed the fee already: that item took what was left of the
 * fee, this milestone's share included. null = no item.
 *
 * **On a client's project the signature is the door** (Q22 — D27): marking the milestone done
 * hands finance nothing until a signed biên bản nghiệm thu covers that milestone or the whole
 * project, which is why `awaitingAcceptance` lists it and `signAcceptance` calls this again the
 * moment the paper comes back. Internal work — a project with no client — has nobody to sign and
 * bills on "done" as it always did.
 */
export async function billMilestone(tx: Tx, milestone: typeof schema.projectMilestone.$inferSelect, actorPersonId: string | null): Promise<{ item: BillingItemRow; created: boolean } | null> {
  if (!milestone.isBilling) return null;
  await lockFee(tx, milestone.projectId);
  const [existing] = await tx.select().from(schema.projectBillingItem).where(and(eq(schema.projectBillingItem.milestoneId, milestone.id), eq(schema.projectBillingItem.source, "milestone"))).limit(1);
  if (existing) return { item: existing, created: false };
  const [project] = await tx.select({ clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, milestone.projectId)).limit(1);
  if (project?.clientId && !(await acceptedForBilling(tx, milestone.projectId, { milestoneId: milestone.id }))) return null;
  if (await wholeProjectBilled(tx, milestone.projectId)) return null;
  return ensureBillingItem(tx, { projectId: milestone.projectId, source: "milestone", milestoneId: milestone.id, description: milestone.name, amountVnd: milestone.billingAmountVnd, createdByPersonId: actorPersonId });
}

/** Where one billing milestone stands with finance, and whether an amount was agreed for it — never the amount. */
export type MilestoneBilling = { state: MilestoneBillingState; amountSet: boolean };

/**
 * Every billing milestone of a project with where it stands (FR-PJM-56): its item's status, or
 * the reason there is no item yet — waiting for the signed acceptance, covered by the
 * whole-project acceptance, not marked done. The same facts `billMilestone` decides on, read in
 * four queries for the whole plan page, so "done" on a client's milestone never looks like a
 * hand-off that silently went nowhere. No money: `amountSet` says only whether one was agreed.
 */
export async function milestoneBilling(projectId: string): Promise<Map<string, MilestoneBilling>> {
  const [milestones, items, signed, [project]] = await Promise.all([
    db().select({ id: schema.projectMilestone.id, doneAt: schema.projectMilestone.doneAt, amountVnd: schema.projectMilestone.billingAmountVnd }).from(schema.projectMilestone).where(and(eq(schema.projectMilestone.projectId, projectId), eq(schema.projectMilestone.isBilling, true))),
    db()
      .select({ milestoneId: schema.projectBillingItem.milestoneId, source: schema.projectBillingItem.source, status: schema.projectBillingItem.status, amountVnd: schema.projectBillingItem.amountVnd, acceptanceScope: schema.projectAcceptance.scope })
      .from(schema.projectBillingItem)
      .leftJoin(schema.projectAcceptance, eq(schema.projectAcceptance.id, schema.projectBillingItem.acceptanceId))
      .where(eq(schema.projectBillingItem.projectId, projectId)),
    db().select({ scope: schema.projectAcceptance.scope, milestoneId: schema.projectAcceptance.milestoneId }).from(schema.projectAcceptance).where(and(eq(schema.projectAcceptance.projectId, projectId), eq(schema.projectAcceptance.status, "signed"))),
    db().select({ clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1),
  ]);
  const itemOf = new Map(items.flatMap((item) => (item.source === "milestone" && item.milestoneId ? [[item.milestoneId, item] as const] : [])));
  const wholeProjectBilled = items.some((item) => item.acceptanceScope === "project" && item.status !== "waived");
  const wholeProjectSigned = signed.some((row) => row.scope === "project");
  const signedMilestones = new Set(signed.flatMap((row) => (row.milestoneId ? [row.milestoneId] : [])));
  return new Map(
    milestones.map((milestone) => {
      const item = itemOf.get(milestone.id) ?? null;
      const state = milestoneBillingState({ item: item ? { status: item.status as BillingStatus } : null, clientWork: !!project?.clientId, accepted: wholeProjectSigned || signedMilestones.has(milestone.id), wholeProjectBilled, done: !!milestone.doneAt });
      return [milestone.id, { state, amountSet: (item ? item.amountVnd : milestone.amountVnd) !== null }];
    }),
  );
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type BillingItemView = Omit<BillingItemRow, "amountVnd"> & { amountVnd?: number | null; projectName: string; clientName: string | null; entityName: string | null; decidedByName: string | null };

/**
 * Without `pjm:commercial`, an item has no amount at all — not a zero, not a null: no key. Its
 * corrections go with it: they are the amounts it had, and the reasons given for changing them.
 */
export function shapeBillingItem<Row extends { amountVnd: number | null; corrections?: BillingCorrection[] }>(row: Row, seesFees: boolean): Omit<Row, "amountVnd"> & { amountVnd?: number | null } {
  const { amountVnd, ...rest } = row;
  return seesFees ? { ...rest, amountVnd } : "corrections" in rest ? { ...rest, corrections: [] } : rest;
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

/**
 * What waits to be invoiced in the reader's queue — how many items and their sum — counted by
 * Postgres over the whole queue, not added up over the rows the list happens to show. The same
 * cut as `listBillingQueue`: the reader's entities, and the entity the page is filtered to.
 */
export async function readyBillingTotal(principal: Principal, filters: Pick<BillingFilters, "entityId"> = {}): Promise<{ count: number; totalVnd: number }> {
  const reach = billingReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return { count: 0, totalVnd: 0 };
  const scope = reach.all ? undefined : inArray(schema.projectBillingItem.entityId, reach.entityIds);
  const entity = filters.entityId ? eq(schema.projectBillingItem.entityId, filters.entityId) : undefined;
  const [row] = await db()
    .select({ count: count(), totalVnd: sql<string>`coalesce(sum(${schema.projectBillingItem.amountVnd}), 0)` })
    .from(schema.projectBillingItem)
    .where(and(scope, entity, eq(schema.projectBillingItem.status, "ready")));
  return { count: row?.count ?? 0, totalVnd: Number(row?.totalVnd ?? 0) };
}

/** The names of the people who corrected these items' amounts, in one query — for the queue's history lines. */
export async function billingCorrectors(items: readonly { corrections: readonly BillingCorrection[] }[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.flatMap((item) => item.corrections.map((correction) => correction.byPersonId)))];
  if (ids.length === 0) return new Map();
  const rows = await db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, ids)).orderBy(asc(schema.person.fullName));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The entities a reader's queue can be filtered to — from the org module's cached list, not a query of its own. */
export async function billingEntities(principal: Principal): Promise<{ id: string; name: string }[]> {
  const reach = billingReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  const within = new Set(reach.all ? [] : reach.entityIds);
  return (await listEntities())
    .filter((entity) => reach.all || within.has(entity.id))
    .map((entity) => ({ id: entity.id, name: entity.shortName }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
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

/**
 * Corrects the amount of an item that is not yet invoiced (`pjm:commercial`): the fee was typed
 * wrong on the milestone, the retainer's fee changed after the month was made, an item made
 * without an amount gets one — or loses a wrong one. A reason is required and kept on the item
 * with the amount before and after (`corrections`), which only `pjm:commercial` reads; the audit
 * log records that it happened and why, never the figures. An invoiced or waived item is settled:
 * its amount is on an invoice, or was given up, and is not rewritten here.
 */
export async function correctBillingAmount(itemId: string, input: { amountVnd: number | null; reason: string }, actorPersonId: string): Promise<{ before: BillingItemRow; after: BillingItemRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, itemId)).limit(1).for("update");
    if (!before) throw new ActionError("billing_not_found");
    if (!billingDecidable(before.status as BillingStatus)) throw new ActionError("billing_decided");
    if (before.amountVnd === input.amountVnd) throw new ActionError("billing_amount_unchanged");
    const now = new Date();
    const corrections = [...before.corrections, { at: now.toISOString(), byPersonId: actorPersonId, reason: input.reason, beforeVnd: before.amountVnd, afterVnd: input.amountVnd }];
    const [after] = await tx.update(schema.projectBillingItem).set({ amountVnd: input.amountVnd, corrections, updatedAt: now }).where(eq(schema.projectBillingItem.id, itemId)).returning();
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

/**
 * Finance's invoice over one or more items (CRM, FR-CRM-30), inside the caller's transaction: each
 * item ready → invoiced with the invoice's number and date, an item made without an amount takes
 * the one finance typed. An item not ready — invoiced or waived meanwhile — refuses the whole
 * invoice. The account managers of the projects hear, as for a single item.
 */
export async function invoiceItemsIn(tx: Tx, itemIds: readonly string[], invoice: { number: string; date: IsoDate }, amounts: ReadonlyMap<string, number>, actorPersonId: string): Promise<BillingItemRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await tx.select().from(schema.projectBillingItem).where(inArray(schema.projectBillingItem.id, [...itemIds])).for("update");
  if (rows.length !== new Set(itemIds).size) throw new ActionError("billing_not_found");
  if (rows.some((row) => !billingDecidable(row.status as BillingStatus))) throw new ActionError("billing_decided");
  const now = new Date();
  const after: BillingItemRow[] = [];
  for (const row of rows) {
    const amountVnd = row.amountVnd ?? amounts.get(row.id) ?? null;
    if (amountVnd === null) throw new ActionError("billing_amount_required");
    const [updated] = await tx
      .update(schema.projectBillingItem)
      .set({ status: "invoiced", invoiceNumber: invoice.number, invoiceDate: invoice.date, amountVnd, decidedByPersonId: actorPersonId, decidedAt: now, updatedAt: now })
      .where(eq(schema.projectBillingItem.id, row.id))
      .returning();
    after.push(updated);
  }
  const projectIds = [...new Set(after.map((row) => row.projectId))];
  const projects = await tx.select({ id: schema.workProject.id, name: schema.workProject.name, manager: schema.projectPlan.accountManagerPersonId }).from(schema.workProject).leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id)).where(inArray(schema.workProject.id, projectIds));
  for (const project of projects) {
    const job = after.find((row) => row.projectId === project.id)?.jobNumber ?? "—";
    if (project.manager) await notify({ recipients: [project.manager], kind: "projects.billing_invoiced", params: { project: project.name, job }, link: `/projects/${project.id}/acceptance` }, tx);
  }
  return after;
}

/**
 * The items of an invoice finance voided (CRM, FR-CRM-30), inside the caller's transaction: each
 * one still invoiced under that number goes back to ready — number, date and decider cleared — for
 * the invoice that replaces it, or to be waived. Its amount stays what it was invoiced at, and can
 * be corrected again (`correctBillingAmount`) now that it is ready.
 */
export async function releaseInvoicedItemsIn(tx: Tx, itemIds: readonly string[], invoiceNumber: string): Promise<BillingItemRow[]> {
  if (itemIds.length === 0) return [];
  return tx
    .update(schema.projectBillingItem)
    .set({ status: "ready", invoiceNumber: null, invoiceDate: null, decidedByPersonId: null, decidedAt: null, updatedAt: new Date() })
    .where(and(inArray(schema.projectBillingItem.id, [...itemIds]), eq(schema.projectBillingItem.status, "invoiced"), eq(schema.projectBillingItem.invoiceNumber, invoiceNumber)))
    .returning();
}

/** Ready items by id, for finance's invoice form (the CRM checks the reader's reach first). */
export async function billingItemsByIds(itemIds: readonly string[], executor: Executor = db()): Promise<BillingItemRow[]> {
  if (itemIds.length === 0) return [];
  return executor.select().from(schema.projectBillingItem).where(inArray(schema.projectBillingItem.id, [...itemIds]));
}
