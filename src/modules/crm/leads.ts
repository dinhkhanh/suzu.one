// Leads (FR-CRM-10): an enquiry before anyone has qualified it. Anyone in the company may pass one
// on and is credited as its referrer; the sellers over its entity work it; converting it makes (or
// finds) the account and the contact and opens the deal, and tells the referrer.
import "server-only";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { entityReach } from "../platform/rbac/policy";
import { notify } from "../platform/notifications/service";
import { listPeopleHolding } from "../platform/rbac/service";
import type { LeadStatus, Source } from "./enums";
import { isOpenLead } from "./enums";
import { canViewLead, type CrmViewer, type LeadFacts } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type LeadRow = typeof schema.crmLead.$inferSelect;
export type LeadView = LeadRow & { ownerName: string | null; referrerName: string | null; clientName: string | null; entityName: string | null };

export const leadFacts = (lead: Pick<LeadRow, "entityId" | "ownerPersonId" | "referrerPersonId" | "createdByPersonId" | "status">): LeadFacts => ({
  entityId: lead.entityId,
  ownerPersonId: lead.ownerPersonId,
  referrerPersonId: lead.referrerPersonId,
  createdByPersonId: lead.createdByPersonId,
  status: lead.status as LeadStatus,
});

export const findLead = async (leadId: string, executor: Executor = db()): Promise<LeadRow | undefined> => (await executor.select().from(schema.crmLead).where(eq(schema.crmLead.id, leadId)).limit(1))[0];

async function listWhere(where: SQL | undefined, limit = 300): Promise<LeadView[]> {
  const owner = alias(schema.person, "lead_owner");
  const referrer = alias(schema.person, "lead_referrer");
  const rows = await db()
    .select({ lead: schema.crmLead, ownerName: owner.fullName, referrerName: referrer.fullName, clientName: schema.workClient.name, entityName: schema.entity.shortName })
    .from(schema.crmLead)
    .leftJoin(owner, eq(owner.id, schema.crmLead.ownerPersonId))
    .leftJoin(referrer, eq(referrer.id, schema.crmLead.referrerPersonId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmLead.clientId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.crmLead.entityId))
    .where(where)
    .orderBy(desc(schema.crmLead.createdAt))
    .limit(limit);
  return rows.map(({ lead, ...rest }) => ({ ...lead, ...rest }));
}

export type LeadFilters = { status?: LeadStatus | "open" | "all"; mine?: boolean };

/**
 * The leads this viewer may see — filtered in SQL by the same rule as `canViewLead`: their own
 * (logged, referred, owned), and every lead of the entities they sell in.
 */
export async function listLeads(viewer: CrmViewer, filters: LeadFilters = {}): Promise<LeadView[]> {
  const me = viewer.principal.personId;
  const sell = entityReach(viewer.principal, "crm:sell");
  const manage = entityReach(viewer.principal, "crm:manage");
  const all = sell.all || manage.all;
  const entities = [...(sell.all ? [] : sell.entityIds), ...(manage.all ? [] : manage.entityIds)];
  const own = me ? or(eq(schema.crmLead.ownerPersonId, me), eq(schema.crmLead.referrerPersonId, me), eq(schema.crmLead.createdByPersonId, me)) : undefined;
  const reach = filters.mine ? own : all ? undefined : or(own, entities.length ? inArray(schema.crmLead.entityId, entities) : undefined);
  if (!all && !reach) return [];
  const status = !filters.status || filters.status === "open" ? inArray(schema.crmLead.status, ["new", "contacted", "qualified"]) : filters.status === "all" ? undefined : eq(schema.crmLead.status, filters.status);
  const rows = await listWhere(and(reach, status));
  // The SQL already applies the rule; the policy is asked again so the two can never drift apart.
  return rows.filter((lead) => canViewLead(viewer, leadFacts(lead)));
}

export async function getLead(leadId: string): Promise<LeadView | undefined> {
  return (await listWhere(eq(schema.crmLead.id, leadId), 1))[0];
}

export type LeadInput = {
  entityId: string | null;
  clientId: string | null;
  companyName: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  need: string | null;
  budgetText: string | null;
  source: Source;
};

/** The sales directors of an entity: named `crm:manage` holders over it (never the owners' "*"). */
const salesManagersOf = (executor: Executor, entityId: string | null): Promise<string[]> => listPeopleHolding("crm:manage", { entityId }, { includeWildcard: false, executor });

/**
 * A new lead. Logged by a seller for themselves, it is theirs; passed on by anyone else it is a
 * referral — the logger is its referrer, and it waits unassigned for the sales directors of its
 * entity, who are told.
 */
export async function createLead(input: LeadInput, actor: { personId: string; sells: boolean }, ownerPersonId: string | null): Promise<LeadRow> {
  return db().transaction(async (tx) => {
    const owner = ownerPersonId ?? (actor.sells ? actor.personId : null);
    const [lead] = await tx
      .insert(schema.crmLead)
      .values({ ...input, email: input.email?.trim().toLowerCase() || null, ownerPersonId: owner, referrerPersonId: actor.sells ? null : actor.personId, createdByPersonId: actor.personId })
      .returning();
    if (owner && owner !== actor.personId) await notify({ recipients: [owner], kind: "crm.lead_assigned", params: { company: lead.companyName }, link: `/crm/leads/${lead.id}` }, tx);
    if (!owner) {
      const managers = (await salesManagersOf(tx, lead.entityId)).filter((id) => id !== actor.personId);
      if (managers.length) await notify({ recipients: managers, kind: "crm.lead_assigned", params: { company: lead.companyName }, link: `/crm/leads/${lead.id}` }, tx);
    }
    return lead;
  });
}

