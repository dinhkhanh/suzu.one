// Won → delivery (FR-CRM-14..16): the pitch project a deal may open, the delivery project(s) a won
// deal becomes — made through the work module's project path and filled by the projects module's
// sale plan, all in one transaction — and the sales → delivery hand-off its lead accepts or returns.
//
// The CRM decides what was sold (engine/delivery.ts); it never writes a project table itself.
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { applySalePlanIn, applyTemplatePlanIn, markPitchIn } from "@/modules/projects/service";
import { createProjectFromTemplate, createProjectIn, invalidateMemberships, invalidateWorkDirectory, type ProjectInput, type ProjectRow, type Visibility } from "@/modules/work/service";
import type { HandoffNote } from "../work/schema";
import { findAccount } from "./accounts";
import { salePlanFrom, type SaleContact, type SaleLine } from "./engine/delivery";
import { type DealRow, findDeal } from "./deals";
import { invalidateTies } from "./viewer";

export type DealProjectRow = typeof schema.crmDealProject.$inferSelect;

async function lockDeal(tx: Tx, dealId: string): Promise<DealRow> {
  const [deal] = await tx.select().from(schema.crmDeal).where(eq(schema.crmDeal.id, dealId)).limit(1).for("update");
  if (!deal) throw new ActionError("deal_not_found");
  return deal;
}

// ── Pitch projects (FR-CRM-14) ──────────────────────────────────────────────────────────────

export type PitchInput = { teamId: string; leadPersonId: string; name: string; dueDate: IsoDate | null };

/**
 * Opens the deal's pitch project in the delivering team: a PJM project of kind "pitch", team-visible,
 * with the deal's owner among its people. The time logged on it is the deal's cost of sale.
 */
export async function openPitchProject(dealId: string, input: PitchInput, actorPersonId: string): Promise<ProjectRow> {
  const project = await db().transaction(async (tx) => {
    const deal = await lockDeal(tx, dealId);
    if (deal.status !== "open") throw new ActionError("deal_closed");
    if (deal.pitchProjectId) throw new ActionError("pitch_exists");
    const [stage] = await tx.select({ allowsPitch: schema.crmStage.allowsPitch }).from(schema.crmStage).where(eq(schema.crmStage.id, deal.stageId)).limit(1);
    if (!stage?.allowsPitch) throw new ActionError("pitch_not_allowed");
    const made = await createProjectIn(tx, { teamId: input.teamId, name: input.name, description: null, clientId: deal.brandId ?? deal.clientId, status: "active", visibility: "team", leadPersonId: input.leadPersonId, startDate: todayInVietnam(), dueDate: input.dueDate }, actorPersonId);
    await markPitchIn(tx, made.id);
    // The seller pitches with the team: a member of the pitch, whose time on it is the cost of sale.
    if (deal.ownerPersonId !== actorPersonId && deal.ownerPersonId !== input.leadPersonId) await tx.insert(schema.workProjectMember).values({ projectId: made.id, personId: deal.ownerPersonId, role: "member" }).onConflictDoNothing();
    await tx.update(schema.crmDeal).set({ pitchProjectId: made.id, teamId: deal.teamId ?? input.teamId, updatedAt: new Date() }).where(eq(schema.crmDeal.id, dealId));
    return { made, owner: deal.ownerPersonId };
  });
  await Promise.all([invalidateWorkDirectory(), invalidateMemberships(project.owner), invalidateTies(actorPersonId, input.leadPersonId, project.owner)]);
  return project.made;
}

// ── Won → delivery set-up (FR-CRM-15) ───────────────────────────────────────────────────────

export type DeliverySetup = {
  teamId: string;
  leadPersonId: string;
  name: string;
  templateId: string | null;
  startDate: IsoDate;
  dueDate: IsoDate | null;
  visibility: Visibility;
  contractId: string | null;
  /** The hand-off note to the project's lead (FR-PJM-43 shape); the sale's own facts are added to it. */
  note: HandoffNote;
};

/** The accepted quote's lines, or none. */
async function soldLines(executor: Tx, dealId: string): Promise<SaleLine[]> {
  const [quote] = await executor.select({ id: schema.crmQuote.id }).from(schema.crmQuote).where(and(eq(schema.crmQuote.dealId, dealId), eq(schema.crmQuote.status, "accepted"))).orderBy(desc(schema.crmQuote.version)).limit(1);
  if (!quote) return [];
  const lines = await executor.select().from(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quote.id)).orderBy(asc(schema.crmQuoteLine.sortOrder));
  return lines.map((line) => ({ title: line.title, quantity: line.quantity, unitPriceVnd: line.unitPriceVnd, discountBp: line.discountBp, months: line.months, format: line.format, channel: line.channel, roleMinutes: line.roleMinutes }));
}

/**
 * The deal's contacts as a project may know them: a name and a role (their part in the deal, else
 * their title). Email, phone and Zalo are never selected here — a brief and a hand-off note are read
 * by everyone on the project, and a contact's details only by the people who work with the account
 * (SRS §4.15, design rule 4), who find them on the account's contact list.
 */
