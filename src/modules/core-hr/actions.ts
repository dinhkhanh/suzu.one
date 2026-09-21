"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { normalizeEmail } from "@/modules/platform/auth/sign-in-policy";
import { unitPathOf } from "@/modules/platform/org/service";
import { findPersonById } from "@/modules/platform/people/service";
import { holdsRoleGrants } from "@/modules/platform/rbac/service";
import { ASSIGNMENT_CHANGE_KINDS, GENDERS, MARITAL_STATUSES, WORKFORCE_TYPES } from "./enums";
import { findLikelyDuplicates } from "./lifecycle";
import { canBrowsePeople, canEditPerson, canHireInto, canReassign } from "./policy";
import { changeAssignment, deleteSavedView, getPersonTarget, hirePerson, saveView, updatePersonBasics } from "./service";

// Forms post every field; a blank one means "no value".
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const id = optional(z.uuid());
const day = z.iso.date();

const identityInput = {
  fullName: z.string().trim().min(2).max(120),
  workEmail: optional(z.email().max(200)),
  profile: z.object({
    dateOfBirth: optional(day),
    gender: optional(z.enum(GENDERS)),
    maritalStatus: optional(z.enum(MARITAL_STATUSES)),
    nationality: text(60),
    phone: text(30),
    personalEmail: optional(z.email().max(200)),
    permanentAddress: text(300),
    currentAddress: text(300),
  }),
};

const placementInput = z.object({
  workforceType: z.enum(WORKFORCE_TYPES),
  branchId: id,
  orgUnitId: id,
  positionName: text(120),
  jobLevel: text(60),
  managerId: id,
  dottedManagerId: id,
  workLocation: text(200),
});

const hirePipeline = createAction({
  name: "person.hire",
  input: z.object({
    ...identityInput,
    entityId: z.uuid(),
    employeeCode: text(30),
    startDate: day,
    seniorityDate: optional(day),
    placement: placementInput,
    // Ticked after HR has looked at the likely duplicates and decided this is someone new.
    confirmDuplicate: z.preprocess((value) => value === "on" || value === true, z.boolean()).default(false),
  }),
  authorize: async (user, input) => canHireInto(user.principal, { entityId: input.entityId, unitPath: await unitPathOf(input.placement.orgUnitId) }),
  run: async ({ user, input }) => {
    if (!input.confirmDuplicate) {
      // One person, one record (FR-CHR-16): a returning employee is rehired from their old record.
      const duplicates = await findLikelyDuplicates({ fullName: input.fullName, ...input.profile });
      if (duplicates.length > 0) throw new ActionError("possible_duplicate", { duplicates });
    }
    const { person, employment, assignment } = await hirePerson(input, user.person.id);
    revalidatePath("/people");
    return {
      data: { id: person.id },
      audit: {
        resource: { type: "person", id: person.id, entityId: employment.entityId },
        summary: `${employment.employeeCode} ${person.fullName}`,
        after: { person, profile: input.profile, employment, assignment },
      },
    };
  },
});

export async function hirePersonAction(input: unknown) {
  return hirePipeline(input);
}

const updatePipeline = createAction({
  name: "person.update",
  input: z.object({ personId: z.uuid(), ...identityInput }),
  authorize: async (user, input) => {
    const [target, person] = await Promise.all([getPersonTarget(input.personId), findPersonById(input.personId)]);
    if (!target || !person) return false;
    const changesWorkEmail = (input.workEmail ? normalizeEmail(input.workEmail) : null) !== person.workEmail;
    return canEditPerson(user.principal, target, { changesWorkEmail, targetHoldsRoles: changesWorkEmail && (await holdsRoleGrants(person.id)) });
  },
  run: async ({ input }) => {
    const { personId, ...changes } = input;
    const { before, after } = await updatePersonBasics(personId, changes);
    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);
    return {
      data: { id: personId },
      audit: { resource: { type: "person", id: personId, entityId: after.person.primaryEntityId }, summary: after.person.fullName, before, after },
    };
  },
});

export async function updatePersonAction(input: unknown) {
  return updatePipeline(input);
}

const assignmentPipeline = createAction({
  name: "person.assignment.change",
  input: z.object({ personId: z.uuid(), validFrom: day, changeReason: text(300), kind: z.enum(ASSIGNMENT_CHANGE_KINDS).default("correction"), placement: placementInput }),
  authorize: async (user, input) => {
    const from = await getPersonTarget(input.personId);
    if (!from) return false;
    return canReassign(user.principal, from, { entityId: from.entityId, unitPath: await unitPathOf(input.placement.orgUnitId) });
  },
  run: async ({ user, input }) => {
    const { personId, ...change } = input;
    const { employment, before, after } = await changeAssignment(personId, change, user.person.id);
    revalidatePath("/people");
    revalidatePath(`/people/${personId}`);
    return {
      data: { id: after.id },
      audit: { resource: { type: "assignment", id: after.id, entityId: employment.entityId }, summary: `${employment.employeeCode} ${input.kind} from ${after.validFrom}`, before, after },
    };
  },
});

export async function changeAssignmentAction(input: unknown) {
  return assignmentPipeline(input);
}

// Saved views belong to whoever made them, so the only question is whether they may use the list.
const PEOPLE_FILTER_KEYS = ["q", "entityId", "departmentId", "workforceType", "status"] as const;

const saveViewPipeline = createAction({
  name: "saved_view.save",
  input: z.object({
    name: z.string().trim().min(1).max(60),
    filters: z.partialRecord(z.enum(PEOPLE_FILTER_KEYS), z.string().max(200)),
  }),
  authorize: (user) => canBrowsePeople(user.principal),
  run: async ({ user, input }) => {
    const filters = Object.fromEntries(Object.entries(input.filters).filter(([, value]) => value));
    const view = await saveView(user.person.id, { list: "people", name: input.name, filters });
    revalidatePath("/people");
    return { data: { id: view.id }, audit: { resource: { type: "saved_view", id: view.id }, summary: view.name, after: view } };
  },
});

export async function savePeopleViewAction(input: unknown) {
  return saveViewPipeline(input);
}

const deleteViewPipeline = createAction({
  name: "saved_view.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user) => canBrowsePeople(user.principal),
  run: async ({ user, input }) => {
    // Scoped to the owner in the query itself: nobody can delete someone else's view.
    const view = await deleteSavedView(user.person.id, input.id);
    revalidatePath("/people");
    return { data: { deleted: !!view }, audit: { resource: { type: "saved_view", id: input.id }, summary: view?.name, before: view } };
  },
});

export async function deletePeopleViewAction(input: unknown) {
  return deleteViewPipeline(input);
}