async function lockOpen(tx: Tx, leadId: string): Promise<LeadRow> {
  const [lead] = await tx.select().from(schema.crmLead).where(eq(schema.crmLead.id, leadId)).limit(1).for("update");
  if (!lead) throw new ActionError("lead_not_found");
  if (!isOpenLead(lead.status as LeadStatus)) throw new ActionError("lead_closed");
  return lead;
}

export async function updateLead(leadId: string, input: LeadInput): Promise<{ before: LeadRow; after: LeadRow }> {
  return db().transaction(async (tx) => {
    const before = await lockOpen(tx, leadId);
    const [after] = await tx
      .update(schema.crmLead)
      .set({ ...input, email: input.email?.trim().toLowerCase() || null, updatedAt: new Date() })
      .where(eq(schema.crmLead.id, leadId))
      .returning();
    return { before, after };
  });
}

/** A new owner, who is told. */
export async function assignLead(leadId: string, ownerPersonId: string, actorPersonId: string): Promise<{ before: LeadRow; after: LeadRow }> {
  return db().transaction(async (tx) => {
    const before = await lockOpen(tx, leadId);
    const [person] = await tx.select({ status: schema.person.status, workforceType: schema.person.workforceType }).from(schema.person).where(eq(schema.person.id, ownerPersonId)).limit(1);
    if (!person || person.status === "offboarded" || person.workforceType === "collaborator") throw new ActionError("person_not_found");
    const [after] = await tx.update(schema.crmLead).set({ ownerPersonId, updatedAt: new Date() }).where(eq(schema.crmLead.id, leadId)).returning();
    if (ownerPersonId !== actorPersonId) await notify({ recipients: [ownerPersonId], kind: "crm.lead_assigned", params: { company: after.companyName }, link: `/crm/leads/${leadId}` }, tx);
    return { before, after };
  });
}

/** Contacted or qualified — the steps before conversion; or disqualified, with the reason. */
export async function setLeadStatus(leadId: string, status: "contacted" | "qualified" | "disqualified", reason: string | null): Promise<{ before: LeadRow; after: LeadRow }> {
  if (status === "disqualified" && !reason?.trim()) throw new ActionError("lead_reason_required");
  return db().transaction(async (tx) => {
    const before = await lockOpen(tx, leadId);
    const [after] = await tx
      .update(schema.crmLead)
      .set({ status, disqualifyReason: status === "disqualified" ? reason : null, updatedAt: new Date() })
      .where(eq(schema.crmLead.id, leadId))
      .returning();
    return { before, after };
  });
}

/**
 * Erasure for somebody who is only a lead's contact (PDPL): an enquiry that never became an account
 * has no contact record to erase, so its own fields are blanked here — the name, the title, the
 * email and the phone. The company, the need and the lead's history stay; an open or a closed lead
 * alike, since a request to be forgotten does not wait for the pipeline. Cannot be undone.
 */
export async function eraseLeadContact(leadId: string): Promise<{ before: LeadRow; after: LeadRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmLead).where(eq(schema.crmLead.id, leadId)).limit(1).for("update");
    if (!before) throw new ActionError("lead_not_found");
    if (!before.contactName && !before.contactTitle && !before.email && !before.phone) throw new ActionError("lead_contact_erased");
    const [after] = await tx.update(schema.crmLead).set({ contactName: null, contactTitle: null, email: null, phone: null, updatedAt: new Date() }).where(eq(schema.crmLead.id, leadId)).returning();
    return { before, after };
  });
}

/**
 * The lead is now a deal (inside the conversion's transaction): converted, pointing at its deal and
 * account; the referrer — somebody outside sales who passed it on — hears that it became a deal.
 */
export async function markConvertedIn(tx: Tx, leadId: string, dealId: string, clientId: string): Promise<LeadRow> {
  const lead = await lockOpen(tx, leadId);
  const [after] = await tx.update(schema.crmLead).set({ status: "converted", convertedDealId: dealId, convertedAt: new Date(), clientId, updatedAt: new Date() }).where(eq(schema.crmLead.id, leadId)).returning();
  if (lead.referrerPersonId) await notify({ recipients: [lead.referrerPersonId], kind: "crm.lead_converted", params: { company: lead.companyName }, link: `/crm/leads/${leadId}` }, tx);
  return after;
}

/** Open leads per owner (the exit handover and leave cover counts). */
export async function listOpenLeadsOf(personId: string): Promise<LeadRow[]> {
  return db()
    .select()
    .from(schema.crmLead)
    .where(and(eq(schema.crmLead.ownerPersonId, personId), inArray(schema.crmLead.status, ["new", "contacted", "qualified"])))
    .orderBy(desc(schema.crmLead.createdAt));
}
