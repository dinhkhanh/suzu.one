"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "../rbac/policy";
import type { CurrentUser } from "../auth/session";
import { ORG_UNIT_KINDS, PAYING_BANK_KEYS } from "./enums";
import { departmentImport } from "./import";
import { canKeepEntityBankAccounts } from "./policy";
import { createBranch, createEntity, createOrgUnit, findBranch, findEntityBankAccount, findOrgUnit, saveEntityBankAccount, updateBranch, updateEntity, updateOrgUnit } from "./service";

// Forms post every field; a blank one means "no value". A checkbox posts "on" or nothing at all.
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

const entityInput = z.object({
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/),
  legalName: z.string().trim().min(2).max(200),
  shortName: z.string().trim().min(1).max(60),
  taxCode: z.string().trim().max(20).optional(),
  wageRegion: z.coerce.number().int().min(1).max(4).optional(),
});

const createEntityPipeline = createAction({
  name: "entity.create",
  input: entityInput,
  // A new entity sits outside every existing entity scope, so this needs a group-wide grant.
  authorize: (user) => can(user.principal, "org:manage", {}),
  run: async ({ input }) => {
    const created = await createEntity(input);
    revalidatePath("/admin/entities");
    return {
      data: { id: created.id },
      audit: { resource: { type: "entity", id: created.id, entityId: created.id }, summary: created.code, after: created },
    };
  },
});

export async function createEntityAction(input: unknown) {
  return createEntityPipeline(input);
}

const updateEntityPipeline = createAction({
  name: "entity.update",
  input: z.object({
    id: z.uuid(),
    legalName: z.string().trim().min(2).max(200),
    shortName: z.string().trim().min(1).max(60),
    taxCode: text(20),
    insuranceUnitCode: text(30),
    wageRegion: optional(z.coerce.number().int().min(1).max(4)),
    address: text(300),
    legalRepresentative: text(120),
    isActive: checkbox,
  }),
  authorize: (user, input) => can(user.principal, "org:manage", { entityId: input.id }),
  run: async ({ input }) => {
    const { id, ...details } = input;
    const { before, after } = await updateEntity(id, details);
    revalidatePath("/admin/entities");
    revalidatePath(`/admin/entities/${id}`);
    return { data: { id }, audit: { resource: { type: "entity", id, entityId: id }, summary: after.code, before, after } };
  },
});

export async function updateEntityAction(input: unknown) {
  return updateEntityPipeline(input);
}

const createBranchPipeline = createAction({
  name: "branch.create",
  input: z.object({ entityId: z.uuid(), name: z.string().trim().min(1).max(120), address: text(300) }),
  authorize: (user, input) => can(user.principal, "org:manage", { entityId: input.entityId }),
  run: async ({ input }) => {
    const created = await createBranch(input);
    revalidatePath(`/admin/entities/${input.entityId}`);
    return { data: { id: created.id }, audit: { resource: { type: "branch", id: created.id, entityId: created.entityId }, summary: created.name, after: created } };
  },
});

export async function createBranchAction(input: unknown) {
  return createBranchPipeline(input);
}

const updateBranchPipeline = createAction({
  name: "branch.update",
  input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), address: text(300), isActive: checkbox }),
  authorize: async (user, input) => {
    const branch = await findBranch(input.id);
    return !!branch && can(user.principal, "org:manage", { entityId: branch.entityId });
  },
  run: async ({ input }) => {
    const { id, ...details } = input;
    const { before, after } = await updateBranch(id, details);
    revalidatePath(`/admin/entities/${after.entityId}`);
    return { data: { id }, audit: { resource: { type: "branch", id, entityId: after.entityId }, summary: after.name, before, after } };
  },
});

export async function updateBranchAction(input: unknown) {
  return updateBranchPipeline(input);
}

// The entity's paying bank accounts (FR-PLT-11). Whoever keeps the entity's details may keep
// these too, and so may the chief accountant, whose accounts they are (`policy.ts`). They are the
// company's own accounts, not a person's, so the audit row keeps them in full.
const mayKeepBankAccounts = (user: CurrentUser, entityId: string) => canKeepEntityBankAccounts(user.principal, entityId);
const bankAccountFields = {
  accountNumber: z.string().trim().regex(/^[\d\s-]{6,40}$/),
  accountName: z.string().trim().min(1).max(160),
  branch: text(160),
  isDefault: checkbox,
};
const refreshBankAccounts = (entityId: string) => {
  revalidatePath(`/admin/entities/${entityId}`);
  revalidatePath("/payroll/runs", "layout");
};

