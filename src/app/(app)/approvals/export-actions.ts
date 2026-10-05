"use server";
// The "All requests" export (FR-PLT-37). It lives at the composition root, beside the bulk
// approve, because the names of the request builder's types come from the registry, which a
// module may not import. Authorised as the page is: `approval:oversee`, over the same entity reach.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { buildAllRequestsExport } from "@/modules/platform/approvals/exports";
import { canOverseeRequests } from "@/modules/platform/approvals/policy";
import { entityReach } from "@/modules/platform/rbac/policy";
import { allRequestTypes } from "./registry";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());

const allRequestsPipeline = createAction({
  name: "approval.all.export",
  input: z.object({
    state: optional(z.enum(["open", "decided"])),
    type: optional(z.string().max(120)),
    since: optional(z.iso.date()),
    locale: z.enum(["vi", "en"]).default("vi"),
  }),
  authorize: (user) => canOverseeRequests(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const registered = await allRequestTypes();
    // The page only filters by a type that exists; an unknown one is dropped, as there.
    const type = filters.type && registered.has(filters.type) ? filters.type : undefined;
    const labels = new Map<string, string>();
    for (const [key, entry] of registered) if (entry.names) labels.set(key, locale === "en" ? entry.names.en : entry.names.vi);
    const { file, total } = await buildAllRequestsExport(entityReach(user.principal, "approval:oversee"), { ...filters, type }, labels, locale);
    return { data: file, audit: { resource: { type: "export:requests", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters: { ...filters, type }, rowCount: file.rowCount, total } } };
  },
});

export async function exportAllRequestsAction(input: unknown) {
  return allRequestsPipeline(input);
}
