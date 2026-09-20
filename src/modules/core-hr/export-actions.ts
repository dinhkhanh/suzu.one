"use server";
// Export actions (FR-PLT-37): the pipeline audits who exported what — filters and row count.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { can } from "@/modules/platform/rbac/policy";
import { PERSON_STATUSES, WORKFORCE_TYPES } from "./enums";
import { buildHeadcountExport, buildPeopleExport } from "./exports";
import { canBrowsePeople } from "./policy";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());
const day = z.iso.date();

const peoplePipeline = createAction({
  name: "people.export",
  input: z.object({
    q: optional(z.string().max(200)),
    entityId: optional(z.uuid()),
    departmentId: optional(z.uuid()),
    workforceType: optional(z.enum(WORKFORCE_TYPES)),
    status: optional(z.enum([...PERSON_STATUSES, "all"])),
    locale: z.enum(["vi", "en"]).default("vi"),
  }),
  authorize: (user) => canBrowsePeople(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, total } = await buildPeopleExport(user.principal, filters, locale);
    return { data: file, audit: { resource: { type: "export:people", entityId: filters.entityId ?? null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportPeopleAction(input: unknown) {
  return peoplePipeline(input);
}

const headcountPipeline = createAction({
  name: "report.headcount.export",
  input: z.object({ asOf: day, from: day, to: day, entityId: optional(z.uuid()), locale: z.enum(["vi", "en"]).default("vi") }),
  authorize: (user) => can(user.principal, "report:read"),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, scoped } = await buildHeadcountExport(user.principal, filters, locale);
    return { data: file, audit: { resource: { type: "export:headcount", entityId: filters.entityId ?? null }, summary: `${file.rowCount} rows${scoped ? " (scoped)" : ""}`, after: { filters, rowCount: file.rowCount, scoped } } };
  },
});

export async function exportHeadcountAction(input: unknown) {
  return headcountPipeline(input);
}
