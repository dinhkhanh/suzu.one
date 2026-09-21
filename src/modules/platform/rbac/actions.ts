"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "./policy";
import { ROLES } from "./roles";
import { grantRole, revokeRole } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));

// Granting access is a group-wide power, whatever the scope of the grant being given.
const grantPipeline = createAction({
  name: "role.grant",
  input: z.object({
    personId: z.uuid(),
    role: z.enum(ROLES),
    scopeType: z.enum(["group", "entity", "unit"]),
    scopeId: optional(z.uuid()),
    validFrom: z.iso.date(),
    validTo: optional(z.iso.date()),
  }),
  authorize: (user) => can(user.principal, "rbac:manage", {}),
  run: async ({ user, input }) => {
    const created = await grantRole(input, user.person.id);
    revalidatePath("/admin/roles");
    return {
      data: { id: created.id },
      audit: { resource: { type: "role_assignment", id: created.id, entityId: created.scopeType === "entity" ? created.scopeId : null }, summary: `${created.role} → ${created.personId}`, after: created },
    };
  },
});

export async function grantRoleAction(input: unknown) {
  return grantPipeline(input);
}

const revokePipeline = createAction({
  name: "role.revoke",
  input: z.object({ id: z.uuid() }),
  authorize: (user) => can(user.principal, "rbac:manage", {}),
  run: async ({ user, input }) => {
    const { before, after } = await revokeRole(input.id, user.person.id);
    revalidatePath("/admin/roles");
    return {
      data: { id: after.id },
      audit: { resource: { type: "role_assignment", id: after.id, entityId: after.scopeType === "entity" ? after.scopeId : null }, summary: `${after.role} ✕ ${after.personId}`, before, after },
    };
  },
});

export async function revokeRoleAction(input: unknown) {
  return revokePipeline(input);
}
