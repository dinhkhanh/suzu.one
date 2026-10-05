"use server";
// Export action for the asset register (FR-PLT-37): the pipeline audits who exported what.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { ASSET_STATUSES } from "./enums";
import { buildAssetsExport } from "./exports";
import { canReadRegister } from "./policy";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());

const assetsPipeline = createAction({
  name: "assets.export",
  input: z.object({
    entityId: optional(z.uuid()),
    categoryId: optional(z.uuid()),
    status: optional(z.enum(ASSET_STATUSES)),
    search: optional(z.string().max(200)),
    locale: z.enum(["vi", "en"]).default("vi"),
  }),
  // The register's own gate: whoever has no register has no export of it.
  authorize: (user) => canReadRegister(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filter } = input;
    const { file, total } = await buildAssetsExport(user.principal, filter, locale);
    return { data: file, audit: { resource: { type: "export:assets", entityId: filter.entityId ?? null }, summary: `${file.rowCount} of ${total} rows`, after: { filters: filter, rowCount: file.rowCount, total } } };
  },
});

export async function exportAssetsAction(input: unknown) {
  return assetsPipeline(input);
}
