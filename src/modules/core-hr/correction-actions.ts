"use server";
// Corrections (CHR-02) through the one pipeline: an employment's dates and code, a position's
// name, a person created in error. Each audit entry carries what was there before.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { correctEmployment, findEmployment, removePersonCreatedInError, renamePosition } from "./corrections";
import { canManagePositions, canRemovePerson } from "./policy";
import { getPersonTarget } from "./service";
import { can } from "@/modules/platform/rbac/policy";

const day = z.iso.date();

const correctEmploymentPipeline = createAction({
  name: "employment.correct",
  input: z.object({ employmentId: z.uuid(), employeeCode: z.string().trim().min(1).max(30), startDate: day, seniorityDate: day }),
  // HR over the person — and over the entity the period was with, which after a move may be another.
  authorize: async (user, input) => {
    const employment = await findEmployment(input.employmentId);
    const target = employment ? await getPersonTarget(employment.personId) : null;
    return !!employment && !!target && can(user.principal, "person:manage", target) && can(user.principal, "person:manage", { entityId: employment.entityId });
  },
  run: async ({ input }) => {
    const { employmentId, ...correction } = input;
    const { before, after, activated } = await correctEmployment(employmentId, correction);
    revalidatePath(`/people/${after.personId}`);
    revalidatePath("/people");
    return {
      data: { id: after.id, activated },
      audit: {
        resource: { type: "person", id: after.personId, entityId: after.entityId },
        summary: `employment corrected: ${before.employeeCode} ${before.startDate} → ${after.employeeCode} ${after.startDate}`,
        before: { employeeCode: before.employeeCode, startDate: before.startDate, seniorityDate: before.seniorityDate },
        after: { employeeCode: after.employeeCode, startDate: after.startDate, seniorityDate: after.seniorityDate, activated },
      },
    };
  },
});

export async function correctEmploymentAction(input: unknown) {
  return correctEmploymentPipeline(input);
}

const renamePositionPipeline = createAction({
  name: "position.rename",
  input: z.object({ positionId: z.uuid(), name: z.string().trim().min(1).max(120) }),
  authorize: (user) => canManagePositions(user.principal),
  run: async ({ input }) => {
    const { before, after } = await renamePosition(input.positionId, input.name);
    revalidatePath("/people/positions");
    revalidatePath("/people");
    return { data: after, audit: { resource: { type: "position", id: after.id, entityId: null }, summary: `${before.name} → ${after.name}`, before, after } };
  },
});

export async function renamePositionAction(input: unknown) {
  return renamePositionPipeline(input);
}

const removePersonPipeline = createAction({
  name: "person.remove",
  // The name is typed back: removing a record is not a click that can be made by accident.
  input: z.object({ personId: z.uuid(), confirmName: z.string().trim().min(1).max(200) }),
  authorize: async (user, input) => canRemovePerson(user.principal, await getPersonTarget(input.personId)),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(input.personId);
    const removed = await removePersonCreatedInError(input.personId, user.person.id, input.confirmName);
    revalidatePath("/people");
    return {
      data: { id: removed.id },
      audit: {
        resource: { type: "person", id: removed.id, entityId: target?.entityId ?? null },
        summary: `removed as created in error: ${removed.fullName}`,
        before: { fullName: removed.fullName, workEmail: removed.workEmail, status: removed.status },
      },
    };
  },
});

export async function removePersonAction(input: unknown) {
  return removePersonPipeline(input);
}
