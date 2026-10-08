"use server";
// Pay rules (FR-PLT-39, SRS D17): components, formulas, pay policies and pay profiles are proposed
// by C&B and take effect only when the owner approves. Every action asks for a recent
// re-authentication (FR-PLT-06). Audit rows describe rules — which are not pay — in full, and
// profile changes by kind and date.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { decideComponent, proposeComponent, voidComponent } from "./components";
import { COMPONENT_CATEGORIES, COMPONENT_KINDS, COMPONENT_SOURCES, INSURANCE_EXEMPTIONS, PAY_PROFILES, payrollPolicySchema, PIT_METHODS, PRORATIONS, SIMPLE_BASES, TAX_RESIDENCIES, TAX_TREATMENTS } from "./enums";
import { decidePolicy, proposePolicy, voidPolicy } from "./policies";
import { canDecidePayRules, canManageCompensation, canProposePayRules, canVoidPayRule, canVoidProfile } from "./policy";
import { decideProfile, getProfile, submitProfile, voidProfile } from "./profiles";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(inner: Schema) => z.preprocess(blankToNull, inner.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const flag = z.preprocess((value) => value === true || value === "true" || value === "on", z.boolean());
const wholeNumber = z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[.,\s_]/g, "")) : value), z.number().int());
const decision = z.enum(["approve", "reject"]);
// Why a wrong approved version is taken back (PAY-13): required, and kept on the version for good.
const voiding = z.object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) });

const proposeComponentPipeline = createAction({
  name: "pay_component.propose",
  stepUp: true,
  input: z.object({
    entityId: optional(z.uuid()),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    name: z.string().trim().min(1).max(120),
    nameEn: text(120),
    kind: z.enum(COMPONENT_KINDS),
    category: z.enum(COMPONENT_CATEGORIES),
    source: z.enum(COMPONENT_SOURCES),
    taxTreatment: z.enum(TAX_TREATMENTS),
    exemptCap: optional(wholeNumber.pipe(z.number().int().min(0).max(1_000_000_000))),
    subjectToInsurance: flag,
    proration: z.enum(PRORATIONS),
    roundingRule: z.string().max(40),
    formula: text(500),
    sortOrder: wholeNumber.pipe(z.number().int().min(0).max(10_000)).default(100),
    validFrom: z.iso.date(),
    note: text(500),
  }),
  authorize: (user) => canProposePayRules(user.principal),
  run: async ({ user, input }) => {
    const created = await proposeComponent(input, user.person.id);
    revalidatePath("/payroll/components");
    return { data: { id: created.id }, audit: { resource: { type: "pay_component", id: created.id, entityId: created.entityId }, summary: `${created.code} from ${created.validFrom}`, after: created } };
  },
});
export async function proposeComponentAction(input: unknown) {
  return proposeComponentPipeline(input);
}

const decideComponentPipeline = createAction({
  name: "pay_component.decide",
  stepUp: true,
  input: z.object({ id: z.uuid(), decision }),
  authorize: (user) => canDecidePayRules(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decideComponent(input.id, input.decision, user.person.id);
    revalidatePath("/payroll/components");
    return { data: { id: after.id }, audit: { resource: { type: "pay_component", id: after.id, entityId: after.entityId }, summary: `${input.decision} ${after.code} from ${after.validFrom}`, before, after } };
  },
});
export async function decideComponentAction(input: unknown) {
  return decideComponentPipeline(input);
}

const proposePolicyPipeline = createAction({
  name: "payroll_policy.propose",
  stepUp: true,
  input: z.object({
    entityId: optional(z.uuid()),
    validFrom: z.iso.date(),
    note: text(500),
    value: z.object({
      prorationBasis: payrollPolicySchema.shape.prorationBasis,
      fixedDays: optional(wholeNumber),
      hoursPerDay: wholeNumber,
      overtimeBase: payrollPolicySchema.shape.overtimeBase,
      unionEnabled: flag,
      simplePitTreatment: payrollPolicySchema.shape.simplePitTreatment,
      varianceThresholdBp: wholeNumber,
      payDay: wholeNumber,
      payDayShift: payrollPolicySchema.shape.payDayShift,
    }),
  }),
  authorize: (user) => canProposePayRules(user.principal),
  run: async ({ user, input }) => {
    const created = await proposePolicy(input, user.person.id);
    revalidatePath("/payroll/policy");
    return { data: { id: created.id }, audit: { resource: { type: "payroll_policy", id: created.id, entityId: created.entityId }, summary: `pay policy from ${created.validFrom}`, after: created } };
  },
});
export async function proposePolicyAction(input: unknown) {
  return proposePolicyPipeline(input);
}