const createBankAccountPipeline = createAction({
  name: "entity_bank_account.create",
  input: z.object({ entityId: z.uuid(), bank: z.enum(PAYING_BANK_KEYS), ...bankAccountFields }),
  authorize: (user, input) => mayKeepBankAccounts(user, input.entityId),
  run: async ({ input }) => {
    const { entityId, ...details } = input;
    const { after } = await saveEntityBankAccount(entityId, null, { ...details, isActive: true });
    refreshBankAccounts(entityId);
    return { data: { id: after.id }, audit: { resource: { type: "entity_bank_account", id: after.id, entityId }, summary: `${after.bank} ${after.accountNumber}`, after } };
  },
});

export async function createEntityBankAccountAction(input: unknown) {
  return createBankAccountPipeline(input);
}

const updateBankAccountPipeline = createAction({
  name: "entity_bank_account.update",
  input: z.object({ id: z.uuid(), ...bankAccountFields, isActive: checkbox }),
  authorize: async (user, input) => {
    const account = await findEntityBankAccount(input.id);
    return !!account && mayKeepBankAccounts(user, account.entityId);
  },
  run: async ({ input }) => {
    const { id, ...details } = input;
    // Which bank an account is with never changes: a different bank is a different account.
    const account = (await findEntityBankAccount(id))!;
    const { before, after } = await saveEntityBankAccount(account.entityId, id, { ...details, bank: account.bank });
    refreshBankAccounts(after.entityId);
    return { data: { id }, audit: { resource: { type: "entity_bank_account", id, entityId: after.entityId }, summary: `${after.bank} ${after.accountNumber}`, before, after } };
  },
});

export async function updateEntityBankAccountAction(input: unknown) {
  return updateBankAccountPipeline(input);
}

// A shared unit (no entity) belongs to the whole group, so only a group-wide grant may touch it;
// an entity's own unit goes to whoever manages that entity — or to a grant over the unit itself,
// which covers everything below it (FR-PLT-16).
const unitTarget = (unit: { entityId: string | null; path?: readonly string[] }) => (unit.entityId ? { entityId: unit.entityId, unitPath: unit.path } : { unitPath: unit.path });

const createOrgUnitPipeline = createAction({
  name: "org_unit.create",
  input: z.object({
    code: optional(z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/)),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(ORG_UNIT_KINDS).default("team"),
    parentId: optional(z.uuid()),
    entityId: optional(z.uuid()),
  }),
  authorize: async (user, input) => {
    // Inside an existing unit the parent decides; a new root unit needs the entity (or the group).
    const parent = input.parentId ? await findOrgUnit(input.parentId) : undefined;
    if (input.parentId && !parent) return false;
    return can(user.principal, "org:manage", parent ? unitTarget(parent) : unitTarget({ entityId: input.entityId }));
  },
  run: async ({ input }) => {
    const created = await createOrgUnit(input);
    revalidatePath("/admin/org");
    return { data: { id: created.id }, audit: { resource: { type: "org_unit", id: created.id, entityId: created.entityId }, summary: created.name, after: created } };
  },
});

export async function createOrgUnitAction(input: unknown) {
  return createOrgUnitPipeline(input);
}

const updateOrgUnitPipeline = createAction({
  name: "org_unit.update",
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(ORG_UNIT_KINDS),
    parentId: optional(z.uuid()),
    isActive: checkbox,
  }),
  // Moving a unit is two questions: may you touch it where it is, and may you put it where it is going?
  authorize: async (user, input) => {
    const unit = await findOrgUnit(input.id);
    if (!unit || !can(user.principal, "org:manage", unitTarget(unit))) return false;
    if (input.parentId === unit.parentId) return true;
    const parent = input.parentId ? await findOrgUnit(input.parentId) : undefined;
    if (input.parentId && !parent) return false;
    return can(user.principal, "org:manage", parent ? unitTarget(parent) : unitTarget({ entityId: unit.entityId }));
  },
  run: async ({ input }) => {
    const { id, ...details } = input;
    const { before, after } = await updateOrgUnit(id, details);
    revalidatePath("/admin/org");
    revalidatePath("/kb");
    return { data: { id }, audit: { resource: { type: "org_unit", id, entityId: after.entityId }, summary: after.name, before, after } };
  },
});

export async function updateOrgUnitAction(input: unknown) {
  return updateOrgUnitPipeline(input);
}

export async function stageDepartmentImportAction(input: unknown) {
  return departmentImport.stage(input);
}

export async function commitDepartmentImportAction(input: unknown) {
  return departmentImport.commit(input);
}
