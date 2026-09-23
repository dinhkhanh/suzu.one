"use server";
// Offer mutations and the conversion to an employee, each through the one pipeline
// (parse → authenticate → authorize → run → audit).
//
// Three things are deliberate and worth stating once:
//
//   · **Not one audit entry carries a figure.** What is recorded is the offer's number, the job,
//     the start date and who did what. The audit log is read across the company; an offer is read
//     by two people. The same goes for every `revalidatePath` target and every notification.
//   · **Writing a figure asks for a fresh proof of identity** (`stepUp`, FR-PLT-06), exactly as
//     payroll's salary actions do — typing next year's salary for a new colleague is the same act
//     as typing this year's for an existing one. Recording what the candidate *said* does not:
//     that is a recruiter taking a phone call, and it reveals nothing.
//   · **Conversion needs `person:manage`**, not just recruitment: it writes to the employee
//     register. A recruiter runs the pipeline; HR puts somebody on the books.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { EMPLOYMENT_TYPES, OFFER_DECLINE_REASONS, OFFER_LIMITS } from "./enums";
import { convertToEmployee, decideOfferRequest, findOffer, makeOffer, recordOfferResponse, sendOffer, submitOfferForApproval, updateOffer, withdrawOffer } from "./offers";
import { canConvertToEmployee, canMakeOffer, canRecordOfferResponse } from "./policy";
import { findApplication, findOpening, isOpeningMember } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
// Forms post "22.000.000" or "22,000,000": separators are dropped, anything else is refused —
// the same reading payroll's salary form does, so a recruiter and C&B type money the same way.
const vnd = z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() === "" ? 0 : /^[\d.,\s_]+$/.test(value) ? Number(value.replace(/[.,\s_]/g, "")) : Number.NaN) : value),
  z.number().int().min(0).max(OFFER_LIMITS.maxMonthlyVnd),
);

const offerFields = {
  positionName: z.string().trim().min(1).max(200),
  jobLevel: optional(z.string().trim().max(80)),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: optional(z.string().trim().max(200)),
  managerPersonId: optional(z.uuid()),
  startDate: z.iso.date(),
  expiresOn: optional(z.iso.date()),
  probationMonths: z.coerce.number().int().min(0).max(OFFER_LIMITS.probationMonths),
  probationSalaryPercent: z.coerce.number().int().min(OFFER_LIMITS.probationPercentMin).max(100),
  baseSalaryVnd: vnd,
  allowancesVnd: vnd,
  letterTemplateId: optional(z.uuid()),
  note: optional(z.string().trim().max(OFFER_LIMITS.note)),
};

const openingTargetOf = (row: { entityId: string; departmentId: string | null; teamId: string | null }) => ({ entityId: row.entityId, departmentId: row.departmentId, teamId: row.teamId });

/** The opening behind an application or an offer — resolved every time, never taken from the input. */
async function openingOfApplication(applicationId: string) {
  const application = await findApplication(applicationId);
  return application ? findOpening(application.openingId) : undefined;
}

async function openingOfOffer(offerId: string) {
  const offer = await findOffer(offerId);
  return offer ? findOpening(offer.openingId) : undefined;
}

const refresh = (offerId: string | null, applicationId: string | null) => {
  revalidatePath("/recruit/offers");
  revalidatePath("/approvals");
  if (offerId) revalidatePath(`/recruit/offers/${offerId}`);
  if (applicationId) revalidatePath(`/recruit/applications/${applicationId}`);
};

// ── Drafting ────────────────────────────────────────────────────────────────────────────────

