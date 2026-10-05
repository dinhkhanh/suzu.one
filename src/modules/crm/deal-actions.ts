"use server";
// Leads and deals (FR-CRM-10..17): passing on an enquiry, working and converting it, opening and
// moving deals, pitch projects, the delivery set-up of a won deal and its hand-off. Every action
// finds the lead or deal again and asks the policy about it.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { can } from "../platform/rbac/policy";
import type { CurrentUser } from "../platform/auth/session";
import { canCreateProject, listTeamMembers, listTeams, loadViewer, teamFacts, viewersOfPeople, VISIBILITIES } from "@/modules/work/service";
import { findAccount } from "./accounts";
import { convertLead } from "./conversion";
import { dealContext, type DealInput, createDeal, moveDeal, reassignDeal, reopenDeal, setDealContacts, updateDeal } from "./deals";
import { dealOfProject, openPitchProject, resendHandoff, respondToHandoff, setUpDelivery } from "./delivery";
import { ACCOUNT_SIZES, ACCOUNT_TIERS, CONTACT_SOURCES, LAWFUL_BASES, LOST_REASONS, SERVICE_LINES, SOURCES } from "./enums";
import { accountCode, checkbox, isoDate, optional, probability, rows, text, vnd } from "./form-inputs";
import { assignLead, createLead, eraseLeadContact, findLead, leadFacts, setLeadStatus, updateLead } from "./leads";
import { canCreateAccount, canCreateDeal, canEditDeal, canEraseLeadContact, canLogLead, canReassignDeal, canReopenDeal, canSetUpDelivery, canWorkLead, type CrmViewer, type DealFacts } from "./policy";
import { loadCrm } from "./viewer";

function refresh(paths: (string | null | undefined)[]) {
  for (const path of ["/crm", "/crm/deals", "/crm/leads", "/today", ...paths]) if (path) revalidatePath(path);
}

async function mayDeal(user: CurrentUser, dealId: string, rule: (viewer: CrmViewer, deal: DealFacts) => boolean): Promise<boolean> {
  const [{ viewer }, context] = await Promise.all([loadCrm(user), dealContext(dealId)]);
  return !!context && rule(viewer, context.facts);
}