const decidePolicyPipeline = createAction({
  name: "payroll_policy.decide",
  stepUp: true,
  input: z.object({ id: z.uuid(), decision }),
  authorize: (user) => canDecidePayRules(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decidePolicy(input.id, input.decision, user.person.id);
    revalidatePath("/payroll/policy");
    return { data: { id: after.id }, audit: { resource: { type: "payroll_policy", id: after.id, entityId: after.entityId }, summary: `${input.decision} pay policy from ${after.validFrom}`, before, after } };
  },
});
export async function decidePolicyAction(input: unknown) {
  return decidePolicyPipeline(input);
}

// ── Pay profiles ────────────────────────────────────────────────────────────────────────────

const submitProfilePipeline = createAction({
  name: "pay_profile.submit",
  stepUp: true,
  input: z.object({
    personId: z.uuid(),
    profile: z.enum(PAY_PROFILES),
    simpleBasis: optional(z.enum(SIMPLE_BASES)),
    reviewDate: optional(z.iso.date()),
    taxResidency: z.enum(TAX_RESIDENCIES),
    pitMethod: z.enum(PIT_METHODS),
    pitCommitment: flag,
    insuranceExemption: optional(z.enum(INSURANCE_EXEMPTIONS)),
    unionMember: flag,
    validFrom: z.iso.date(),
    note: text(500),
  }),
  // An unknown person and a person in someone else's entity get the same answer.
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    return !!target && canManageCompensation(user.principal, target);
  },
  run: async ({ user, input }) => {
    const created = await submitProfile(input, user.person.id);
    revalidatePath("/payroll/profiles");
    revalidatePath(`/payroll/salaries/${input.personId}`);
    return {
      data: { id: created.id, status: created.status },
      audit: { resource: { type: "pay_profile", id: created.id, entityId: created.entityId }, summary: `${created.profile} from ${created.validFrom} (${created.status})`, after: created },
    };
  },
});
export async function submitProfileAction(input: unknown) {
  return submitProfilePipeline(input);
}

const decideProfilePipeline = createAction({
  name: "pay_profile.decide",
  stepUp: true,
  input: z.object({ id: z.uuid(), decision }),
  // Moving someone between profiles is the owner's call (FR-PAY-07).
  authorize: (user) => canDecidePayRules(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await decideProfile(input.id, input.decision, user.person.id);
    revalidatePath("/payroll/profiles");
    revalidatePath(`/payroll/salaries/${after.personId}`);
    return { data: { id: after.id }, audit: { resource: { type: "pay_profile", id: after.id, entityId: after.entityId }, summary: `${input.decision} ${after.profile} from ${after.validFrom}`, before, after } };
  },
});
export async function decideProfileAction(input: unknown) {
  return decideProfilePipeline(input);
}

// ── Taking back a wrong approved version (PAY-13) ───────────────────────────────────────────

const voidComponentPipeline = createAction({
  name: "pay_component.void",
  stepUp: true,
  input: voiding,
  authorize: (user) => canVoidPayRule(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await voidComponent(input.id, input.reason, user.person.id);
    revalidatePath("/payroll/components");
    return { data: { id: after.id }, audit: { resource: { type: "pay_component", id: after.id, entityId: after.entityId }, summary: `void ${after.code} from ${after.validFrom}: ${input.reason}`, before, after } };
  },
});
export async function voidComponentAction(input: unknown) {
  return voidComponentPipeline(input);
}

const voidPolicyPipeline = createAction({
  name: "payroll_policy.void",
  stepUp: true,
  input: voiding,
  authorize: (user) => canVoidPayRule(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await voidPolicy(input.id, input.reason, user.person.id);
    revalidatePath("/payroll/policy");
    return { data: { id: after.id }, audit: { resource: { type: "payroll_policy", id: after.id, entityId: after.entityId }, summary: `void pay policy from ${after.validFrom}: ${input.reason}`, before, after } };
  },
});
export async function voidPolicyAction(input: unknown) {
  return voidPolicyPipeline(input);
}

const voidProfilePipeline = createAction({
  name: "pay_profile.void",
  stepUp: true,
  input: voiding,
  // The profile is read first and judged by its own entity and by whether the owner approved it;
  // an id that does not exist is refused like one that is not yours.
  authorize: async (user, input) => {
    const profile = await getProfile(input.id);
    return !!profile && canVoidProfile(user.principal, profile);
  },
  run: async ({ user, input }) => {
    const { before, after } = await voidProfile(input.id, input.reason, user.person.id);
    revalidatePath("/payroll/profiles");
    revalidatePath(`/payroll/salaries/${after.personId}`);
    return { data: { id: after.id }, audit: { resource: { type: "pay_profile", id: after.id, entityId: after.entityId }, summary: `void ${after.profile} from ${after.validFrom}: ${input.reason}`, before, after } };
  },
});
export async function voidProfileAction(input: unknown) {
  return voidProfilePipeline(input);
}
