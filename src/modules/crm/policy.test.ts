// Who may see and change what in the CRM (SRS §4.15, access rules): the account's own people, the
// sellers (`crm:sell`, role `sales`), sales directors (`crm:manage`), finance (`pjm:commercial`)
// and everyone else — with money, contact details and receivables each behind their own rule.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../platform/rbac/policy";
import {
  type AccountFacts,
  type AccountTie,
  canConfigureCrm,
  canCreateAccount,
  canCreateDeal,
  canEditAccount,
  canEditActivity,
  canEditCommercialTerms,
  canEditContacts,
  canEditDeal,
  canEraseContact,
  canEraseLeadContact,
  canLogLead,
  canManageAccountTeam,
  canOpenCrm,
  canOpenReceivables,
  canPriceForEntity,
  canReassignDeal,
  canRecordActivity,
  canRecordInvoices,
  canReopenDeal,
  canSeeAccountMoney,
  canSeeDealValue,
  canSeeQuoteMargin,
  canSeeReceivables,
  canSetUpDelivery,
  canViewAccount,
  canViewDeal,
  canViewLead,
  canWorkAccount,
  canWorkLead,
  type CrmViewer,
  type DealFacts,
} from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const ACCOUNT = "client-vinamilk";

const principal = (personId: string, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });
const viewer = (personId: string, grants: Grant[] = [], ties: [string, AccountTie[]][] = [], workforceType: Principal["workforceType"] = "employee"): CrmViewer => ({
  principal: principal(personId, grants, workforceType),
  ties: new Map(ties),
});
const entityGrant = (role: Grant["role"], entityId: string): Grant => ({ role, scope: { type: "entity", id: entityId } });
const groupGrant = (role: Grant["role"]): Grant => ({ role, scope: { type: "group" } });

const account: AccountFacts = { clientId: ACCOUNT, entityIds: [SZM, null], accountManagerPersonId: "am", salesOwnerPersonId: "seller" };
const groupAccount: AccountFacts = { clientId: "client-group", entityIds: [null, null], accountManagerPersonId: null, salesOwnerPersonId: null };
const deal = (overrides: Partial<DealFacts> = {}): DealFacts => ({ id: "deal-1", entityId: SZM, ownerPersonId: "seller", status: "open", account, ...overrides });

const am = viewer("am", [], [[ACCOUNT, ["manager"]]]);
const seller = viewer("seller", [entityGrant("sales", SZM)], [[ACCOUNT, ["sales_owner", "deal_owner"]]]);
const otherSeller = viewer("seller-2", [entityGrant("sales", SZM)]);
const sellerElsewhere = viewer("seller-c", [entityGrant("sales", SZC)]);
const director = viewer("director", [entityGrant("entity_director", SZM)]);
const cLevel = viewer("ceo", [groupGrant("c_level")]);
const finance = viewer("finance", [entityGrant("finance", SZM)]);
const deliveryLead = viewer("lead", [], [[ACCOUNT, ["project"]]]);
const colleague = viewer("colleague");
const collaborator = viewer("ctv", [], [], "collaborator");
const collaboratorOnTeam = viewer("ctv-2", [], [[ACCOUNT, ["project"]]], "collaborator");
const owner = viewer("owner", [groupGrant("owner")]);