async function soldContacts(executor: Tx, dealId: string): Promise<SaleContact[]> {
  const rows = await executor
    .select({ name: schema.crmContact.fullName, title: schema.crmContact.title, role: schema.crmDealContact.role })
    .from(schema.crmDealContact)
    .innerJoin(schema.crmContact, eq(schema.crmContact.id, schema.crmDealContact.contactId))
    .where(eq(schema.crmDealContact.dealId, dealId))
    .orderBy(asc(schema.crmContact.searchName));
  return rows.map((row) => ({ name: row.name, role: row.role ?? row.title }));
}

/**
 * Makes one delivery project of a won deal, prefilled from what was sold, and hands it to its lead.
 * A deal may become several projects (a campaign and its retainer); running the set-up again for
 * the same project name after a failure makes nothing twice, because everything is one transaction.
 */
export async function setUpDelivery(dealId: string, setup: DeliverySetup, actorPersonId: string): Promise<{ project: ProjectRow; link: DealProjectRow }> {
  const deal = await findDeal(dealId);
  if (!deal) throw new ActionError("deal_not_found");
  if (deal.status !== "won") throw new ActionError("deal_not_won");
  const account = await findAccount(deal.clientId);
  if (!account) throw new ActionError("account_not_found");
  if (setup.contractId) {
    const [contract] = await db().select({ clientId: schema.crmContract.clientId }).from(schema.crmContract).where(eq(schema.crmContract.id, setup.contractId)).limit(1);
    if (!contract || contract.clientId !== account.client.id) throw new ActionError("contract_not_found");
  }
  const input: ProjectInput = { teamId: setup.teamId, name: setup.name, description: null, clientId: deal.brandId ?? deal.clientId, status: "planned", visibility: setup.visibility, leadPersonId: setup.leadPersonId, startDate: setup.startDate, dueDate: setup.dueDate };
  let link: DealProjectRow | null = null;

  const fill = async (tx: Tx, project: ProjectRow) => {
    await lockDeal(tx, dealId);
    const plan = salePlanFrom(deal, await soldLines(tx, dealId), await soldContacts(tx, dealId), setup.startDate.slice(0, 7));
    await applySalePlanIn(tx, project.id, {
      ...plan,
      budgetByRole: plan.budgetByRole,
      accountManagerPersonId: account.client.accountManagerPersonId ?? (deal.ownerPersonId !== setup.leadPersonId ? deal.ownerPersonId : null),
      viewerPersonIds: [deal.ownerPersonId],
    });
    if (setup.contractId) await tx.insert(schema.crmContractProject).values({ projectId: project.id, contractId: setup.contractId }).onConflictDoNothing();
    const note: HandoffNote = { ...setup.note, done: setup.note.done || plan.brief.scopeIn, contacts: setup.note.contacts || plan.brief.clientContacts.map((contact) => [contact.name, contact.role].filter(Boolean).join(" — ")).join("\n") };
    const accepted = setup.leadPersonId === actorPersonId;
    [link] = await tx
      .insert(schema.crmDealProject)
      .values({ projectId: project.id, dealId, handoffNote: note, handoffStatus: accepted ? "accepted" : "pending", handoffToPersonId: setup.leadPersonId, handoffRespondedAt: accepted ? new Date() : null, createdByPersonId: actorPersonId })
      .returning();
    if (!accepted) await notify({ recipients: [setup.leadPersonId], kind: "crm.delivery_handoff", params: { deal: deal.title, project: project.name }, link: `/crm/deals/${dealId}` }, tx);
  };

  let project: ProjectRow;
  if (setup.templateId) {
    ({ project } = await createProjectFromTemplate(input, { templateId: setup.templateId, anchor: { mode: "start", date: setup.startDate }, roles: {} }, actorPersonId, async (tx, made) => {
      await applyTemplatePlanIn(tx, made);
      await fill(tx, made.project);
    }));
  } else {
    project = await db().transaction(async (tx) => {
      const made = await createProjectIn(tx, input, actorPersonId);
      await fill(tx, made);
      return made;
    });
    await invalidateWorkDirectory();
  }
  await invalidateTies(deal.ownerPersonId, setup.leadPersonId, account.client.accountManagerPersonId);
  return { project, link: link! };
}

// ── The sales → delivery hand-off (FR-CRM-16) ───────────────────────────────────────────────

export type DealProjectView = DealProjectRow & { projectName: string; projectStatus: string; jobNumber: string | null; leadName: string | null };

export async function listDealProjects(dealIds: readonly string[]): Promise<DealProjectView[]> {
  if (dealIds.length === 0) return [];
  const lead = alias(schema.person, "handoff_lead");
  const rows = await db()
    .select({ link: schema.crmDealProject, projectName: schema.workProject.name, projectStatus: schema.workProject.status, jobNumber: schema.projectPlan.jobNumber, leadName: lead.fullName })
    .from(schema.crmDealProject)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.crmDealProject.projectId))
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.workProject.id))
    .leftJoin(lead, eq(lead.id, schema.crmDealProject.handoffToPersonId))
    .where(inArray(schema.crmDealProject.dealId, [...dealIds]))
    .orderBy(asc(schema.crmDealProject.createdAt));
  return rows.map(({ link, ...rest }) => ({ ...link, ...rest }));
}

