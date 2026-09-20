"use server";
// Document generation through the one pipeline (parse → authenticate → authorize → run → audit).
// The audit entry names the template, the subject and the number — never a line of the document,
// because a compensation letter's text is a compensation-tier fact and the audit log is read far
// more widely than the letter.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { TIERS } from "@/modules/platform/rbac/roles";
import { DOCUMENT_KINDS } from "./enums";
import { findTemplate, generateDocument, saveTemplate } from "./service";
import { canGenerate, canManageTemplates } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

const saveTemplatePipeline = createAction({
  name: "document.template.save",
  input: z.object({
    templateId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/),
    name: z.string().trim().min(1).max(200),
    entityId: optional(z.uuid()),
    kind: z.enum(DOCUMENT_KINDS),
    tier: z.enum(TIERS),
    body: z.string().min(1).max(20_000),
    letterhead: z
      .object({
        companyName: optional(z.string().trim().max(200)),
        address: optional(z.string().trim().max(300)),
        taxCode: optional(z.string().trim().max(40)),
        phone: optional(z.string().trim().max(40)),
        representative: optional(z.string().trim().max(120)),
        representativeTitle: optional(z.string().trim().max(120)),
        place: optional(z.string().trim().max(120)),
      })
      .partial()
      .default({}),
    isActive: checkbox,
  }),
  authorize: async (user, input) => {
    if (!canManageTemplates(user.principal, input.entityId)) return false;
    if (!input.templateId) return true;
    const before = await findTemplate(input.templateId);
    return !!before && canManageTemplates(user.principal, before.entityId);
  },
  run: async ({ user, input }) => {
    const { templateId, letterhead, ...rest } = input;
    const clean = Object.fromEntries(Object.entries(letterhead).filter(([, value]) => value !== null && value !== undefined));
    const { before, after } = await saveTemplate(templateId, { ...rest, letterhead: clean }, user.person.id);
    revalidatePath("/admin/document-templates");
    return {
      data: { id: after.id, version: after.version },
      audit: { resource: { type: "document_template", id: after.id, entityId: after.entityId }, summary: `${after.code} ${after.name}`, before: before && { tier: before.tier, version: before.version }, after: { tier: after.tier, version: after.version } },
    };
  },
});

const generateDocumentPipeline = createAction({
  name: "document.generate",
  input: z.object({ templateId: z.uuid(), subjectPersonId: z.uuid() }),
  // The tier check lives here as well as in the service: a refusal is audited as `.denied` and
  // tells the caller nothing about whether the template or the person exists.
  authorize: async (user, input) => {
    const template = await findTemplate(input.templateId);
    const subject = await getPersonTarget(input.subjectPersonId);
    return !!template && template.isActive && !!subject && canGenerate(user.principal, subject, template.tier);
  },
  run: async ({ user, input }) => {
    const { document } = await generateDocument({ principal: user.principal, personId: user.person.id }, input.templateId, input.subjectPersonId);
    revalidatePath(`/people/${input.subjectPersonId}`);
    revalidatePath("/documents");
    return {
      data: { id: document.id, number: document.number },
      audit: { resource: { type: "generated_document", id: document.id, entityId: document.entityId }, summary: `${document.number} · ${document.templateCode}`, after: { tier: document.tier, subjectPersonId: document.subjectPersonId } },
    };
  },
});

// A `"use server"` file may export nothing but async functions — exporting the pipeline as a
// const makes the bundler drop every export of the module (tests/server-actions.test.ts).

export async function saveDocumentTemplateAction(input: unknown) {
  return saveTemplatePipeline(input);
}

export async function generateDocumentAction(input: unknown) {
  return generateDocumentPipeline(input);
}