describe("accounts", () => {
  it("opens the account list to every employee, and to a collaborator only on the account's team", () => {
    expect(canOpenCrm(colleague)).toBe(true);
    expect(canOpenCrm(collaborator)).toBe(false);
    expect(canOpenCrm(collaboratorOnTeam)).toBe(true);
    expect(canViewAccount(colleague, account)).toBe(true);
    expect(canViewAccount(collaborator, account)).toBe(false);
    expect(canViewAccount(collaboratorOnTeam, account)).toBe(true);
  });

  it("keeps contact details and activities with the account's team and the sellers over its entity", () => {
    for (const reader of [am, seller, deliveryLead, otherSeller, director, cLevel, owner]) expect(canWorkAccount(reader, account)).toBe(true);
    for (const reader of [colleague, sellerElsewhere, finance, collaborator]) expect(canWorkAccount(reader, account)).toBe(false);
    expect(canWorkAccount(collaboratorOnTeam, account)).toBe(true);
  });

  it("lets a collaborator on the team read contacts but not change them", () => {
    expect(canEditContacts(collaboratorOnTeam, account)).toBe(false);
    expect(canEditContacts(deliveryLead, account)).toBe(true);
    expect(canEditContacts(otherSeller, account)).toBe(true);
    expect(canEditContacts(colleague, account)).toBe(false);
  });

  it("gives the profile to the manager, the sales owner and the sellers; the team to the manager, the sales owner and crm:manage", () => {
    expect(canEditAccount(am, account)).toBe(true);
    expect(canEditAccount(seller, account)).toBe(true);
    expect(canEditAccount(otherSeller, account)).toBe(true);
    expect(canEditAccount(deliveryLead, account)).toBe(false);
    expect(canManageAccountTeam(am, account)).toBe(true);
    expect(canManageAccountTeam(seller, account)).toBe(true);
    expect(canManageAccountTeam(otherSeller, account)).toBe(false);
    expect(canManageAccountTeam(director, account)).toBe(true);
  });

  it("leaves payment terms and credit hold to crm:manage and finance", () => {
    expect(canEditCommercialTerms(director, account)).toBe(true);
    expect(canEditCommercialTerms(finance, account)).toBe(true);
    expect(canEditCommercialTerms(am, account)).toBe(false);
    expect(canEditCommercialTerms(seller, account)).toBe(false);
  });

  it("makes new accounts for the sellers over the entity", () => {
    expect(canCreateAccount(seller, SZM)).toBe(true);
    expect(canCreateAccount(seller, SZC)).toBe(false);
    expect(canCreateAccount(seller, null)).toBe(false);
    expect(canCreateAccount(cLevel, null)).toBe(true);
    expect(canCreateAccount(colleague, SZM)).toBe(false);
  });

  it("erases a contact on request only by the manager or crm:manage", () => {
    expect(canEraseContact(am, account)).toBe(true);
    expect(canEraseContact(director, account)).toBe(true);
    expect(canEraseContact(seller, account)).toBe(false);
  });

  it("covers a group account (no entity) only by a group-wide grant", () => {
    expect(canWorkAccount(otherSeller, groupAccount)).toBe(false);
    expect(canWorkAccount(cLevel, groupAccount)).toBe(true);
  });

  it("covers an account through its contracting entity as well as its own", () => {
    const contracted: AccountFacts = { ...account, entityIds: [null, SZC] };
    expect(canWorkAccount(sellerElsewhere, contracted)).toBe(true);
    expect(canWorkAccount(otherSeller, contracted)).toBe(false);
  });
});

describe("money on accounts", () => {
  it("shows account money to its manager, its sales owner, the sellers and finance — never to a delivery lead", () => {
    for (const reader of [am, seller, otherSeller, director, finance, cLevel]) expect(canSeeAccountMoney(reader, account)).toBe(true);
    for (const reader of [deliveryLead, colleague, sellerElsewhere]) expect(canSeeAccountMoney(reader, account)).toBe(false);
  });

  it("shows receivables to the manager, crm:manage and finance — not to sellers", () => {
    for (const reader of [am, director, finance, cLevel]) expect(canSeeReceivables(reader, account)).toBe(true);
    for (const reader of [seller, otherSeller, deliveryLead, colleague]) expect(canSeeReceivables(reader, account)).toBe(false);
  });

  it("records invoices for finance over the entity only", () => {
    expect(canRecordInvoices(finance, SZM)).toBe(true);
    expect(canRecordInvoices(finance, SZC)).toBe(false);
    expect(canRecordInvoices(director, SZM)).toBe(true);
    expect(canRecordInvoices(am, SZM)).toBe(false);
    expect(canRecordInvoices(seller, SZM)).toBe(false);
  });

  it("opens the receivables page for finance, crm:manage and account managers", () => {
    expect(canOpenReceivables(finance, false)).toBe(true);
    expect(canOpenReceivables(director, false)).toBe(true);
    expect(canOpenReceivables(am, true)).toBe(true);
    expect(canOpenReceivables(seller, false)).toBe(false);
  });
});

