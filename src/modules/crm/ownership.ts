// What a leaver holds in the CRM (FR-CRM-40), for the work module's exit and transfer handover
// through the platform's ownership registry: the accounts they are the sales owner of, their open
// deals and leads, and their open follow-ups. (The accounts they *manage* are the work module's own
// "client_account" items: the account manager is `work_client`'s.)
//
// Who may hand them on: `crm:manage` over the item's entity — the sales director — or the owner.
// Who may receive them: for a deal or a lead, somebody who could hold it (`canOwnDeal`: a seller over
// its entity or the account's manager); anything else, any active employee.
import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { listPeopleHolding } from "../platform/rbac/service";
import type { OwnershipProvider, ProvidedGate, ProvidedItem } from "../platform/ownership/registry";
import { providedKey } from "../platform/ownership/registry";
import { accountsById, invalidateAccountProfiles } from "./accounts";
import { coversAccount, coversEntity, type CrmViewer } from "./policy";
import { invalidateTies } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;

export const CRM_OWNERSHIP_KINDS = ["crm_sales_owner", "crm_deal", "crm_lead", "crm_followup"] as const;

async function list(executor: unknown, personId: string): Promise<ProvidedItem[]> {
  const from = executor as Executor;
  const [owned, deals, leads, followUps] = await Promise.all([
    from.select({ id: schema.crmAccount.clientId, name: schema.workClient.name }).from(schema.crmAccount).innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmAccount.clientId)).where(and(eq(schema.crmAccount.salesOwnerPersonId, personId), eq(schema.workClient.isActive, true))),
    from.select({ id: schema.crmDeal.id, code: schema.crmDeal.code, title: schema.crmDeal.title, account: schema.workClient.name }).from(schema.crmDeal).innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmDeal.clientId)).where(and(eq(schema.crmDeal.ownerPersonId, personId), eq(schema.crmDeal.status, "open"))),
    from.select({ id: schema.crmLead.id, company: schema.crmLead.companyName }).from(schema.crmLead).where(and(eq(schema.crmLead.ownerPersonId, personId), inArray(schema.crmLead.status, ["new", "contacted", "qualified"]))),
    from
      .select({ id: schema.crmActivity.id, subject: schema.crmActivity.subject, dueOn: schema.crmActivity.dueOn, account: schema.workClient.name, lead: schema.crmLead.companyName })
      .from(schema.crmActivity)
      .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmActivity.clientId))
      .leftJoin(schema.crmLead, eq(schema.crmLead.id, schema.crmActivity.leadId))
      .where(and(eq(schema.crmActivity.ownerPersonId, personId), isNull(schema.crmActivity.doneAt), isNotNull(schema.crmActivity.dueOn))),
  ]);
  return [
    ...owned.map((row) => ({ kind: "crm_sales_owner", id: row.id, label: row.name, context: null })),
    ...deals.map((row) => ({ kind: "crm_deal", id: row.id, label: `${row.code} ${row.title}`, context: row.account })),
    ...leads.map((row) => ({ kind: "crm_lead", id: row.id, label: row.company, context: null })),
    ...followUps.map((row) => ({ kind: "crm_followup", id: row.id, label: `${row.dueOn ?? ""} ${row.subject}`.trim(), context: row.account ?? row.lead })),
  ];
}

