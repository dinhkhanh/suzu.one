// Who may see and change what in the CRM (SRS §4.15, access rules). Pure: the service loads the
// viewer's ties to accounts once per request (viewer.ts) and asks these functions.
//
// Rights come from the account first — its manager, its sales owner, its named members, the owners
// of its deals and the people of its open projects are its **team** and work it without any
// permission — and from `crm:sell` / `crm:manage` over the entity for the people who sell. Money:
//   deal values, quotes   → the deal's owner, the account's manager, crm:sell / crm:manage /
//                           pjm:commercial over the deal's entity
//   receivables           → the account's manager, crm:manage / pjm:commercial over its entities
//   cost and margin       → pjm:cost (and nothing here: the profitability report decides)
// Contact details are `personal`-tier data of people outside the company: the account team and the
// sellers over its entities. Everyone else who may see the account sees names, titles and roles.
import { can, type Principal } from "../platform/rbac/policy";
import type { DealStatus, LeadStatus } from "./enums";
import { isOpenLead } from "./enums";

/** How a person is tied to an account. `project` = one of the people of an open project of it. */
export type AccountTie = "manager" | "sales_owner" | "member" | "deal_owner" | "project";

export type CrmViewer = {
  principal: Principal;
  /** Accounts (client ids) whose team the viewer is on, and how. */
  ties: ReadonlyMap<string, readonly AccountTie[]>;
};

/** An account as the rules see it. `entityIds`: the client's entity and its contracting entity. */
export type AccountFacts = { clientId: string; entityIds: readonly (string | null)[]; accountManagerPersonId: string | null; salesOwnerPersonId: string | null };

export type DealFacts = { id: string; entityId: string | null; ownerPersonId: string; status: DealStatus; account: AccountFacts };

export type LeadFacts = { entityId: string | null; ownerPersonId: string | null; referrerPersonId: string | null; createdByPersonId: string | null; status: LeadStatus };

type CrmPermission = "crm:sell" | "crm:manage" | "pjm:commercial";

const me = (viewer: CrmViewer): string | null => viewer.principal.personId;
const isCollaborator = (viewer: CrmViewer): boolean => viewer.principal.workforceType === "collaborator";

/**
 * Does the permission cover the account? An account belongs to its client's entity and to the
 * entity that contracts with it; a grant over either covers it, and a group-wide grant covers every
 * account, including one with no entity at all.
 */
export function coversAccount(viewer: CrmViewer, permission: CrmPermission, account: Pick<AccountFacts, "entityIds">): boolean {
  if (can(viewer.principal, permission, { entityId: null })) return true;
  return account.entityIds.some((entityId) => !!entityId && can(viewer.principal, permission, { entityId }));
}

/** Does the permission cover a record of one entity (a deal, a lead, an invoice)? null = group-wide grants only. */
export const coversEntity = (viewer: CrmViewer, permission: CrmPermission, entityId: string | null): boolean => can(viewer.principal, permission, { entityId });

const sells = (viewer: CrmViewer, account: Pick<AccountFacts, "entityIds">): boolean => coversAccount(viewer, "crm:sell", account) || coversAccount(viewer, "crm:manage", account);

export const isOnAccountTeam = (viewer: CrmViewer, clientId: string): boolean => viewer.ties.has(clientId);
export const tiesTo = (viewer: CrmViewer, clientId: string): readonly AccountTie[] => viewer.ties.get(clientId) ?? [];
const isManagerOf = (viewer: CrmViewer, account: AccountFacts): boolean => !!me(viewer) && account.accountManagerPersonId === me(viewer);
const isSalesOwnerOf = (viewer: CrmViewer, account: AccountFacts): boolean => !!me(viewer) && account.salesOwnerPersonId === me(viewer);

// ── Accounts ────────────────────────────────────────────────────────────────────────────────

/** The CRM's pages (and its navigation entry): every employee; a collaborator only on an account's team. */
export const canOpenCrm = (viewer: CrmViewer): boolean => !isCollaborator(viewer) || viewer.ties.size > 0;

/** An account's page: names, brands, projects — what the client list already shows everyone. */
export const canViewAccount = (viewer: CrmViewer, account: AccountFacts): boolean => !isCollaborator(viewer) || isOnAccountTeam(viewer, account.clientId);

/** Contacts' details, activities, the timeline's CRM items: the account team and the sellers over it. */
export const canWorkAccount = (viewer: CrmViewer, account: AccountFacts): boolean => isOnAccountTeam(viewer, account.clientId) || sells(viewer, account);

/** Adding and changing contacts, logging activities: the same people, but a collaborator only reads. */
export const canEditContacts = (viewer: CrmViewer, account: AccountFacts): boolean => (isOnAccountTeam(viewer, account.clientId) && !isCollaborator(viewer)) || sells(viewer, account);
export const canLogActivity = canEditContacts;

/** The profile (legal name, tax code, tier, lifecycle…): the account's manager and sales owner, and the sellers over it. */
export const canEditAccount = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || isSalesOwnerOf(viewer, account) || sells(viewer, account);