const makeOfferPipeline = createAction({
  name: "recruit.offer.make",
  stepUp: true,
  input: z.object({ applicationId: z.uuid(), ...offerFields }),
  authorize: async (user, input) => {
    const opening = await openingOfApplication(input.applicationId);
    return !!opening && canMakeOffer(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const offer = await makeOffer(input, user.person.id);
    refresh(offer.id, input.applicationId);
    return {
      data: { id: offer.id, number: offer.number },
      // The number, the job and the date. No đồng anywhere.
      audit: { resource: { type: "job_offer", id: offer.id, entityId: offer.entityId }, summary: `${offer.number} · ${offer.positionName}`, after: { startDate: offer.startDate, employmentType: offer.employmentType, status: offer.status } },
    };
  },
});

const updateOfferPipeline = createAction({
  name: "recruit.offer.update",
  stepUp: true,
  input: z.object({ offerId: z.uuid(), ...offerFields }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canMakeOffer(user.principal, openingTargetOf(opening));
  },
  run: async ({ input }) => {
    const offer = await findOffer(input.offerId);
    if (!offer) throw new ActionError("offer_not_found");
    const { before, after } = await updateOffer(input.offerId, { ...input, applicationId: offer.applicationId });
    refresh(after.id, after.applicationId);
    return {
      data: { id: after.id },
      audit: {
        resource: { type: "job_offer", id: after.id, entityId: after.entityId },
        summary: after.number,
        // Whether the money moved, never by how much: "somebody changed the figure" is a fact the
        // audit log should carry, and the figure itself is not.
        before: { startDate: before.startDate, positionName: before.positionName },
        after: { startDate: after.startDate, positionName: after.positionName, moneyChanged: before.baseSalaryVnd !== after.baseSalaryVnd || before.allowancesVnd !== after.allowancesVnd },
      },
    };
  },
});

// ── Its life ────────────────────────────────────────────────────────────────────────────────

const submitOfferPipeline = createAction({
  name: "recruit.offer.submit",
  input: z.object({ offerId: z.uuid() }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canMakeOffer(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const { offer, requestId } = await submitOfferForApproval(input.offerId, user.person.id);
    refresh(offer.id, offer.applicationId);
    return { data: { id: offer.id, requestId }, audit: { resource: { type: "job_offer", id: offer.id, entityId: offer.entityId }, summary: offer.number, after: { status: offer.status, requestId } } };
  },
});

const sendOfferPipeline = createAction({
  name: "recruit.offer.send",
  input: z.object({ offerId: z.uuid() }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canMakeOffer(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const offer = await sendOffer(input.offerId, user.person.id);
    refresh(offer.id, offer.applicationId);
    return { data: { id: offer.id }, audit: { resource: { type: "job_offer", id: offer.id, entityId: offer.entityId }, summary: offer.number, after: { status: offer.status } } };
  },
});

const respondPipeline = createAction({
  name: "recruit.offer.respond",
  // No step-up: writing down what somebody said on the telephone reveals no figure.
  input: z.object({ offerId: z.uuid(), answer: z.enum(["accept", "decline"]), reason: optional(z.enum(OFFER_DECLINE_REASONS)), note: optional(z.string().trim().max(2000)) }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canRecordOfferResponse(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
  },
  run: async ({ user, input }) => {
    const { after } = await recordOfferResponse(input.offerId, { answer: input.answer, reason: input.reason, note: input.note }, user.person.id);
    refresh(after.id, after.applicationId);
    return {
      data: { id: after.id, status: after.status },
      audit: { resource: { type: "job_offer", id: after.id, entityId: after.entityId }, summary: after.number, after: { status: after.status, ...(after.declineReason ? { reason: after.declineReason } : {}) } },
    };
  },
});

const withdrawOfferPipeline = createAction({
  name: "recruit.offer.withdraw",
  input: z.object({ offerId: z.uuid(), note: optional(z.string().trim().max(2000)) }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canMakeOffer(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const { after } = await withdrawOffer(input.offerId, user.person.id, input.note);
    refresh(after.id, after.applicationId);
    return { data: { id: after.id }, audit: { resource: { type: "job_offer", id: after.id, entityId: after.entityId }, summary: after.number, after: { status: after.status } } };
  },
});

const decideOfferPipeline = createAction({
  name: "recruit.offer.decide",
  // The approval engine decides whether this person is the approver whose turn it is; it throws a
  // user-facing refusal when they are not, which is a different answer from "you may not be here".
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: optional(z.string().trim().max(2000)) }),
  authorize: (user) => !!user.person.id,
  // An offer is a salary: whoever answers — a delegate included — has just proved it is them.
  stepUp: true,
  run: async ({ user, input }) => {
    const { request, outcome, offerId, offer } = await decideOfferRequest(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    refresh(offerId, offer?.applicationId ?? null);
    return {
      data: { outcome },
      audit: { resource: { type: "job_offer", id: offerId, entityId: request.entityId }, summary: request.summary, after: { decision: input.decision, outcome } },
    };
  },
});

// ── Becoming an employee (FR-REC-09) ────────────────────────────────────────────────────────

const convertPipeline = createAction({
  name: "recruit.offer.convert",
  input: z.object({ offerId: z.uuid(), employeeCode: optional(z.string().trim().max(32)) }),
  authorize: async (user, input) => {
    const opening = await openingOfOffer(input.offerId);
    return !!opening && canConvertToEmployee(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const offer = await findOffer(input.offerId);
    const result = await convertToEmployee(input.offerId, user.person.id, { employeeCode: input.employeeCode });
    refresh(input.offerId, offer?.applicationId ?? null);
    revalidatePath("/people");
    revalidatePath(`/people/${result.personId}`);
    return {
      data: result,
      audit: {
        resource: { type: "job_offer", id: input.offerId, entityId: offer?.entityId ?? null },
        summary: `${offer?.number ?? ""} → ${result.employeeCode ?? result.personId}`,
        // The salary proposal's id, not its contents — and whether it failed, which is worth seeing.
        after: { personId: result.personId, employeeCode: result.employeeCode, salaryRequestId: result.salaryRequestId, salaryProblem: result.salaryProblem },
      },
    };
  },
});

// A `"use server"` file may export nothing but async functions — exporting a pipeline as a const
// makes the bundler drop every export of the module (tests/server-actions.test.ts).

export async function makeOfferAction(input: unknown) {
  return makeOfferPipeline(input);
}

export async function updateOfferAction(input: unknown) {
  return updateOfferPipeline(input);
}

export async function submitOfferAction(input: unknown) {
  return submitOfferPipeline(input);
}

export async function sendOfferAction(input: unknown) {
  return sendOfferPipeline(input);
}

export async function respondToOfferAction(input: unknown) {
  return respondPipeline(input);
}

export async function withdrawOfferAction(input: unknown) {
  return withdrawOfferPipeline(input);
}

export async function decideOfferAction(input: unknown) {
  return decideOfferPipeline(input);
}

export async function convertOfferToEmployeeAction(input: unknown) {
  return convertPipeline(input);
}
