"use server";
// Export actions (FR-PLT-37): the pipeline audits who exported what — filters and row count.
import { z } from "zod";
import { createAction } from "@/lib/action";
import { buildLeaveBalancesExport } from "./exports";
import { canOpenLeaveAdmin } from "./policy";

const balancesPipeline = createAction({
  name: "leave.balances.export",
  input: z.object({ year: z.number().int().min(2000).max(2100), locale: z.enum(["vi", "en"]).default("vi") }),
  authorize: (user) => canOpenLeaveAdmin(user.principal),
  run: async ({ user, input }) => {
    const { locale, ...filters } = input;
    const { file, total } = await buildLeaveBalancesExport(user.principal, filters.year, locale);
    return { data: file, audit: { resource: { type: "export:leave-balances", entityId: null }, summary: `${file.rowCount} of ${total} rows`, after: { filters, rowCount: file.rowCount, total } } };
  },
});

export async function exportLeaveBalancesAction(input: unknown) {
  return balancesPipeline(input);
}
