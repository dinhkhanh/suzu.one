"use server";
// The audit-log export (FR-PLT-37). Authorised as the page is: `audit:read` over some entity, and
// the file is cut to that reach. The export is itself an audit entry.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { entityReach } from "@/modules/platform/rbac/policy";
import { buildAuditExport } from "./exports";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());

const auditPipeline = createAction({
  name: "audit.export",
  input: z.object({
    action: optional(z.string().max(80)),
    actor: optional(z.string().max(120)),
    resourceType: optional(z.string().max(60)),
    resourceId: optional(z.string().max(80)),
    entityId: optional(z.uuid()),
    from: optional(z.iso.date()),
    to: optional(z.iso.date()),
    locale: z.enum(["vi", "en"]).default("vi"),
  }),
  authorize: (user) => {
    const reach = entityReach(user.principal, "audit:read");
    return reach.all || reach.entityIds.length > 0;
  },
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, total } = await buildAuditExport(entityReach(user.principal, "audit:read"), filters, locale);
    return { data: file, audit: { resource: { type: "export:audit", entityId: filters.entityId ?? null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportAuditAction(input: unknown) {
  return auditPipeline(input);
}
