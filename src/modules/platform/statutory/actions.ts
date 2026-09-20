"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "../rbac/policy";
import { decideParameter, proposeParameter, verifyParameter } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().default(null));

// The form posts the value as JSON text; its shape is checked against the catalogue by the service.
const jsonText = z
  .string()
  .max(5000)
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "not_json" });
      return z.NEVER;
    }
  });

const proposePipeline = createAction({
  name: "statutory_parameter.propose",
  input: z.object({ key: z.string().max(80), value: jsonText, validFrom: z.iso.date(), legalReference: text(300), note: text(500) }),
  authorize: (user) => can(user.principal, "rules:propose", {}),
  run: async ({ user, input }) => {
    const created = await proposeParameter(input, user.person.id);
    revalidatePath("/admin/rules");
    return { data: { id: created.id }, audit: { resource: { type: "statutory_parameter", id: created.id }, summary: `${created.key} from ${created.validFrom}`, after: created } };
  },
});

export async function proposeParameterAction(input: unknown) {
  return proposePipeline(input);
}

const decidePipeline = createAction({
  name: "statutory_parameter.decide",
  input: z.object({ id: z.uuid(), decision: z.enum(["approve", "reject", "verify"]) }),
  // Only the owner decides the rules (SRS D17).
  authorize: (user) => can(user.principal, "payroll:rules", {}),
  run: async ({ user, input }) => {
    const { before, after } = input.decision === "verify" ? await verifyParameter(input.id, user.person.id) : await decideParameter(input.id, input.decision, user.person.id);
    revalidatePath("/admin/rules");
    return { data: { id: after.id }, audit: { resource: { type: "statutory_parameter", id: after.id }, summary: `${input.decision} ${after.key} from ${after.validFrom}`, before, after } };
  },
});

export async function decideParameterAction(input: unknown) {
  return decidePipeline(input);
}
