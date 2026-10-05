"use server";
// Export actions (FR-PLT-37): the pipeline audits who exported what — filters and row count.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { buildCandidatesExport } from "./exports";
import { canBrowseCandidates } from "./policy";

const candidatesPipeline = createAction({
  name: "recruit.candidates.export",
  input: z.object({ query: z.string().trim().max(200).optional(), talentPool: z.boolean().optional(), locale: z.enum(["vi", "en"]).default("vi") }),
  authorize: (user) => canBrowseCandidates(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, total } = await buildCandidatesExport(user.principal, { query: filters.query || undefined, talentPool: filters.talentPool }, locale);
    return { data: file, audit: { resource: { type: "export:candidates", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportCandidatesAction(input: unknown) {
  return candidatesPipeline(input);
}
