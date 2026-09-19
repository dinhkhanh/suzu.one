"use server";
// Only what is the same for every request type lives here. Deciding a request has an effect that
// belongs to the module owning the type, so each module has its own decide action.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { canWithdraw } from "./policy";
import { withdrawRequest } from "./service";

const withdrawPipeline = createAction({
  name: "approval.withdraw",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => {
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, input.requestId)).limit(1);
    return !!request && canWithdraw(request, user.person.id);
  },
  run: async ({ user, input }) => {
    const { request, before } = await db().transaction((tx) => withdrawRequest(tx, input.requestId, user.person.id));
    revalidatePath("/approvals");
    if (request.link) revalidatePath(request.link);
    return {
      data: { id: request.id },
      audit: { resource: { type: `approval:${request.type}`, id: request.id, entityId: request.entityId }, summary: request.summary, before: { status: before.status }, after: { status: request.status } },
    };
  },
});

export async function withdrawApprovalAction(input: unknown) {
  return withdrawPipeline(input);
}