/** Who is on the team by name, and who owns the sale: the manager, the sales owner, `crm:manage`. */
export const canManageAccountTeam = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || isSalesOwnerOf(viewer, account) || coversAccount(viewer, "crm:manage", account);

/** Payment terms, credit hold and limit: commercial terms — `crm:manage` or finance over the account. */
export const canEditCommercialTerms = (viewer: CrmViewer, account: AccountFacts): boolean => coversAccount(viewer, "crm:manage", account) || coversAccount(viewer, "pjm:commercial", account);

/** A new account (a new client with its profile): the sellers, over the entity it is made in. */
export const canCreateAccount = (viewer: CrmViewer, entityId: string | null): boolean => coversEntity(viewer, "crm:sell", entityId) || coversEntity(viewer, "crm:manage", entityId);

/** Erasing a contact on request (PDPL): whoever runs the account's commercial side. */
export const canEraseContact = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || coversAccount(viewer, "crm:manage", account);

/** Open and overdue amounts, invoices and payments of the account. */
export const canSeeReceivables = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || coversAccount(viewer, "crm:manage", account) || coversAccount(viewer, "pjm:commercial", account);

/** The value of the account's contracts and the pipeline total on its page. */
export const canSeeAccountMoney = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || isSalesOwnerOf(viewer, account) || sells(viewer, account) || coversAccount(viewer, "pjm:commercial", account);

// ── Activities and follow-ups ───────────────────────────────────────────────────────────────

export type ActivityFacts = { ownerPersonId: string; createdByPersonId: string | null };

/** Completing, moving or rewording a follow-up: its owner, who wrote it, and `crm:manage` over the account. */
export function canEditActivity(viewer: CrmViewer, activity: ActivityFacts, account: AccountFacts | null): boolean {
  const self = me(viewer);
  if (self && (activity.ownerPersonId === self || activity.createdByPersonId === self)) return true;
  return !!account && coversAccount(viewer, "crm:manage", account);
}

// ── Leads ───────────────────────────────────────────────────────────────────────────────────

/** Anyone in the company may pass on an enquiry — a referral — except collaborators. */
export const canLogLead = (viewer: CrmViewer): boolean => !isCollaborator(viewer);

/** A lead: whoever logged, referred or owns it, and the sellers over its entity. */
export function canViewLead(viewer: CrmViewer, lead: LeadFacts): boolean {
  const self = me(viewer);
  if (self && (lead.ownerPersonId === self || lead.referrerPersonId === self || lead.createdByPersonId === self)) return true;
  return coversEntity(viewer, "crm:sell", lead.entityId) || coversEntity(viewer, "crm:manage", lead.entityId);
}

/** Qualifying, contacting, converting, disqualifying: the owner and the sellers over its entity. A referrer only reads. */
export function canWorkLead(viewer: CrmViewer, lead: LeadFacts): boolean {
  if (!isOpenLead(lead.status)) return false;
  const self = me(viewer);
  if (self && lead.ownerPersonId === self) return true;
  return coversEntity(viewer, "crm:sell", lead.entityId) || coversEntity(viewer, "crm:manage", lead.entityId);
}

/**
 * Erasing a lead's contact on request (PDPL): whoever runs sales over its entity. A lead has no
 * account manager to ask, and its owner works it without holding the say over personal data.
 */
export const canEraseLeadContact = (viewer: CrmViewer, lead: LeadFacts): boolean => coversEntity(viewer, "crm:manage", lead.entityId);

/** The leads page lists what the reader may see; opening it at all is `canLogLead`. */
export const canOpenLeads = canLogLead;

// ── Deals ───────────────────────────────────────────────────────────────────────────────────

/** A deal's existence, stage, services and dates: its owner, its account's team, the sellers over its entity. */
export function canViewDeal(viewer: CrmViewer, deal: DealFacts): boolean {
  if (me(viewer) === deal.ownerPersonId) return true;
  return isOnAccountTeam(viewer, deal.account.clientId) || coversEntity(viewer, "crm:sell", deal.entityId) || coversEntity(viewer, "crm:manage", deal.entityId);
}

/**
 * A deal's value and its quotes' prices. A delivery lead on the account sees what is coming — stage,
 * services, dates, hours — without the price, as a project member sees a project without its fee.
 */
export function canSeeDealValue(viewer: CrmViewer, deal: DealFacts): boolean {
  if (me(viewer) === deal.ownerPersonId || isManagerOf(viewer, deal.account)) return true;
  return coversEntity(viewer, "crm:sell", deal.entityId) || coversEntity(viewer, "crm:manage", deal.entityId) || coversEntity(viewer, "pjm:commercial", deal.entityId);
}

/** Changing an open deal — stage, value, dates, contacts, quotes: its owner, the account's manager, `crm:manage`. */
export function canEditDeal(viewer: CrmViewer, deal: DealFacts): boolean {
  if (deal.status !== "open") return false;
  if (me(viewer) === deal.ownerPersonId || isManagerOf(viewer, deal.account)) return true;
  return coversEntity(viewer, "crm:manage", deal.entityId);
}

/**
 * Handing a deal to someone else: its owner may pass it on, `crm:manage` may move any in scope.
 * The new owner must be able to hold it (`canOwnDeal`), which the service checks.
 */
