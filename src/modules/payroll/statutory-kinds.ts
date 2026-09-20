// Which statutory filings this module can build (FR-PAY-35). A plain module, not part of the
// `"use server"` action file: a server-action file may only export async functions, so the list
// the form and the action share lives here.
export const STATUTORY_EXPORTS = ["d02lt", "pit_monthly", "pit_monthly_detail", "pit_finalization", "pit_finalization_appendix1", "pit_finalization_appendix2", "dependants"] as const;
export type StatutoryExportKey = (typeof STATUTORY_EXPORTS)[number];
