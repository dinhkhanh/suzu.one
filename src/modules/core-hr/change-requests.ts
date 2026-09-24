// Employee self-service change requests (FR-CHR-12): the first request type on the approval
// engine. An employee proposes changes to their own personal and restricted data; HR approves, and
// the approval applies the change in the same transaction.
//
// Restricted values (ID number, tax code, bank account…) travel only in the request's encrypted
// payload; the plain payload and the audit log carry field *names*. Personal values are kept in
// the plain payload with their "before", so the approver sees a diff.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, listRequestsAbout, type RequestView, resubmitRequest, submitRequest } from "@/modules/platform/approvals/service";
import { can, canReadTier, type Principal } from "@/modules/platform/rbac/policy";
import vi from "../../../messages/vi.json";
import { PERSONAL_CHANGE_FIELDS, RESTRICTED_CHANGE_FIELDS } from "./enums";
import { changeRequestContext } from "./field-contexts";
import { canDecideProfileChange } from "./policy";
import { type BankAccount, patchSensitiveFields } from "./records";
import { getPersonTarget, inTransaction, invalidatePersonView } from "./service";

export type PersonalChangeField = (typeof PERSONAL_CHANGE_FIELDS)[number];
export type RestrictedChangeField = (typeof RESTRICTED_CHANGE_FIELDS)[number];

export type ProfileChangeInput = {
  personal: Record<PersonalChangeField, string | null>;
  // null = leave as it is. Restricted fields cannot be cleared through a request, only replaced.
  restricted: Record<RestrictedChangeField, string | null>;
  bankAccount: BankAccount | null;
};

export type ProfileChangePayload = {
  personal: Partial<Record<PersonalChangeField, { from: string | null; to: string | null }>>;
  /** Names only: the values are in the encrypted payload. "bankAccount" = a new pay account. */
  restricted: (RestrictedChangeField | "bankAccount")[];
};
type SealedChange = Partial<Record<RestrictedChangeField, string>> & { bankAccount?: BankAccount };

export const profileChangeRequest = defineRequestType({
  type: "profile_change",
  // One step; any HR person with authority over the employee may answer.
  flow: { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "person:manage" }] }] },
  canView: (viewer, subject) => !!subject && can(viewer, "person:manage", subject),
  // Restricted values and bank accounts are looked at one by one (a new account needs the
  // second-channel check); plain contact details may be approved from the inbox.
  bulkApprovable: (request) => ((request.payload as ProfileChangePayload).restricted ?? []).length === 0,
});

// Request summaries are read in inboxes and emails by HR: written in Vietnamese, like the emails.
const label = createTranslator({ locale: "vi", messages: vi, namespace: "changeRequests.fields" });

async function buildChange(executor: Tx, personId: string, input: ProfileChangeInput): Promise<{ payload: ProfileChangePayload; sealed: SealedChange | null; summary: string }> {
  const [profile] = await executor.select().from(schema.personProfile).where(eq(schema.personProfile.personId, personId)).limit(1);
  const personal: ProfileChangePayload["personal"] = {};
  for (const field of PERSONAL_CHANGE_FIELDS) {
    const from = profile?.[field] ?? null;
    if (input.personal[field] !== from) personal[field] = { from, to: input.personal[field] };
  }
  const sealed: SealedChange = {};
  for (const field of RESTRICTED_CHANGE_FIELDS) if (input.restricted[field]) sealed[field] = input.restricted[field]!;
  if (input.bankAccount) sealed.bankAccount = input.bankAccount;
  const restricted = Object.keys(sealed) as ProfileChangePayload["restricted"];
  const names = [...Object.keys(personal), ...restricted];
  if (names.length === 0) throw new ActionError("change_request_empty");
  return { payload: { personal, restricted }, sealed: restricted.length ? sealed : null, summary: names.map((name) => label(name as PersonalChangeField)).join(", ") };
}

const seal = (requestId: string, sealed: SealedChange | null) => (sealed ? fieldCipher().encrypt(JSON.stringify(sealed), changeRequestContext(requestId)) : null);

export async function submitProfileChange(personId: string, input: ProfileChangeInput) {
  return inTransaction(async (tx) => {
    const target = await getPersonTarget(personId, tx);
    if (!target) throw new ActionError("person_not_found");
    // One at a time: a second request would be a diff against data the first is about to change.
    const [open] = await tx
      .select({ id: schema.approvalRequest.id })
      .from(schema.approvalRequest)
      .where(and(eq(schema.approvalRequest.type, profileChangeRequest.type), eq(schema.approvalRequest.subjectPersonId, personId), inArray(schema.approvalRequest.status, ["pending", "returned"])))
      .limit(1);
    if (open) throw new ActionError("change_request_open");

    const id = randomUUID();
    const { payload, sealed, summary } = await buildChange(tx, personId, input);
    const { request } = await submitRequest(tx, profileChangeRequest, {
      id,
      entityId: target.entityId ?? null,
      requesterPersonId: personId,
      subjectPersonId: personId,
      summary,
      payload,
      payloadEnc: seal(id, sealed),
      link: (requestId) => `/approvals/profile-change/${requestId}`,
    });
    return { request, payload };
  });
}

