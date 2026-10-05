"use server";
// The issued-documents export (FR-PLT-37): authorised as the register is (`canReadTemplates`),
// each paper re-checked against its subject and tier by the register's own query.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { canReadTemplates } from "./policy";
import { DOCUMENT_KINDS } from "./enums";
import { buildIssuedDocumentsExport } from "./exports";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());

const registerPipeline = createAction({
  name: "documents.register.export",
  input: z.object({
    // The register leaves offer letters out (recruitment renders them about a candidate).
    kind: optional(z.enum(DOCUMENT_KINDS.filter((kind) => kind !== "offer") as ["contract", "decision", "confirmation_letter", "other"])),
    year: optional(z.number().int().min(2000).max(2100)),
    locale: z.enum(["vi", "en"]).default("vi"),
  }),
  authorize: (user) => canReadTemplates(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, total } = await buildIssuedDocumentsExport(user.principal, filters, locale);
    return { data: file, audit: { resource: { type: "export:documents", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportIssuedDocumentsAction(input: unknown) {
  return registerPipeline(input);
}
