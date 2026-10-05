"use server";
// Export actions for the CRM's lists (FR-PLT-37): the pipeline audits who exported what.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { ACCOUNT_TIERS, LIFECYCLES, SERVICE_LINES } from "./enums";
import { buildAccountsExport, buildDealsExport } from "./exports";
import { crmShell } from "./pages";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToUndefined, schema.optional());
const locale = z.enum(["vi", "en"]).default("vi");

const accountsPipeline = createAction({
  name: "crm.accounts.export",
  input: z.object({ q: optional(z.string().max(200)), lifecycle: optional(z.enum([...LIFECYCLES, "all"])), tier: optional(z.enum([...ACCOUNT_TIERS, "all"])), mine: z.boolean().default(false), locale }),
  // The accounts page's own gate: the CRM must open for this viewer.
  authorize: async (user) => (await crmShell(user)).opens,
  run: async ({ user, input }) => {
    const { locale: lang, ...filters } = input;
    const { viewer } = await crmShell(user);
    const { file, total } = await buildAccountsExport(viewer, filters, lang);
    return { data: file, audit: { resource: { type: "export:crm-accounts", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportAccountsAction(input: unknown) {
  return accountsPipeline(input);
}

const dealsPipeline = createAction({
  name: "crm.deals.export",
  input: z.object({
    q: optional(z.string().max(200)),
    teamId: optional(z.uuid()),
    serviceLine: optional(z.enum(SERVICE_LINES)),
    status: z.enum(["open", "won", "lost", "all"]).default("open"),
    mine: z.boolean().default(false),
    locale,
  }),
  // The deals page's own gate: the pipeline tab must be open for this viewer.
  authorize: async (user) => (await crmShell(user)).show.deals,
  run: async ({ user, input }) => {
    const { locale: lang, ...filters } = input;
    const { viewer } = await crmShell(user);
    const { file, total } = await buildDealsExport(viewer, filters, lang);
    return { data: file, audit: { resource: { type: "export:crm-deals", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportDealsAction(input: unknown) {
  return dealsPipeline(input);
}
