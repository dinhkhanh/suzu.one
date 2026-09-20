"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "../rbac/policy";
import { departmentImport } from "./import";
import { createBranch, createDepartment, createEntity, createTeam, findBranch, findDepartment, findTeam, updateBranch, updateDepartment, updateEntity, updateTeam } from "./service";

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

// A shared department (no entity) belongs to the whole group, so only a group-wide grant may touch it.
const departmentTarget = (department: { id?: string; entityId: string | null }) => (department.entityId ? { entityId: department.entityId, departmentId: department.id } : {});

const createDepartmentPipeline = createAction({
  name: "department.create",
  input: z.object({
    code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(120),
    parentId: optional(z.uuid()),
    entityId: optional(z.uuid()),
  }),
  authorize: (user, input) => can(user.principal, "org:manage", departmentTarget(input)),
  run: async ({ input }) => {
    const created = await createDepartment(input);
    revalidatePath("/admin/org");
    return { data: { id: created.id }, audit: { resource: { type: "department", id: created.id, entityId: created.entityId }, summary: created.code, after: created } };
  },
});

export async function createDepartmentAction(input: unknown) {
  return createDepartmentPipeline(input);
}

const updateDepartmentPipeline = createAction({
  name: "department.update",
  input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), parentId: optional(z.uuid()), isActive: checkbox }),
  authorize: async (user, input) => {
    const department = await findDepartment(input.id);
    return !!department && can(user.principal, "org:manage", departmentTarget(department));
  },
  run: async ({ input }) => {
    const { id, ...details } = input;
    const { before, after } = await updateDepartment(id, details);
    revalidatePath("/admin/org");
    return { data: { id }, audit: { resource: { type: "department", id, entityId: after.entityId }, summary: after.code, before, after } };
  },
});

export async function updateDepartmentAction(input: unknown) {
  return updateDepartmentPipeline(input);
}

const createTeamPipeline = createAction({
  name: "team.create",
  input: z.object({ departmentId: z.uuid(), name: z.string().trim().min(1).max(120) }),
  authorize: async (user, input) => {
    const department = await findDepartment(input.departmentId);
    return !!department && can(user.principal, "org:manage", departmentTarget(department));
  },
  run: async ({ input }) => {
    const created = await createTeam(input);
    revalidatePath("/admin/org");
    return { data: { id: created.id }, audit: { resource: { type: "team", id: created.id }, summary: created.name, after: created } };
  },
});

export async function createTeamAction(input: unknown) {
  return createTeamPipeline(input);
}

const updateTeamPipeline = createAction({
  name: "team.update",
  input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), isActive: checkbox }),
  authorize: async (user, input) => {
    const team = await findTeam(input.id);
    const department = team && (await findDepartment(team.departmentId));
    return !!department && can(user.principal, "org:manage", departmentTarget(department));
  },
  run: async ({ input }) => {
    const { id, ...details } = input;
    const { before, after } = await updateTeam(id, details);
    revalidatePath("/admin/org");
    return { data: { id }, audit: { resource: { type: "team", id }, summary: after.name, before, after } };
  },
});

export async function updateTeamAction(input: unknown) {
  return updateTeamPipeline(input);
}

export async function stageDepartmentImportAction(input: unknown) {
  return departmentImport.stage(input);
}

export async function commitDepartmentImportAction(input: unknown) {
  return departmentImport.commit(input);
}
