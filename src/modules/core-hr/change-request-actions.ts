"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { MARITAL_STATUSES } from "./enums";
import { decideProfileChange, getProfileChange, resubmitProfileChange, revealProfileChange, submitProfileChange } from "./change-requests";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));

const changeInput = {
  // Required as a whole: the form posts every personal field, and a missing one would read as "clear it".
  personal: z.object({
    phone: text(30),
    personalEmail: optional(z.email().max(200)),
    permanentAddress: text(300),
    currentAddress: text(300),
    maritalStatus: optional(z.enum(MARITAL_STATUSES)),
  }),
  restricted: z.object({
    nationalId: text(40),
    nationalIdIssuedOn: optional(z.iso.date()),
    nationalIdIssuedAt: text(200),
    taxCode: text(40),
    socialInsuranceNumber: text(40),
  }).prefault({}),
  bankAccount: z.object({ bankName: text(120), accountNumber: text(40), accountHolder: text(120), branch: text(120) }).prefault({}),
};

type Parsed = { personal: z.output<typeof changeInput.personal>; restricted: z.output<typeof changeInput.restricted>; bankAccount: z.output<typeof changeInput.bankAccount> };

function toChange(input: Parsed) {
  const { bankName, accountNumber, accountHolder, branch } = input.bankAccount;
  // A bank account is a bank and a number; anything less is a half-filled block.
  if ((bankName || accountNumber || accountHolder || branch) && !(bankName && accountNumber)) throw new ActionError("change_request_bank_incomplete");
  return { personal: input.personal, restricted: input.restricted, bankAccount: bankName && accountNumber ? { bankName, accountNumber, accountHolder, branch } : null };
}

// What reaches the audit log: personal values as a diff, restricted ones by name only.
const auditable = (payload: { personal: unknown; restricted: string[] }) => ({ personal: payload.personal, restrictedFields: payload.restricted });

const refresh = (personId: string | null, requestId: string) => {
  revalidatePath("/me");
  revalidatePath("/approvals");
  revalidatePath(`/approvals/profile-change/${requestId}`);
  if (personId) revalidatePath(`/people/${personId}`);
};

// Self-service: a request is always about the person who files it, so being signed in is the
// whole authorization. HR changes other people's data directly, not through requests.
const submitPipeline = createAction({
  name: "change_request.submit",
  input: z.object(changeInput),
  authorize: () => true,
  run: async ({ user, input }) => {
    const { request, payload } = await submitProfileChange(user.person.id, toChange(input));
    refresh(user.person.id, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:profile_change", id: request.id, entityId: request.entityId }, summary: request.summary, after: auditable(payload) } };
  },
});

export async function submitProfileChangeAction(input: unknown) {
  return submitPipeline(input);
}

const resubmitPipeline = createAction({
  name: "change_request.resubmit",
  input: z.object({ requestId: z.uuid(), ...changeInput }),
  // The engine refuses anyone but the requester; checked here too so a refusal is audited as one.
  authorize: async (user, input) => !!(await getProfileChange({ personId: user.person.id, principal: user.principal }, input.requestId))?.isRequester,
  run: async ({ user, input }) => {
    const { request, payload } = await resubmitProfileChange(user.person.id, input.requestId, toChange(input));
    refresh(user.person.id, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:profile_change", id: request.id, entityId: request.entityId }, summary: request.summary, after: auditable(payload) } };
  },
});

export async function resubmitProfileChangeAction(input: unknown) {
  return resubmitPipeline(input);
}

const decidePipeline = createAction({
  name: "change_request.decide",
  input: z.object({
    requestId: z.uuid(),
    // The clicked button.
    decision: z.enum(["approve", "reject", "return"]),
    comment: text(1000),
    verifiedSecondChannel: z.preprocess((value) => value === "on" || value === true, z.boolean()),
  }),
  authorize: async (user, input) => !!(await getProfileChange({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome, payload, entityId } = await decideProfileChange({ personId: user.person.id, principal: user.principal }, input.requestId, {
      action: input.decision,
      comment: input.comment,
      verifiedSecondChannel: input.verifiedSecondChannel,
    });
    refresh(request.subjectPersonId, request.id);
    return {
      data: { outcome },
      audit: {
        resource: { type: "person", id: request.subjectPersonId, entityId },
        summary: `${input.decision}: ${request.summary}`,
        before: { status: before.status },
        after: { status: request.status, requestId: request.id, applied: outcome === "approved" ? auditable(payload) : null, verifiedSecondChannel: input.decision === "approve" && input.verifiedSecondChannel },
      },
    };
  },
});

export async function decideProfileChangeAction(input: unknown) {
  return decidePipeline(input);
}

// Looking at the proposed restricted values is a disclosure like any other reveal.
const revealPipeline = createAction({
  name: "change_request.sensitive.read",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => !!(await getProfileChange({ personId: user.person.id, principal: user.principal }, input.requestId))?.canReveal,
  run: async ({ user, input }) => {
    const revealed = await revealProfileChange({ personId: user.person.id, principal: user.principal }, input.requestId);
    if (!revealed) throw new ActionError("forbidden");
    return { data: revealed.values, audit: { resource: { type: "approval:profile_change", id: input.requestId, entityId: revealed.entityId }, summary: `fields: ${revealed.fields.join(", ")}` } };
  },
});

export async function revealChangeRequestAction(input: unknown) {
  return revealPipeline(input);
}
