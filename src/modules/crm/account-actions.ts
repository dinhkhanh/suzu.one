"use server";
// Accounts, their team, contacts and follow-ups (FR-CRM-01..07). Each action finds the account
// again and asks the policy about it — the browser's word is never taken for who may do what — and
// resolves a brand to its client, since everything is recorded on the account.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import type { CurrentUser } from "../platform/auth/session";
import { notify } from "../platform/notifications/service";
import { addAccountMember, createAccount, findAccount, moveAccountWork, removeAccountMember, saveCommercialTerms, saveProfile, setLifecycle, setSalesOwner } from "./accounts";
import { cancelFollowUp, completeFollowUp, findActivity, recordActivity, rescheduleFollowUp } from "./activities";
import { eraseContact, findContact, saveContact } from "./contacts";
import { ACCOUNT_SIZES, ACCOUNT_TIERS, ACTIVITY_KINDS, CONTACT_CHANNELS, CONTACT_SOURCES, CONTACT_STATUSES, DECISION_ROLES, LAWFUL_BASES, LIFECYCLES, SOURCES } from "./enums";
import { accountCode, checkbox, days, idList, isoDate, optional, text, vnd } from "./form-inputs";
import { findLead, leadFacts } from "./leads";
import { type AccountFacts, canCreateAccount, canEditAccount, canEditActivity, canEditCommercialTerms, canEditContacts, canEraseContact, canLogActivity, canManageAccountTeam, canWorkLead, type CrmViewer } from "./policy";
import { loadCrm } from "./viewer";

type Rule = (viewer: CrmViewer, account: AccountFacts) => boolean;

/** The account (resolving a brand to its client) and whether this user passes the rule on it. */
async function may(user: CurrentUser, clientId: string, rule: Rule): Promise<boolean> {
  const [{ viewer }, account] = await Promise.all([loadCrm(user), findAccount(clientId)]);
  return !!account && rule(viewer, account.facts);
}

const auditAccount = (clientId: string, entityId: string | null = null) => ({ type: "work_client", id: clientId, entityId });

function refresh(clientId?: string | null) {
  revalidatePath("/crm");
  revalidatePath("/crm/accounts");
  if (clientId) revalidatePath(`/crm/accounts/${clientId}`);
  revalidatePath("/work/clients");
  revalidatePath("/today");
}

const profileFields = {
  legalName: text(200),
  taxCode: text(20),
  address: text(500),
  website: text(300),
  industry: text(100),
  size: optional(z.enum(ACCOUNT_SIZES)),
  source: optional(z.enum(SOURCES)),
  tier: optional(z.enum(ACCOUNT_TIERS)),
  contractingEntityId: optional(z.uuid()),
};

// ── Accounts ────────────────────────────────────────────────────────────────────────────────

const createAccountPipeline = createAction({
  name: "crm.account.create",
  input: z.object({ code: accountCode, name: z.string().trim().min(1).max(120), entityId: optional(z.uuid()), note: text(1000), ...profileFields, salesOwnerPersonId: optional(z.uuid()), accountManagerPersonId: optional(z.uuid()), confirmDuplicate: checkbox.default(false) }),
  authorize: async (user, input) => canCreateAccount((await loadCrm(user)).viewer, input.entityId),
  run: async ({ user, input }) => {
    const { code, name, entityId, note, salesOwnerPersonId, accountManagerPersonId, confirmDuplicate, ...profile } = input;
    const { client, profile: saved } = await createAccount({ code, name, entityId, note, profile, salesOwnerPersonId: salesOwnerPersonId ?? user.person.id, accountManagerPersonId, confirmDuplicate });
    refresh(client.id);
    return { data: { id: client.id }, audit: { resource: auditAccount(client.id, client.entityId), summary: `${client.code}: ${client.name}`, after: { client, profile: saved } } };
  },
});
export async function createAccountAction(input: unknown) {
  return createAccountPipeline(input);
}

