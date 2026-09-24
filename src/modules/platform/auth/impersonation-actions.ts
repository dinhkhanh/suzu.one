"use server";
// Seeing the app as somebody else (FR-PLT-40). Both actions are audited under the real account, like
// everything the borrowed session goes on to do; the start names who is being seen as.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canImpersonate } from "../rbac/policy";
import { impersonationTargetOf, startImpersonation, stopImpersonation } from "./impersonation";

const startPipeline = createAction({
  name: "auth.impersonate.start",
  input: z.object({ personId: z.uuid() }),
  // Never from inside a borrowed session: the chain would end with nobody knowing who is who.
  authorize: async (user, input) => {
    if (user.impersonator) return false;
    const found = await impersonationTargetOf(input.personId);
    return !!found && canImpersonate(user.principal, found.target);
  },
  run: async ({ user, input }) => {
    // Authorized a moment ago; `getCurrentUser` checks again on every request from here on.
    const found = await impersonationTargetOf(input.personId);
    if (!found) return { data: { ok: false }, audit: { resource: { type: "person", id: input.personId }, summary: "target gone" } };
    await startImpersonation(user.sessionId, found.person.id);
    revalidatePath("/", "layout");
    return { data: { ok: true }, audit: { resource: { type: "person", id: found.person.id, entityId: found.person.primaryEntityId }, summary: found.person.fullName } };
  },
});

export async function startImpersonationAction(input: unknown) {
  return startPipeline(input);
}

const stopPipeline = createAction({
  name: "auth.impersonate.stop",
  input: z.object({}),
  authorize: (user) => user.impersonator !== null,
  run: async ({ user }) => {
    await stopImpersonation(user.sessionId);
    revalidatePath("/", "layout");
    return { data: { ok: true }, audit: { resource: { type: "person", id: user.person.id, entityId: user.person.primaryEntityId }, summary: user.person.fullName } };
  },
});

export async function stopImpersonationAction(input: unknown) {
  return stopPipeline(input);
}