describe("deals", () => {
  it("shows a deal to its owner, its account's team and the sellers over its entity", () => {
    for (const reader of [seller, am, deliveryLead, otherSeller, director]) expect(canViewDeal(reader, deal())).toBe(true);
    for (const reader of [colleague, sellerElsewhere, finance]) expect(canViewDeal(reader, deal())).toBe(false);
  });

  it("hides the value from a delivery lead who sees the deal, and shows it to finance who does not", () => {
    expect(canSeeDealValue(deliveryLead, deal())).toBe(false);
    expect(canSeeDealValue(finance, deal())).toBe(true);
    expect(canSeeDealValue(am, deal())).toBe(true);
    expect(canSeeDealValue(otherSeller, deal())).toBe(true);
    expect(canSeeDealValue(sellerElsewhere, deal())).toBe(false);
  });

  it("lets the owner, the account's manager and crm:manage change an open deal — nobody a closed one", () => {
    expect(canEditDeal(seller, deal())).toBe(true);
    expect(canEditDeal(am, deal())).toBe(true);
    expect(canEditDeal(director, deal())).toBe(true);
    expect(canEditDeal(otherSeller, deal())).toBe(false);
    expect(canEditDeal(deliveryLead, deal())).toBe(false);
    expect(canEditDeal(seller, deal({ status: "won" }))).toBe(false);
  });

  it("opens deals for the sellers over the contracting entity and for the account's own manager", () => {
    expect(canCreateDeal(seller, account, SZM)).toBe(true);
    expect(canCreateDeal(seller, account, SZC)).toBe(false);
    expect(canCreateDeal(am, account, SZC)).toBe(true);
    expect(canCreateDeal(deliveryLead, account, SZM)).toBe(false);
  });

  it("reassigns an open deal by its owner or crm:manage; reopens a closed one by crm:manage only", () => {
    expect(canReassignDeal(seller, deal())).toBe(true);
    expect(canReassignDeal(am, deal())).toBe(false);
    expect(canReassignDeal(director, deal())).toBe(true);
    expect(canReopenDeal(seller, deal({ status: "lost" }))).toBe(false);
    expect(canReopenDeal(director, deal({ status: "lost" }))).toBe(true);
    expect(canReopenDeal(director, deal())).toBe(false);
  });

  it("sets up delivery of a won deal by the people who closed it", () => {
    expect(canSetUpDelivery(seller, deal({ status: "won" }))).toBe(true);
    expect(canSetUpDelivery(am, deal({ status: "won" }))).toBe(true);
    expect(canSetUpDelivery(director, deal({ status: "won" }))).toBe(true);
    expect(canSetUpDelivery(seller, deal())).toBe(false);
    expect(canSetUpDelivery(deliveryLead, deal({ status: "won" }))).toBe(false);
  });

  it("shows a quote's margin only with pjm:cost over the deal's entity", () => {
    expect(canSeeQuoteMargin(cLevel, deal())).toBe(true);
    expect(canSeeQuoteMargin(finance, deal())).toBe(true);
    expect(canSeeQuoteMargin(finance, deal({ entityId: SZC }))).toBe(false);
    expect(canSeeQuoteMargin(director, deal())).toBe(false);
    expect(canSeeQuoteMargin(seller, deal())).toBe(false);
  });
});