const profilePipeline = createAction({
  name: "crm.account.profile",
  input: z.object({ clientId: z.uuid(), ...profileFields }),
  authorize: (user, input) => may(user, input.clientId, canEditAccount),
  run: async ({ input }) => {
    const { clientId, ...profile } = input;
    const { before, after } = await saveProfile(clientId, profile);
    refresh(clientId);
    return { data: { id: clientId }, audit: { resource: auditAccount(clientId), before, after } };
  },
});
export async function saveProfileAction(input: unknown) {
  return profilePipeline(input);
}

const termsPipeline = createAction({
  name: "crm.account.terms",
  input: z.object({ clientId: z.uuid(), paymentTermsDays: days, creditHold: checkbox.default(false), creditHoldReason: text(500), creditLimitVnd: vnd }),
  authorize: (user, input) => may(user, input.clientId, canEditCommercialTerms),
  run: async ({ input }) => {
    const { clientId, ...terms } = input;
    const { before, after } = await saveCommercialTerms(clientId, terms);
    refresh(clientId);
    return { data: { id: clientId }, audit: { resource: auditAccount(clientId), before, after } };
  },
});
export async function saveTermsAction(input: unknown) {
  return termsPipeline(input);
}

const lifecyclePipeline = createAction({
  name: "crm.account.lifecycle",
  input: z.object({ clientId: z.uuid(), lifecycle: z.enum([...LIFECYCLES, "auto"]) }),
  authorize: (user, input) => may(user, input.clientId, canEditAccount),
  run: async ({ input }) => {
    const { before, after } = await setLifecycle(input.clientId, input.lifecycle === "auto" ? null : input.lifecycle);
    refresh(input.clientId);
    return { data: { lifecycle: after.lifecycle }, audit: { resource: auditAccount(input.clientId), before: { lifecycle: before?.lifecycle, manual: before?.lifecycleManual }, after: { lifecycle: after.lifecycle, manual: after.lifecycleManual } } };
  },
});
export async function setLifecycleAction(input: unknown) {
  return lifecyclePipeline(input);
}

// ── The account team (FR-CRM-03) ────────────────────────────────────────────────────────────

const salesOwnerPipeline = createAction({
  name: "crm.account.sales_owner",
  input: z.object({ clientId: z.uuid(), personId: optional(z.uuid()) }),
  authorize: (user, input) => may(user, input.clientId, canManageAccountTeam),
  run: async ({ user, input }) => {
    const { before, after } = await setSalesOwner(input.clientId, input.personId);
    if (input.personId && input.personId !== user.person.id) {
      const account = await findAccount(input.clientId);
      await notify({ recipients: [input.personId], kind: "crm.account_team_added", params: { account: account?.client.name ?? "" }, link: `/crm/accounts/${input.clientId}` });
    }
    refresh(input.clientId);
    return { data: { id: input.clientId }, audit: { resource: auditAccount(input.clientId), before: { salesOwnerPersonId: before?.salesOwnerPersonId ?? null }, after: { salesOwnerPersonId: after.salesOwnerPersonId } } };
  },
});
export async function setSalesOwnerAction(input: unknown) {
  return salesOwnerPipeline(input);
}

const memberPipeline = createAction({
  name: "crm.account.member",
  input: z.object({ clientId: z.uuid(), personId: z.uuid(), op: z.enum(["add", "remove"]) }),
  authorize: (user, input) => may(user, input.clientId, canManageAccountTeam),
  run: async ({ user, input }) => {
    if (input.op === "add") {
      await addAccountMember(input.clientId, input.personId, user.person.id);
      if (input.personId !== user.person.id) {
        const account = await findAccount(input.clientId);
        await notify({ recipients: [input.personId], kind: "crm.account_team_added", params: { account: account?.client.name ?? "" }, link: `/crm/accounts/${input.clientId}` });
      }
    } else await removeAccountMember(input.clientId, input.personId);
    refresh(input.clientId);
    return { data: { ok: true }, audit: { resource: auditAccount(input.clientId), summary: `${input.op} ${input.personId}` } };
  },
});
export async function accountMemberAction(input: unknown) {
  return memberPipeline(input);
}

// ── Contacts (FR-CRM-02) ────────────────────────────────────────────────────────────────────