/** The requester's corrected version after HR sent the request back. */
export async function resubmitProfileChange(personId: string, requestId: string, input: ProfileChangeInput) {
  return inTransaction(async (tx) => {
    const { payload, sealed, summary } = await buildChange(tx, personId, input);
    const { request } = await resubmitRequest(tx, profileChangeRequest, requestId, personId, { summary, payload, payloadEnc: seal(requestId, sealed) });
    return { request, payload };
  });
}

export type ProfileChangeDecision = { action: "approve" | "reject" | "return"; comment: string | null; verifiedSecondChannel: boolean };

/**
 * HR's answer. Whose turn it is comes from the engine; on top of that the approver must (still)
 * hold HR authority over the person and read the tier of what they are approving. Approving a new
 * bank account takes a confirmation that the employee was reached through a second channel
 * (FR-CHR-12): a hijacked session must not be able to redirect someone's pay.
 */
export async function decideProfileChange(actor: { personId: string; principal: Principal }, requestId: string, decision: ProfileChangeDecision) {
  return inTransaction(async (tx) => {
    const [row] = await tx.select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, requestId), eq(schema.approvalRequest.type, profileChangeRequest.type))).limit(1);
    if (!row?.subjectPersonId) throw new ActionError("approval_not_found");
    const payload = row.payload as ProfileChangePayload;
    const target = await getPersonTarget(row.subjectPersonId, tx);
    if (!canDecideProfileChange(actor.principal, target, { hasRestricted: payload.restricted.length > 0 })) throw new ActionError("forbidden");
    const changesBank = payload.restricted.includes("bankAccount");
    if (decision.action === "approve" && changesBank && !decision.verifiedSecondChannel) throw new ActionError("change_request_verification_required");

    const { request, before, outcome } = await decideRequest(tx, profileChangeRequest, requestId, actor.personId, {
      action: decision.action,
      comment: decision.comment,
      meta: decision.action === "approve" && changesBank ? { verifiedSecondChannel: true } : undefined,
    });

    if (outcome === "approved") {
      const personId = row.subjectPersonId;
      const personal = Object.fromEntries(Object.entries(payload.personal).map(([field, change]) => [field, change.to]));
      if (Object.keys(personal).length) {
        await tx
          .insert(schema.personProfile)
          .values({ personId, ...personal })
          .onConflictDoUpdate({ target: schema.personProfile.personId, set: { ...personal, updatedAt: new Date() } });
        await invalidatePersonView(personId);
      }
      if (row.payloadEnc) await patchSensitiveFields(tx, personId, JSON.parse(fieldCipher().decrypt(row.payloadEnc, changeRequestContext(requestId))) as SealedChange);
    }
    return { request, before, outcome, payload, entityId: target?.entityId ?? null };
  });
}

export type ProfileChangeView = RequestView & { payload: ProfileChangePayload; /** The viewer may ask to see the proposed restricted values (audited). */ canReveal: boolean };

export async function getProfileChange(viewer: { personId: string; principal: Principal }, requestId: string): Promise<ProfileChangeView | null> {
  const view = await getRequest(viewer, profileChangeRequest, requestId);
  if (!view) return null;
  const payload = view.request.payload as ProfileChangePayload;
  const readsRestricted = view.isRequester || (!!view.subject && canReadTier(viewer.principal, view.subject, "restricted"));
  return {
    ...view,
    payload,
    canReveal: payload.restricted.length > 0 && readsRestricted,
    // It may be their turn by the flow and still not their decision (see decideProfileChange).
    canDecide: view.canDecide && canDecideProfileChange(viewer.principal, view.subject, { hasRestricted: payload.restricted.length > 0 }),
  };
}

/** The proposed restricted values, decrypted. A disclosure: only `revealChangeRequestAction` calls this, and its pipeline audits it. */
export async function revealProfileChange(viewer: { personId: string; principal: Principal }, requestId: string): Promise<{ values: SealedChange; entityId: string | null; fields: string[] } | null> {
  const view = await getProfileChange(viewer, requestId);
  if (!view?.canReveal || !view.request.payloadEnc) return null;
  return { values: JSON.parse(fieldCipher().decrypt(view.request.payloadEnc, changeRequestContext(requestId))) as SealedChange, entityId: view.request.entityId, fields: view.payload.restricted };
}

/** Change requests about one person, for the person themselves and for HR on the person page. null = refused. */
export async function listProfileChanges(viewer: { personId: string; principal: Principal }, personId: string, status?: "pending") {
  const target = await getPersonTarget(personId);
  if (!target || (viewer.personId !== personId && !can(viewer.principal, "person:manage", target))) return null;
  return listRequestsAbout(profileChangeRequest.type, personId, status);
}