describe("leads", () => {
  const lead = { entityId: SZM, ownerPersonId: null, referrerPersonId: "colleague", createdByPersonId: "colleague", status: "new" as const };
  it("lets anyone but a collaborator pass on a lead", () => {
    expect(canLogLead(colleague)).toBe(true);
    expect(canLogLead(collaborator)).toBe(false);
  });
  it("shows a lead to its referrer, and works it only by the sellers over its entity", () => {
    expect(canViewLead(colleague, lead)).toBe(true);
    expect(canWorkLead(colleague, lead)).toBe(false);
    expect(canViewLead(otherSeller, lead)).toBe(true);
    expect(canWorkLead(otherSeller, lead)).toBe(true);
    expect(canViewLead(sellerElsewhere, lead)).toBe(false);
    expect(canWorkLead(otherSeller, { ...lead, status: "converted" })).toBe(false);
  });
  it("lets the owner work their own lead without a grant", () => {
    expect(canWorkLead(viewer("mine"), { ...lead, ownerPersonId: "mine" })).toBe(true);
  });
  it("erases a lead's contact on request only with crm:manage over its entity — open or closed", () => {
    expect(canEraseLeadContact(director, lead)).toBe(true);
    expect(canEraseLeadContact(cLevel, { ...lead, status: "converted" })).toBe(true);
    expect(canEraseLeadContact(director, { ...lead, entityId: SZC })).toBe(false);
    expect(canEraseLeadContact(otherSeller, lead)).toBe(false);
    expect(canEraseLeadContact(viewer("mine"), { ...lead, ownerPersonId: "mine" })).toBe(false);
    expect(canEraseLeadContact(colleague, lead)).toBe(false);
  });
});

describe("follow-ups and configuration", () => {
  it("lets the owner, the writer and crm:manage change a follow-up", () => {
    const activity = { ownerPersonId: "am", createdByPersonId: "seller" };
    expect(canEditActivity(am, activity, account)).toBe(true);
    expect(canEditActivity(seller, activity, account)).toBe(true);
    expect(canEditActivity(director, activity, account)).toBe(true);
    expect(canEditActivity(otherSeller, activity, account)).toBe(false);
  });
  it("records an activity only where every record it names passes its own rule (CRM-01)", () => {
    const none = { lead: null, account: null, deal: null };
    const ownLead = { entityId: SZC, ownerPersonId: "mine", referrerPersonId: null, createdByPersonId: "mine", status: "new" as const };
    const leadOwner = viewer("mine");
    // A lead's owner logs on their lead — and on nothing else that rides in the same request.
    expect(canRecordActivity(leadOwner, { ...none, lead: ownLead })).toBe(true);
    expect(canRecordActivity(leadOwner, { ...none, lead: ownLead, account })).toBe(false);
    expect(canRecordActivity(leadOwner, { lead: ownLead, account, deal: deal() })).toBe(false);
    // The account's people log on the account; a lead they may not work refuses the whole request.
    expect(canRecordActivity(am, { ...none, account })).toBe(true);
    expect(canRecordActivity(am, { ...none, account, lead: ownLead })).toBe(false);
    expect(canRecordActivity(collaboratorOnTeam, { ...none, account })).toBe(false);
    expect(canRecordActivity(colleague, { ...none, account })).toBe(false);
    // A deal is named with its own account, and by somebody who may see it.
    expect(canRecordActivity(seller, { ...none, account, deal: deal() })).toBe(true);
    expect(canRecordActivity(seller, { ...none, deal: deal() })).toBe(false);
    expect(canRecordActivity(seller, { ...none, account, deal: deal({ account: groupAccount }) })).toBe(false);
    expect(canRecordActivity(otherSeller, { ...none, account, deal: deal({ entityId: SZC }) })).toBe(false);
    // Nothing named: nothing to record against.
    expect(canRecordActivity(cLevel, none)).toBe(false);
  });
  it("configures the pipeline and the rate card with a group-wide crm:manage; an entity's price with crm:manage over it", () => {
    expect(canConfigureCrm(cLevel)).toBe(true);
    expect(canConfigureCrm(owner)).toBe(true);
    expect(canConfigureCrm(director)).toBe(false);
    expect(canPriceForEntity(director, SZM)).toBe(true);
    expect(canPriceForEntity(director, SZC)).toBe(false);
  });
});

describe("the sales role", () => {
  it("holds a pipeline and nothing of HR or pay", () => {
    const sales = principal("s", [entityGrant("sales", SZM)]);
    const v = { principal: sales, ties: new Map() };
    expect(canCreateAccount(v, SZM)).toBe(true);
    expect(canRecordInvoices(v, SZM)).toBe(false);
    expect(canEditCommercialTerms(v, account)).toBe(false);
    expect(canSeeQuoteMargin(v, deal())).toBe(false);
  });
});
