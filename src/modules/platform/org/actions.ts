"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "../rbac/policy";
import { createEntity } from "./service";

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
