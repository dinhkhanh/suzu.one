"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "../rbac/policy";
import { setRollout } from "./service";

const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const ids = z.array(z.uuid()).max(500).default([]);

// Who sees a module is a group-wide decision, like the org structure itself.
const rolloutPipeline = createAction({
  name: "feature_flag.set",
  input: z.object({ key: z.string().max(60), enabledForAll: checkbox, entityIds: ids, departmentIds: ids, personIds: ids }),
  authorize: (user) => can(user.principal, "org:manage", {}),
  run: async ({ user, input }) => {
    const { key, ...rollout } = input;
    const { before, after } = await setRollout(key, rollout, user.person.id);
    revalidatePath("/", "layout");
    return { data: { key }, audit: { resource: { type: "feature_flag", id: key }, summary: key, before, after } };
  },
});

export async function setRolloutAction(input: unknown) {
  return rolloutPipeline(input);
}