const serviceLines = z.preprocess((value) => (value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(z.enum(SERVICE_LINES)).max(SERVICE_LINES.length));

const dealFields = {
  title: z.string().trim().min(1).max(200),
  brandId: optional(z.uuid()),
  serviceLines,
  oneOffVnd: vnd,
  monthlyVnd: vnd,
  months: optional(z.coerce.number().int().min(1).max(120)),
  probability,
  expectedCloseOn: optional(isoDate),
  teamId: optional(z.uuid()),
  entityId: optional(z.uuid()),
  source: optional(z.enum(SOURCES)),
  competitors: text(500),
  nextStep: text(500),
};

// ── Leads ───────────────────────────────────────────────────────────────────────────────────

const leadFields = {
  entityId: optional(z.uuid()),
  clientId: optional(z.uuid()),
  companyName: z.string().trim().min(1).max(200),
  contactName: text(120),
  contactTitle: text(120),
  email: optional(z.email().max(200)),
  phone: text(40),
  need: text(2000),
  budgetText: text(200),
  source: z.enum(SOURCES).default("referral"),
};

const createLeadPipeline = createAction({
  name: "crm.lead.create",
  input: z.object({ ...leadFields, ownerPersonId: optional(z.uuid()) }),
  authorize: async (user) => canLogLead((await loadCrm(user)).viewer),
  run: async ({ user, input }) => {
    const { viewer } = await loadCrm(user);
    const { ownerPersonId, ...values } = input;
    const sells = can(viewer.principal, "crm:sell", { entityId: values.entityId }) || can(viewer.principal, "crm:manage", { entityId: values.entityId });
    // Only a seller hands a lead to someone else; a referrer's lead waits for the sales directors.
    const lead = await createLead(values, { personId: user.person.id, sells }, sells ? ownerPersonId : null);
    refresh([`/crm/leads/${lead.id}`]);
    return { data: { id: lead.id }, audit: { resource: { type: "crm_lead", id: lead.id, entityId: lead.entityId }, summary: lead.companyName } };
  },
});
export async function createLeadAction(input: unknown) {
  return createLeadPipeline(input);
}

async function mayWorkLead(user: CurrentUser, leadId: string): Promise<boolean> {
  const lead = await findLead(leadId);
  return !!lead && canWorkLead((await loadCrm(user)).viewer, leadFacts(lead));
}

const updateLeadPipeline = createAction({
  name: "crm.lead.update",
  input: z.object({ leadId: z.uuid(), ...leadFields }),
  authorize: (user, input) => mayWorkLead(user, input.leadId),
  run: async ({ input }) => {
    const { leadId, ...values } = input;
    const { before, after } = await updateLead(leadId, values);
    refresh([`/crm/leads/${leadId}`]);
    return { data: { id: leadId }, audit: { resource: { type: "crm_lead", id: leadId, entityId: after.entityId }, before, after } };
  },
});
export async function updateLeadAction(input: unknown) {
  return updateLeadPipeline(input);
}

const leadStatusPipeline = createAction({
  name: "crm.lead.status",
  input: z.object({ leadId: z.uuid(), status: z.enum(["contacted", "qualified", "disqualified"]), reason: text(500) }),
  authorize: (user, input) => mayWorkLead(user, input.leadId),
  run: async ({ input }) => {
    const { before, after } = await setLeadStatus(input.leadId, input.status, input.reason);
    refresh([`/crm/leads/${input.leadId}`]);
    return { data: { status: after.status }, audit: { resource: { type: "crm_lead", id: input.leadId, entityId: after.entityId }, before: { status: before.status }, after: { status: after.status, reason: after.disqualifyReason } } };
  },
});
export async function setLeadStatusAction(input: unknown) {
  return leadStatusPipeline(input);
}

const assignLeadPipeline = createAction({
  name: "crm.lead.assign",
  input: z.object({ leadId: z.uuid(), ownerPersonId: z.uuid() }),
  authorize: async (user, input) => {
    const lead = await findLead(input.leadId);
    if (!lead) return false;
    const { viewer } = await loadCrm(user);
    // Handing a lead to someone is the sellers' call over its entity — not a referrer's, not the owner's own pass-on.
    return canWorkLead(viewer, leadFacts(lead)) && (can(viewer.principal, "crm:sell", { entityId: lead.entityId }) || can(viewer.principal, "crm:manage", { entityId: lead.entityId }));
  },
  run: async ({ user, input }) => {
    const { before, after } = await assignLead(input.leadId, input.ownerPersonId, user.person.id);
    refresh([`/crm/leads/${input.leadId}`]);
    return { data: { id: input.leadId }, audit: { resource: { type: "crm_lead", id: input.leadId, entityId: after.entityId }, before: { owner: before.ownerPersonId }, after: { owner: after.ownerPersonId } } };
  },
});
export async function assignLeadAction(input: unknown) {
  return assignLeadPipeline(input);
}

// Erasure on request for somebody who is only a lead's contact (PDPL): there is no contact record
// to erase, so the lead's own fields are blanked. An open or a closed lead alike.
const eraseLeadContactPipeline = createAction({
  name: "crm.lead.erase_contact",
  input: z.object({ leadId: z.uuid(), confirm: z.literal("ERASE") }),
  authorize: async (user, input) => {
    const lead = await findLead(input.leadId);
    return !!lead && canEraseLeadContact((await loadCrm(user)).viewer, leadFacts(lead));
  },
  run: async ({ input }) => {
    const { after } = await eraseLeadContact(input.leadId);
    refresh([`/crm/leads/${input.leadId}`]);
    // Personal data of someone outside the company: the audit says that it was erased, not what it said.
    return { data: { id: after.id }, audit: { resource: { type: "crm_lead", id: after.id, entityId: after.entityId }, summary: "contact erased on request" } };
  },
});
export async function eraseLeadContactAction(input: unknown) {
  return eraseLeadContactPipeline(input);
}

const convertPipeline = createAction({
  name: "crm.lead.convert",
  input: z.object({
    leadId: z.uuid(),
    clientId: optional(z.uuid()),
    // A new account, when no existing one is picked.
    code: optional(accountCode),
    name: text(120),
    accountEntityId: optional(z.uuid()),
    legalName: text(200),
    taxCode: text(20),
    size: optional(z.enum(ACCOUNT_SIZES)),
    tier: optional(z.enum(ACCOUNT_TIERS)),
    confirmDuplicate: checkbox.default(false),
    contactId: optional(z.uuid()),
    createContact: checkbox.default(true),
    contactSource: z.enum(CONTACT_SOURCES).default("referral"),
    lawfulBasis: z.enum(LAWFUL_BASES).default("legitimate_interest"),
    stageId: optional(z.uuid()),
    ownerPersonId: optional(z.uuid()),
    ...dealFields,
  }),
  authorize: async (user, input) => {
    if (!(await mayWorkLead(user, input.leadId))) return false;
    const { viewer } = await loadCrm(user);
    if (input.clientId) {
      const account = await findAccount(input.clientId);
      return !!account && canCreateDeal(viewer, account.facts, input.entityId ?? account.profile?.contractingEntityId ?? account.client.entityId);
    }
    return canCreateAccount(viewer, input.accountEntityId);
  },
  run: async ({ user, input }) => {
    const lead = await findLead(input.leadId);
    if (!lead) throw new ActionError("lead_not_found");
    if (!input.clientId && (!input.code || !input.name)) throw new ActionError("account_required");
    const deal: DealInput & { stageId: string | null; ownerPersonId: string } = {
      title: input.title,
      brandId: input.brandId,
      serviceLines: input.serviceLines,
      oneOffVnd: input.oneOffVnd,
      monthlyVnd: input.monthlyVnd,
      months: input.months,
      probability: input.probability,
      expectedCloseOn: input.expectedCloseOn,
      teamId: input.teamId,
      entityId: input.entityId ?? input.accountEntityId ?? lead.entityId,
      source: input.source,
      competitors: input.competitors,
      nextStep: input.nextStep,
      stageId: input.stageId,
      ownerPersonId: input.ownerPersonId ?? lead.ownerPersonId ?? user.person.id,
    };
    const result = await convertLead(
      input.leadId,
      {
        account: input.clientId
          ? { clientId: input.clientId }
          : { create: { code: input.code!, name: input.name!, entityId: input.accountEntityId ?? lead.entityId, note: null, profile: { legalName: input.legalName, taxCode: input.taxCode, address: null, website: null, industry: null, size: input.size, source: lead.source as never, tier: input.tier, contractingEntityId: input.accountEntityId ?? lead.entityId }, salesOwnerPersonId: deal.ownerPersonId, accountManagerPersonId: null, confirmDuplicate: input.confirmDuplicate } },
        contact: input.contactId ? { contactId: input.contactId } : input.createContact ? { create: { source: input.contactSource, lawfulBasis: input.lawfulBasis } } : null,
        deal,
      },
      user.person.id,
    );
    refresh([`/crm/leads/${input.leadId}`, `/crm/accounts/${result.clientId}`, `/crm/deals/${result.deal.id}`, "/crm/accounts"]);
    return { data: { dealId: result.deal.id, clientId: result.clientId }, audit: { resource: { type: "crm_lead", id: input.leadId, entityId: result.deal.entityId }, summary: `→ ${result.deal.code}` } };
  },
});
export async function convertLeadAction(input: unknown) {
  return convertPipeline(input);
}

// ── Deals ───────────────────────────────────────────────────────────────────────────────────

const contactRows = rows(z.object({ contactId: z.uuid(), role: text(80) }), 30);

const createDealPipeline = createAction({
  name: "crm.deal.create",
  input: z.object({ clientId: z.uuid(), stageId: optional(z.uuid()), ownerPersonId: optional(z.uuid()), contacts: contactRows, ...dealFields }),
  authorize: async (user, input) => {
    const [{ viewer }, account] = await Promise.all([loadCrm(user), findAccount(input.clientId)]);
    return !!account && canCreateDeal(viewer, account.facts, input.entityId ?? account.profile?.contractingEntityId ?? account.client.entityId);
  },
  run: async ({ user, input }) => {
    const ownerPersonId = input.ownerPersonId ?? user.person.id;
    if (ownerPersonId !== user.person.id) {
      // Naming someone else the owner: they must be able to hold it.
      const context = await findAccount(input.clientId);
      const target = (await viewersOfPeople([ownerPersonId])).get(ownerPersonId);
      if (!context || !target || !canCreateDeal({ principal: target.principal, ties: new Map() }, context.facts, input.entityId ?? context.profile?.contractingEntityId ?? context.client.entityId)) throw new ActionError("deal_owner_ineligible");
    }
    const deal = await createDeal({ ...input, ownerPersonId, leadId: null }, user.person.id);
    refresh([`/crm/deals/${deal.id}`, `/crm/accounts/${deal.clientId}`]);
    return { data: { id: deal.id }, audit: { resource: { type: "crm_deal", id: deal.id, entityId: deal.entityId }, summary: `${deal.code}: ${deal.title}`, after: deal } };
  },
});
export async function createDealAction(input: unknown) {
  return createDealPipeline(input);
}

const updateDealPipeline = createAction({
  name: "crm.deal.update",
  input: z.object({ dealId: z.uuid(), ...dealFields }),
  authorize: (user, input) => mayDeal(user, input.dealId, canEditDeal),
  run: async ({ input }) => {
    const { dealId, ...values } = input;
    const { before, after } = await updateDeal(dealId, values);
    refresh([`/crm/deals/${dealId}`, `/crm/accounts/${after.clientId}`]);
    return { data: { id: dealId }, audit: { resource: { type: "crm_deal", id: dealId, entityId: after.entityId }, before, after } };
  },
});
export async function updateDealAction(input: unknown) {
  return updateDealPipeline(input);
}

const dealContactsPipeline = createAction({
  name: "crm.deal.contacts",
  input: z.object({ dealId: z.uuid(), contacts: contactRows }),
  authorize: (user, input) => mayDeal(user, input.dealId, canEditDeal),
  run: async ({ input }) => {
    await setDealContacts(input.dealId, input.contacts);
    refresh([`/crm/deals/${input.dealId}`]);
    return { data: { ok: true }, audit: { resource: { type: "crm_deal", id: input.dealId }, summary: `${input.contacts.length} contacts` } };
  },
});
export async function setDealContactsAction(input: unknown) {
  return dealContactsPipeline(input);
}

const movePipeline = createAction({
  name: "crm.deal.move",
  input: z.object({ dealId: z.uuid(), stageId: z.uuid(), lostReason: optional(z.enum(LOST_REASONS)), lostNote: text(1000) }),
  authorize: (user, input) => mayDeal(user, input.dealId, canEditDeal),
  run: async ({ user, input }) => {
    const { before, after, stage } = await moveDeal(input.dealId, input.stageId, user.person.id, input.lostReason ? { reason: input.lostReason, note: input.lostNote } : null);
    refresh([`/crm/deals/${input.dealId}`, `/crm/accounts/${after.clientId}`]);
    return { data: { status: after.status }, audit: { resource: { type: "crm_deal", id: input.dealId, entityId: after.entityId }, summary: stage.name, before: { stageId: before.stageId, status: before.status }, after: { stageId: after.stageId, status: after.status, lostReason: after.lostReason } } };
  },
});
export async function moveDealAction(input: unknown) {
  return movePipeline(input);
}

const reopenPipeline = createAction({
  name: "crm.deal.reopen",
  input: z.object({ dealId: z.uuid(), stageId: z.uuid() }),
  authorize: (user, input) => mayDeal(user, input.dealId, canReopenDeal),
  run: async ({ user, input }) => {
    const { before, after } = await reopenDeal(input.dealId, input.stageId, user.person.id);
    refresh([`/crm/deals/${input.dealId}`]);
    return { data: { id: input.dealId }, audit: { resource: { type: "crm_deal", id: input.dealId, entityId: after.entityId }, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function reopenDealAction(input: unknown) {
  return reopenPipeline(input);
}

const reassignPipeline = createAction({
  name: "crm.deal.reassign",
  input: z.object({ dealId: z.uuid(), ownerPersonId: z.uuid() }),
  authorize: (user, input) => mayDeal(user, input.dealId, canReassignDeal),
  run: async ({ user, input }) => {
    const { before, after, movedFollowUps } = await reassignDeal(input.dealId, input.ownerPersonId, user.person.id);
    refresh([`/crm/deals/${input.dealId}`]);
    return { data: { movedFollowUps }, audit: { resource: { type: "crm_deal", id: input.dealId, entityId: after.entityId }, before: { owner: before.ownerPersonId }, after: { owner: after.ownerPersonId, movedFollowUps } } };
  },
});
export async function reassignDealAction(input: unknown) {
  return reassignPipeline(input);
}

// ── Pitch and delivery ──────────────────────────────────────────────────────────────────────

/**
 * Making a project in a team: the team's own rule (its members and leads, `work:manage` over it) —
 * or, for a seller outside the team, a project led by one of the team's own people, who is handed
 * it and may return it. The deal's rights alone never open a team the lead is not in.
 */
async function mayMakeProjectIn(user: CurrentUser, teamId: string, leadPersonId: string): Promise<boolean> {
  const team = (await listTeams()).find((row) => row.id === teamId);
  if (!team || !team.isActive) return false;
  if (canCreateProject(await loadViewer(user), teamFacts(team))) return true;
  return (await listTeamMembers(teamId)).some((member) => member.personId === leadPersonId);
}

const pitchPipeline = createAction({
  name: "crm.deal.pitch",
  input: z.object({ dealId: z.uuid(), teamId: z.uuid(), leadPersonId: z.uuid(), name: z.string().trim().min(1).max(200), dueDate: optional(isoDate) }),
  authorize: async (user, input) => (await mayDeal(user, input.dealId, canEditDeal)) && (await mayMakeProjectIn(user, input.teamId, input.leadPersonId)),
  run: async ({ user, input }) => {
    const project = await openPitchProject(input.dealId, input, user.person.id);
    refresh([`/crm/deals/${input.dealId}`, "/projects"]);
    return { data: { projectId: project.id }, audit: { resource: { type: "crm_deal", id: input.dealId, entityId: project.entityId }, summary: `pitch → ${project.name}` } };
  },
});
export async function openPitchAction(input: unknown) {
  return pitchPipeline(input);
}

const deliveryPipeline = createAction({
  name: "crm.deal.delivery",
  input: z.object({
    dealId: z.uuid(),
    teamId: z.uuid(),
    leadPersonId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    templateId: optional(z.uuid()),
    startDate: isoDate,
    dueDate: optional(isoDate),
    visibility: z.enum(VISIBILITIES).default("team"),
    contractId: optional(z.uuid()),
    context: text(4000),
    next: text(4000),
    questions: text(4000),
  }),
  authorize: async (user, input) => (await mayDeal(user, input.dealId, canSetUpDelivery)) && (await mayMakeProjectIn(user, input.teamId, input.leadPersonId)),
  run: async ({ user, input }) => {
    const { project } = await setUpDelivery(input.dealId, { ...input, note: { context: input.context ?? undefined, next: input.next ?? undefined, questions: input.questions ?? undefined } }, user.person.id);
    refresh([`/crm/deals/${input.dealId}`, "/projects", `/projects/${project.id}`]);
    return { data: { projectId: project.id }, audit: { resource: { type: "crm_deal", id: input.dealId, entityId: project.entityId }, summary: `delivery → ${project.name}` } };
  },
});
export async function setUpDeliveryAction(input: unknown) {
  return deliveryPipeline(input);
}

const handoffPipeline = createAction({
  name: "crm.deal.handoff",
  input: z.object({ projectId: z.uuid(), answer: z.enum(["accept", "return"]), reason: text(1000) }),
  // Only the person it was handed to answers; the service checks that it is them.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { before, after } = await respondToHandoff(input.projectId, input.answer === "accept" ? { accept: true } : { accept: false, reason: input.reason ?? "" }, user.person.id);
    refresh([`/crm/deals/${after.dealId}`, `/projects/${input.projectId}`]);
    return { data: { status: after.handoffStatus }, audit: { resource: { type: "work_project", id: input.projectId }, before: { status: before.handoffStatus }, after: { status: after.handoffStatus, reason: after.handoffReturnReason } } };
  },
});
export async function respondToHandoffAction(input: unknown) {
  return handoffPipeline(input);
}

const resendPipeline = createAction({
  name: "crm.deal.handoff_resend",
  input: z.object({ dealId: z.uuid(), projectId: z.uuid(), context: text(4000), next: text(4000), questions: text(4000) }),
  authorize: async (user, input) => (await dealOfProject(input.projectId))?.dealId === input.dealId && mayDeal(user, input.dealId, canSetUpDelivery),
  run: async ({ user, input }) => {
    const after = await resendHandoff(input.projectId, { context: input.context ?? undefined, next: input.next ?? undefined, questions: input.questions ?? undefined }, user.person.id);
    refresh([`/crm/deals/${input.dealId}`]);
    return { data: { status: after.handoffStatus }, audit: { resource: { type: "work_project", id: input.projectId }, summary: "handoff resent" } };
  },
});
export async function resendHandoffAction(input: unknown) {
  return resendPipeline(input);
}
