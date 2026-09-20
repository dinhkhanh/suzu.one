"use server";
// Salary change flow (FR-PAY-04). Every action asks for a recent re-authentication (FR-PLT-06).
// What reaches the audit log: who, which person, the reason and the effective date — never a figure.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { SALARY_CHANGE_REASONS } from "./enums";
import { canDecideSalaryChange, canManageCompensation } from "./policy";
import { decideSalaryChange, resubmitSalaryChange, salaryChangeEntity, submitSalaryChange, withdrawSalaryChange } from "./salaries";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));
// Forms post "20.000.000" or "20,000,000": separators are dropped, anything else is refused.
const vnd = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? 0 : /^[\d.,\s_]+$/.test(value) ? Number(value.replace(/[.,\s_]/g, "")) : Number.NaN) : value), z.number().int().min(0).max(100_000_000_000));

const changeInput = z.object({
  personId: z.uuid(),
  validFrom: z.iso.date(),
  reason: z.enum(SALARY_CHANGE_REASONS),
  note: text(1000),
  terms: z.object({
    baseSalary: vnd,
    insuranceSalary: vnd,
    // The form posts one field per catalogue component: { ALW_MEAL: "730000", … }.
    allowances: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), vnd).default({}),
  }),
});

const toInput = (input: z.output<typeof changeInput>) => ({ ...input, terms: { baseSalary: input.terms.baseSalary, insuranceSalary: input.terms.insuranceSalary, allowances: Object.entries(input.terms.allowances).map(([code, amount]) => ({ code, amount })) } });

const refresh = (personId: string | null, requestId?: string) => {
  revalidatePath("/payroll/salaries");
  revalidatePath("/approvals");
  if (personId) revalidatePath(`/payroll/salaries/${personId}`);
  if (requestId) revalidatePath(`/payroll/salaries/changes/${requestId}`);
};

const managesPerson = async (user: { principal: Parameters<typeof canManageCompensation>[0] }, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && canManageCompensation(user.principal, target);
};

const submitPipeline = createAction({
  name: "salary_change.submit",
  stepUp: true,
  input: changeInput,
  authorize: (user, input) => managesPerson(user, input.personId),
  run: async ({ user, input }) => {
    const { request, payload } = await submitSalaryChange(user.person.id, toInput(input));
    refresh(input.personId, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:salary_change", id: request.id, entityId: request.entityId }, summary: request.summary, after: { personId: input.personId, reason: payload.reason, validFrom: payload.validFrom } } };
  },
});
export async function submitSalaryChangeAction(input: unknown) {
  return submitPipeline(input);
}

const resubmitPipeline = createAction({
  name: "salary_change.resubmit",
  stepUp: true,
  input: changeInput.extend({ requestId: z.uuid() }),
  authorize: async (user, input) => (await managesPerson(user, input.personId)) && (await salaryChangeEntity(input.requestId))?.requesterPersonId === user.person.id,
  run: async ({ user, input }) => {
    const { request, payload } = await resubmitSalaryChange(user.person.id, input.requestId, toInput(input));
    refresh(input.personId, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:salary_change", id: request.id, entityId: request.entityId }, summary: request.summary, after: { personId: input.personId, reason: payload.reason, validFrom: payload.validFrom } } };
  },
});
export async function resubmitSalaryChangeAction(input: unknown) {
  return resubmitPipeline(input);
}

const withdrawPipeline = createAction({
  name: "salary_change.withdraw",
  stepUp: true,
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => (await salaryChangeEntity(input.requestId))?.requesterPersonId === user.person.id,
  run: async ({ user, input }) => {
    const { request } = await withdrawSalaryChange(user.person.id, input.requestId);
    refresh(request.subjectPersonId, request.id);
    return { data: { id: request.id }, audit: { resource: { type: "approval:salary_change", id: request.id, entityId: request.entityId }, summary: "withdrawn" } };
  },
});
export async function withdrawSalaryChangeAction(input: unknown) {
  return withdrawPipeline(input);
}

const decidePipeline = createAction({
  name: "salary_change.decide",
  stepUp: true,
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  // Trusted with figures over the request's entity; whether it is their turn is the engine's call.
  authorize: async (user, input) => {
    const where = await salaryChangeEntity(input.requestId);
    return !!where && canDecideSalaryChange(user.principal, where);
  },
  run: async ({ user, input }) => {
    const { request, outcome, payload, structureId, subjectPersonId } = await decideSalaryChange({ personId: user.person.id, principal: user.principal }, input.requestId, { action: input.decision, comment: input.comment });
    refresh(subjectPersonId, request.id);
    return {
      data: { id: request.id, outcome, structureId },
      audit: { resource: { type: "approval:salary_change", id: request.id, entityId: request.entityId }, summary: `${input.decision} → ${outcome}`, after: { personId: subjectPersonId, reason: payload.reason, validFrom: payload.validFrom, structureId } },
    };
  },
});
export async function decideSalaryChangeAction(input: unknown) {
  return decidePipeline(input);
}