const contactPipeline = createAction({
  name: "crm.contact.save",
  input: z.object({
    clientId: z.uuid(),
    contactId: optional(z.uuid()),
    fullName: z.string().trim().min(1).max(120),
    title: text(120),
    email: optional(z.email().max(200)),
    phone: text(40),
    zalo: text(80),
    decisionRole: optional(z.enum(DECISION_ROLES)),
    isPrimary: checkbox.default(false),
    preferredChannel: optional(z.enum(CONTACT_CHANNELS)),
    birthday: optional(isoDate),
    notes: text(2000),
    source: z.enum(CONTACT_SOURCES),
    lawfulBasis: z.enum(LAWFUL_BASES),
    status: z.enum(CONTACT_STATUSES).default("active"),
    brandIds: idList,
    confirmDuplicate: checkbox.default(false),
  }),
  authorize: (user, input) => may(user, input.clientId, canEditContacts),
  run: async ({ user, input }) => {
    const account = await findAccount(input.clientId);
    if (!account || account.client.id !== input.clientId) throw new ActionError("account_not_found");
    const { clientId, contactId, confirmDuplicate, ...values } = input;
    const { before, after } = await saveContact(clientId, contactId, values, user.person.id, { confirmDuplicate });
    refresh(clientId);
    // Personal data of someone outside the company: the audit says which contact changed, not what it now says.
    return { data: { id: after.id }, audit: { resource: { type: "crm_contact", id: after.id, entityId: account.client.entityId }, summary: before ? "updated" : "created" } };
  },
});
export async function saveContactAction(input: unknown) {
  return contactPipeline(input);
}

const erasePipeline = createAction({
  name: "crm.contact.erase",
  input: z.object({ contactId: z.uuid(), confirm: z.literal("ERASE") }),
  authorize: async (user, input) => {
    const contact = await findContact(input.contactId);
    return !!contact && may(user, contact.clientId, canEraseContact);
  },
  run: async ({ input }) => {
    const { after } = await eraseContact(input.contactId);
    refresh(after.clientId);
    return { data: { id: after.id }, audit: { resource: { type: "crm_contact", id: after.id }, summary: "erased on request" } };
  },
});
export async function eraseContactAction(input: unknown) {
  return erasePipeline(input);
}

// ── Activities and follow-ups (FR-CRM-06) ───────────────────────────────────────────────────

const activityPipeline = createAction({
  name: "crm.activity.record",
  input: z.object({
    kind: z.enum(ACTIVITY_KINDS),
    subject: z.string().trim().min(1).max(200),
    body: text(4000),
    clientId: optional(z.uuid()),
    contactId: optional(z.uuid()),
    dealId: optional(z.uuid()),
    leadId: optional(z.uuid()),
    logged: checkbox.default(true),
    outcome: text(1000),
    followUpOn: optional(isoDate),
    followUpOwnerId: optional(z.uuid()),
    followUpSubject: text(200),
  }),
  authorize: async (user, input) => {
    if (input.leadId) {
      const lead = await findLead(input.leadId);
      return !!lead && canWorkLead((await loadCrm(user)).viewer, leadFacts(lead));
    }
    return !!input.clientId && may(user, input.clientId, canLogActivity);
  },
  run: async ({ user, input }) => {
    const account = input.clientId ? await findAccount(input.clientId) : null;
    if (input.clientId && !account) throw new ActionError("account_not_found");
    if (!input.logged && !input.followUpOn) throw new ActionError("activity_empty");
    const followUp = input.followUpOn ? { ownerPersonId: input.followUpOwnerId ?? user.person.id, dueOn: input.followUpOn, subject: input.followUpSubject } : null;
    const { logged, followUp: next } = await recordActivity(
      {
        kind: input.kind,
        subject: input.subject,
        body: input.body,
        clientId: account?.client.id ?? null,
        contactId: input.contactId,
        dealId: input.dealId,
        leadId: input.leadId,
        occurredAt: input.logged ? new Date() : null,
        outcome: input.outcome,
        followUp,
      },
      user.person.id,
    );
    refresh(account?.client.id);
    if (input.dealId) revalidatePath(`/crm/deals/${input.dealId}`);
    if (input.leadId) revalidatePath(`/crm/leads/${input.leadId}`);
    const id = logged?.id ?? next?.id ?? "";
    return { data: { id }, audit: { resource: { type: "crm_activity", id, entityId: account?.client.entityId ?? null }, summary: `${input.kind}: ${input.subject}` } };
  },
});
export async function recordActivityAction(input: unknown) {
  return activityPipeline(input);
}