async function gate(executor: unknown, runner: { principal: CrmViewer["principal"] }, items: readonly ProvidedItem[]): Promise<Map<string, ProvidedGate>> {
  const from = executor as Executor;
  const viewer: CrmViewer = { principal: runner.principal, ties: new Map() };
  const ids = (kind: string) => items.filter((item) => item.kind === kind).map((item) => item.id);
  const [accounts, deals, leads, followUps] = await Promise.all([
    accountsById(from),
    ids("crm_deal").length ? from.select({ id: schema.crmDeal.id, entityId: schema.crmDeal.entityId, clientId: schema.crmDeal.clientId }).from(schema.crmDeal).where(inArray(schema.crmDeal.id, ids("crm_deal"))) : [],
    ids("crm_lead").length ? from.select({ id: schema.crmLead.id, entityId: schema.crmLead.entityId }).from(schema.crmLead).where(inArray(schema.crmLead.id, ids("crm_lead"))) : [],
    ids("crm_followup").length ? from.select({ id: schema.crmActivity.id, clientId: schema.crmActivity.clientId, leadEntity: schema.crmLead.entityId }).from(schema.crmActivity).leftJoin(schema.crmLead, eq(schema.crmLead.id, schema.crmActivity.leadId)).where(inArray(schema.crmActivity.id, ids("crm_followup"))) : [],
  ]);
  // Who could hold a deal or a lead of an entity: its sellers and sales directors (named grants, and the owner's "*").
  const entityIds = [...new Set([...deals.map((row) => row.entityId), ...leads.map((row) => row.entityId)])];
  const holders = new Map<string | null, Set<string>>();
  await Promise.all(
    entityIds.map(async (entityId) => {
      const [sell, manage] = await Promise.all([listPeopleHolding("crm:sell", { entityId }, { executor: from }), listPeopleHolding("crm:manage", { entityId }, { executor: from })]);
      holders.set(entityId, new Set([...sell, ...manage]));
    }),
  );
  const gates = new Map<string, ProvidedGate>();
  const manages = (entityIds: readonly (string | null)[]) => coversAccount(viewer, "crm:manage", { entityIds });
  for (const item of items) {
    const key = providedKey(item);
    if (item.kind === "crm_sales_owner") {
      const account = accounts.get(item.id);
      if (account) gates.set(key, { visible: true, manage: manages(account.facts.entityIds), ownerName: null, eligible: null });
    } else if (item.kind === "crm_deal") {
      const row = deals.find((deal) => deal.id === item.id);
      if (!row) continue;
      const account = accounts.get(row.clientId);
      const eligible = new Set([...(holders.get(row.entityId) ?? []), ...(account?.client.accountManagerPersonId ? [account.client.accountManagerPersonId] : [])]);
      gates.set(key, { visible: true, manage: coversEntity(viewer, "crm:manage", row.entityId), ownerName: null, eligible });
    } else if (item.kind === "crm_lead") {
      const row = leads.find((lead) => lead.id === item.id);
      if (row) gates.set(key, { visible: true, manage: coversEntity(viewer, "crm:manage", row.entityId), ownerName: null, eligible: holders.get(row.entityId) ?? new Set() });
    } else if (item.kind === "crm_followup") {
      const row = followUps.find((activity) => activity.id === item.id);
      if (!row) continue;
      const account = row.clientId ? accounts.get(row.clientId) : undefined;
      gates.set(key, { visible: true, manage: account ? manages(account.facts.entityIds) : coversEntity(viewer, "crm:manage", row.leadEntity ?? null), ownerName: null, eligible: null });
    }
  }
  return gates;
}

async function reassign(tx: unknown, items: readonly ProvidedItem[], fromPersonId: string, toPersonId: string): Promise<() => Promise<void>> {
  const t = tx as Tx;
  const ids = (kind: string) => items.filter((item) => item.kind === kind).map((item) => item.id);
  const now = new Date();
  if (ids("crm_sales_owner").length) await t.update(schema.crmAccount).set({ salesOwnerPersonId: toPersonId, updatedAt: now }).where(and(inArray(schema.crmAccount.clientId, ids("crm_sales_owner")), eq(schema.crmAccount.salesOwnerPersonId, fromPersonId)));
  if (ids("crm_deal").length) {
    await t.update(schema.crmDeal).set({ ownerPersonId: toPersonId, updatedAt: now }).where(and(inArray(schema.crmDeal.id, ids("crm_deal")), eq(schema.crmDeal.ownerPersonId, fromPersonId)));
    // A deal's follow-ups go with it.
    await t.update(schema.crmActivity).set({ ownerPersonId: toPersonId, remindedOn: null, updatedAt: now }).where(and(inArray(schema.crmActivity.dealId, ids("crm_deal")), eq(schema.crmActivity.ownerPersonId, fromPersonId), isNull(schema.crmActivity.doneAt)));
  }
  if (ids("crm_lead").length) await t.update(schema.crmLead).set({ ownerPersonId: toPersonId, updatedAt: now }).where(and(inArray(schema.crmLead.id, ids("crm_lead")), eq(schema.crmLead.ownerPersonId, fromPersonId)));
  if (ids("crm_followup").length) await t.update(schema.crmActivity).set({ ownerPersonId: toPersonId, remindedOn: null, updatedAt: now }).where(and(inArray(schema.crmActivity.id, ids("crm_followup")), eq(schema.crmActivity.ownerPersonId, fromPersonId), isNull(schema.crmActivity.doneAt)));
  return async () => {
    await Promise.all([ids("crm_sales_owner").length ? invalidateAccountProfiles() : null, invalidateTies(fromPersonId, toPersonId)]);
  };
}

export const crmOwnership: OwnershipProvider = { kinds: CRM_OWNERSHIP_KINDS, list, gate, reassign };