export function canReassignDeal(viewer: CrmViewer, deal: DealFacts): boolean {
  if (deal.status !== "open") return false;
  return me(viewer) === deal.ownerPersonId || coversEntity(viewer, "crm:manage", deal.entityId);
}

/**
 * Opening a deal on an account: `crm:sell` over the entity that will contract, or the account's own
 * manager — an account manager grows their client without being in sales (SRS Q26).
 */
export const canCreateDeal = (viewer: CrmViewer, account: AccountFacts, entityId: string | null): boolean => isManagerOf(viewer, account) || coversEntity(viewer, "crm:sell", entityId) || coversEntity(viewer, "crm:manage", entityId);

/** Who may be named a deal's owner: an active employee who could have opened it (checked with their own grants). */
export const canOwnDeal = canCreateDeal;

/** The delivery set-up of a won deal (FR-CRM-15): the people who closed it, and `crm:manage`. */
export function canSetUpDelivery(viewer: CrmViewer, deal: DealFacts): boolean {
  if (deal.status !== "won") return false;
  if (me(viewer) === deal.ownerPersonId || isManagerOf(viewer, deal.account)) return true;
  return coversEntity(viewer, "crm:manage", deal.entityId);
}

/** Reopening a won or lost deal (a mistake, a client who came back): `crm:manage` only — it rewrites the history the reports count. */
export const canReopenDeal = (viewer: CrmViewer, deal: DealFacts): boolean => deal.status !== "open" && coversEntity(viewer, "crm:manage", deal.entityId);

// ── Recording an activity ───────────────────────────────────────────────────────────────────

/** The records one activity or follow-up names. A contact is not here: it is its account's, and the account's rule covers it. */
export type ActivityTargets = { lead: LeadFacts | null; account: AccountFacts | null; deal: DealFacts | null };

/**
 * Logging an activity or planning a follow-up (FR-CRM-06): **every** record the request names must
 * pass its own rule — the lead's (`canWorkLead`), the account's (`canLogActivity`), the deal's
 * (`canViewDeal`, and it is named with its own account) — never one of them on behalf of the rest.
 * A right over a lead says nothing about an account that happens to be in the same request.
 */
export function canRecordActivity(viewer: CrmViewer, targets: ActivityTargets): boolean {
  const { lead, account, deal } = targets;
  if (!lead && !account) return false;
  if (lead && !canWorkLead(viewer, lead)) return false;
  if (account && !canLogActivity(viewer, account)) return false;
  if (deal && (!account || deal.account.clientId !== account.clientId || !canViewDeal(viewer, deal))) return false;
  return true;
}

// ── Quotes ──────────────────────────────────────────────────────────────────────────────────

/** Quotes are prices: whoever sees the deal's value reads them. */
export const canViewQuotes = canSeeDealValue;
/** Drafting, sending and recording the client's answer: whoever may change the deal. */
export const canEditQuotes = canEditDeal;
/** A quote's estimated margin: `pjm:cost` over the deal's entity, as an aggregate (FR-CRM-24). */
export const canSeeQuoteMargin = (viewer: CrmViewer, deal: Pick<DealFacts, "entityId">): boolean => can(viewer.principal, "pjm:cost", { entityId: deal.entityId });

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

/** A contract's existence, number and dates: whoever works the account. Its value: `canSeeAccountMoney`. */
export const canViewContracts = canWorkAccount;

/** Drafting, signing and ending contracts: the account's manager and the sellers over it. */
export const canEditContracts = (viewer: CrmViewer, account: AccountFacts): boolean => isManagerOf(viewer, account) || sells(viewer, account);

// ── Invoices and payments ───────────────────────────────────────────────────────────────────

/** Recording invoices, payments and write-offs: finance over the invoice's entity. */
export const canRecordInvoices = (viewer: CrmViewer, entityId: string | null): boolean => coversEntity(viewer, "pjm:commercial", entityId);

/** The receivables page (and its navigation entry): finance, `crm:manage`, or anyone managing an account. */
export const canOpenReceivables = (viewer: CrmViewer, managesAnAccount: boolean): boolean => managesAnAccount || can(viewer.principal, "pjm:commercial") || can(viewer.principal, "crm:manage");

// ── Configuration ───────────────────────────────────────────────────────────────────────────

/** The stages and the rate card are the group's: a group-wide `crm:manage` grant. */
export const canConfigureCrm = (viewer: CrmViewer): boolean => can(viewer.principal, "crm:manage", { entityId: null });

/** An entity's own list price for a service: `crm:manage` over that entity. */
export const canPriceForEntity = (viewer: CrmViewer, entityId: string | null): boolean => coversEntity(viewer, "crm:manage", entityId);

/** The pipeline pages (board, forecast): anyone who sells or runs sales somewhere, or owns a deal. */
export const canOpenPipeline = (viewer: CrmViewer, ownsADeal: boolean): boolean => ownsADeal || can(viewer.principal, "crm:sell") || can(viewer.principal, "crm:manage") || [...viewer.ties.values()].some((ties) => ties.includes("manager"));