/** The deal a project came from (the project page's link back, FR-CRM-46). */
export async function dealOfProject(projectId: string): Promise<{ dealId: string; code: string; title: string; handoffStatus: string; entityId: string | null; ownerPersonId: string; status: string } | null> {
  const [row] = await db()
    .select({ dealId: schema.crmDeal.id, code: schema.crmDeal.code, title: schema.crmDeal.title, handoffStatus: schema.crmDealProject.handoffStatus, entityId: schema.crmDeal.entityId, ownerPersonId: schema.crmDeal.ownerPersonId, status: schema.crmDeal.status })
    .from(schema.crmDealProject)
    .innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealProject.dealId))
    .where(eq(schema.crmDealProject.projectId, projectId))
    .limit(1);
  return row ?? null;
}

export type SalesHandoffWaiting = { projectId: string; projectName: string; dealId: string; dealTitle: string; fromPersonId: string | null; fromName: string | null; createdAt: Date };

/** Sales hand-offs waiting for this person to accept (Today, My work). */
export async function listSalesHandoffsFor(personId: string): Promise<SalesHandoffWaiting[]> {
  const from = alias(schema.person, "handoff_from");
  return db()
    .select({ projectId: schema.crmDealProject.projectId, projectName: schema.workProject.name, dealId: schema.crmDeal.id, dealTitle: schema.crmDeal.title, fromPersonId: schema.crmDealProject.createdByPersonId, fromName: from.fullName, createdAt: schema.crmDealProject.createdAt })
    .from(schema.crmDealProject)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.crmDealProject.projectId))
    .innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealProject.dealId))
    .leftJoin(from, eq(from.id, schema.crmDealProject.createdByPersonId))
    .where(and(eq(schema.crmDealProject.handoffToPersonId, personId), eq(schema.crmDealProject.handoffStatus, "pending")))
    .orderBy(asc(schema.crmDealProject.createdAt));
}

/**
 * The lead accepts the hand-off, or returns it with a reason — the deal's owner hears either way.
 * A returned hand-off can be sent again with a better note (`resendHandoff`).
 */
export async function respondToHandoff(projectId: string, answer: { accept: true } | { accept: false; reason: string }, actorPersonId: string): Promise<{ before: DealProjectRow; after: DealProjectRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmDealProject).where(eq(schema.crmDealProject.projectId, projectId)).limit(1).for("update");
    if (!before) throw new ActionError("handoff_not_found");
    if (before.handoffStatus !== "pending") throw new ActionError("handoff_answered");
    if (before.handoffToPersonId !== actorPersonId) throw new ActionError("handoff_not_yours");
    if (!answer.accept && !answer.reason.trim()) throw new ActionError("handoff_reason_required");
    const [after] = await tx
      .update(schema.crmDealProject)
      .set({ handoffStatus: answer.accept ? "accepted" : "returned", handoffRespondedAt: new Date(), handoffReturnReason: answer.accept ? null : answer.reason })
      .where(eq(schema.crmDealProject.projectId, projectId))
      .returning();
    const [facts] = await tx
      .select({ owner: schema.crmDeal.ownerPersonId, deal: schema.crmDeal.title, project: schema.workProject.name })
      .from(schema.crmDealProject)
      .innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealProject.dealId))
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.crmDealProject.projectId))
      .where(eq(schema.crmDealProject.projectId, projectId))
      .limit(1);
    if (facts && facts.owner !== actorPersonId) await notify({ recipients: [facts.owner], kind: "crm.delivery_handoff_answered", params: { deal: facts.deal, project: facts.project, outcome: answer.accept ? "approved" : "returned" }, link: `/crm/deals/${before.dealId}` }, tx);
    return { before, after };
  });
}

/** A returned hand-off goes back to the lead with a new note. */
export async function resendHandoff(projectId: string, note: HandoffNote, actorPersonId: string): Promise<DealProjectRow> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmDealProject).where(eq(schema.crmDealProject.projectId, projectId)).limit(1).for("update");
    if (!before) throw new ActionError("handoff_not_found");
    if (before.handoffStatus !== "returned") throw new ActionError("handoff_not_returned");
    const [after] = await tx.update(schema.crmDealProject).set({ handoffNote: note, handoffStatus: "pending", handoffRespondedAt: null, handoffReturnReason: null }).where(eq(schema.crmDealProject.projectId, projectId)).returning();
    const [facts] = await tx.select({ deal: schema.crmDeal.title, project: schema.workProject.name }).from(schema.crmDeal).innerJoin(schema.workProject, eq(schema.workProject.id, projectId)).where(eq(schema.crmDeal.id, before.dealId)).limit(1);
    if (after.handoffToPersonId && after.handoffToPersonId !== actorPersonId) await notify({ recipients: [after.handoffToPersonId], kind: "crm.delivery_handoff", params: { deal: facts?.deal ?? "", project: facts?.project ?? "" }, link: `/crm/deals/${before.dealId}` }, tx);
    return after;
  });
}
