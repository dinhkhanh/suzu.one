"use server";
// The net → gross tool (FR-PAY-03). Compensation tier: C&B over the entity, and a recent
// re-authentication (FR-PLT-06).
//
// Nothing is stored and nothing is decided, so the audit row says who asked about which entity
// and month — never the figure asked about, and never the answer.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { quoteOffer } from "./offers";
import { canManageCompensation } from "./policy";

// Forms post "20.000.000" or "20,000,000": separators are dropped, anything else is refused.
const vnd = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? 0 : /^[\d.,\s_]+$/.test(value) ? Number(value.replace(/[.,\s_]/g, "")) : Number.NaN) : value), z.number().int().min(0).max(100_000_000_000));

const quotePipeline = createAction({
  name: "offer.net_to_gross",
  stepUp: true,
  input: z.object({
    entityId: z.uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    netSalary: vnd,
    dependents: z.coerce.number().int().min(0).max(20).default(0),
    profile: z.enum(["statutory", "simple"]).default("statutory"),
    taxResidency: z.enum(["resident", "non_resident"]).default("resident"),
    insuranceExempt: z.coerce.boolean().default(false),
    insuranceSalary: z.preprocess((value) => (value === "" || value === null || value === undefined ? null : value), z.union([vnd, z.null()])).default(null),
    allowances: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), vnd).default({}),
  }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ input }) => {
    const quote = await quoteOffer({ ...input, allowances: Object.entries(input.allowances).map(([code, amount]) => ({ code, amount })) });
    return { data: quote, audit: { resource: { type: "entity", id: input.entityId }, summary: `net→gross ${input.month}` } };
  },
});

export async function quoteOfferAction(input: unknown) {
  return quotePipeline(input);
}