/** The follow-up and whether this user may change it. */
async function mayEditActivity(user: CurrentUser, activityId: string): Promise<boolean> {
  const activity = await findActivity(activityId);
  if (!activity) return false;
  const [{ viewer }, account] = await Promise.all([loadCrm(user), activity.clientId ? findAccount(activity.clientId) : null]);
  return canEditActivity(viewer, activity, account ? account.facts : null);
}

const completePipeline = createAction({
  name: "crm.followup.complete",
  input: z.object({ activityId: z.uuid(), outcome: text(1000), kind: optional(z.enum(ACTIVITY_KINDS)), nextSubject: text(200), nextOn: optional(isoDate), nextOwnerId: optional(z.uuid()) }),
  authorize: (user, input) => mayEditActivity(user, input.activityId),
  run: async ({ user, input }) => {
    const next = input.nextOn ? { subject: input.nextSubject ?? input.outcome ?? "…", dueOn: input.nextOn, ownerPersonId: input.nextOwnerId ?? user.person.id } : null;
    const { before, after } = await completeFollowUp(input.activityId, { outcome: input.outcome, kind: input.kind, next }, user.person.id);
    refresh(after.clientId);
    if (after.dealId) revalidatePath(`/crm/deals/${after.dealId}`);
    return { data: { id: after.id }, audit: { resource: { type: "crm_activity", id: after.id }, before: { doneAt: before.doneAt }, after: { doneAt: after.doneAt, outcome: after.outcome } } };
  },
});
export async function completeFollowUpAction(input: unknown) {
  return completePipeline(input);
}

const reschedulePipeline = createAction({
  name: "crm.followup.reschedule",
  input: z.object({ activityId: z.uuid(), dueOn: isoDate, ownerPersonId: z.uuid(), subject: z.string().trim().min(1).max(200) }),
  authorize: (user, input) => mayEditActivity(user, input.activityId),
  run: async ({ user, input }) => {
    const { before, after } = await rescheduleFollowUp(input.activityId, input, user.person.id);
    refresh(after.clientId);
    return { data: { id: after.id }, audit: { resource: { type: "crm_activity", id: after.id }, before: { dueOn: before.dueOn, ownerPersonId: before.ownerPersonId }, after: { dueOn: after.dueOn, ownerPersonId: after.ownerPersonId } } };
  },
});
export async function rescheduleFollowUpAction(input: unknown) {
  return reschedulePipeline(input);
}

const cancelPipeline = createAction({
  name: "crm.followup.cancel",
  input: z.object({ activityId: z.uuid() }),
  authorize: (user, input) => mayEditActivity(user, input.activityId),
  run: async ({ input }) => {
    const row = await cancelFollowUp(input.activityId);
    refresh(row.clientId);
    return { data: { id: row.id }, audit: { resource: { type: "crm_activity", id: row.id }, before: row } };
  },
});
export async function cancelFollowUpAction(input: unknown) {
  return cancelPipeline(input);
}

// ── Account handover (FR-CRM-42) ────────────────────────────────────────────────────────────

const moveWorkPipeline = createAction({
  name: "crm.account.move_work",
  input: z.object({ clientId: z.uuid(), fromPersonId: z.uuid() }),
  // Whoever runs the account's team: its manager, its sales owner, `crm:manage` over it.
  authorize: (user, input) => may(user, input.clientId, canManageAccountTeam),
  run: async ({ user, input }) => {
    const moved = await moveAccountWork(input.clientId, input.fromPersonId, user.person.id);
    refresh(input.clientId);
    revalidatePath("/crm/deals");
    return { data: moved, audit: { resource: auditAccount(input.clientId), summary: `${moved.deals} deals, ${moved.followUps} follow-ups → ${moved.toPersonId}` } };
  },
});
export async function moveAccountWorkAction(input: unknown) {
  return moveWorkPipeline(input);
}
