// The report catalogue (FR-AGT-18): any report of `/reports` for a period, through the one door
// that renders a report — `buildReportFor`, which asks the report's own `canSee` and builds it with
// the asker's principal. A report the catalogue marks `stepUp` (payroll cost, profitability) needs
// the same fresh step-up its export asks for, checked before anything is read. The model reads the
// report's one-line summary and its first rows; the asker gets the link to the full report.
import "server-only";
import { z } from "zod";
import { buildReportFor, needsStepUp, REPORT_KEYS } from "@/modules/reports/service";
import type { ReportViewer } from "@/modules/reports/service";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelText } from "../../engine/views";
import { type AnyAgentTool, defineTool } from "../registry";
import { PERIOD_INPUT, periodOf } from "./period";

const CAP = TURN_CEILINGS.rowsPerTool;

/** Where each report lives, as `/reports` links it; parameters are left to the screen. */
const SCREENS: Record<string, string> = {
  headcount: "/reports/headcount",
  payroll_cost: "/payroll/reports",
  work_analytics: "/work/analytics",
  ops_overdue: "/ops",
  recruit_funnel: "/recruit/reports",
  delivery: "/reports/delivery",
  profitability: "/reports/profitability",
  crm_pipeline: "/crm/reports",
  crm_receivables: "/crm/invoices?status=overdue",
};

// The catalogue's keys are read when a request is built, not when this file loads: the knowledge
// base imports the assistant's service for its redaction, so this file can be loaded while the
// reports module that holds the catalogue is still loading.
let inputSchema: z.ZodType<{ report: string; from?: string; to?: string }> | null = null;
const reportInput = () => (inputSchema ??= z.strictObject({ report: z.enum(REPORT_KEYS as [string, ...string[]]), ...PERIOD_INPUT }));

const runReport = defineTool({
  name: "run_report",
  module: "reports",
  get description() {
    return `Builds one report of the company's report catalogue for a period, as the asker may read it, and returns its summary and first rows with a link to the full report and its export. Reports: ${REPORT_KEYS.join(", ")}. Prefer the specific tools (headcount, recruitment, payroll_cost, profitability, receivables, sales_pipeline) for questions; use this one when the asker names a report or wants it to open or export. payroll_cost and profitability need a recent identity confirmation (step-up). Default period: this month.`;
  },
  get input() {
    return reportInput();
  },
  // The catalogue's `canSee` is the gate, asked on every call. Offered to the people who read
  // reports — a role, a lead, a manager, an account — so every other request stays shorter; an
  // employee's own work is in my_tasks and my_time.
  offeredTo: (principal, facts) => principal.grants.length > 0 || facts.leadsWork || facts.managesPeople || facts.worksAccounts,
  tier: "compensation",
  stepUp: (input) => needsStepUp(input.report),
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today, locale }, input) => {
    const period = periodOf(input, today, "month");
    const table = await buildReportFor(user as unknown as ReportViewer, input.report, {}, period, locale);
    const link = SCREENS[input.report] ?? "/reports";
    if (!table) return { outcome: "refused", model: { link: "/reports", report: input.report }, card: null, subject: null };
    const rows = table.rows.slice(0, CAP).map((row) => Object.fromEntries(table.columns.map((column, index) => [column, typeof row[index] === "number" ? row[index] : modelText(String(row[index] ?? ""))])));
    return {
      outcome: table.rows.length ? "answered" : "empty",
      model: { link, report: input.report, title: table.title, period, summary: table.summary, rows, total: table.rows.length, more: Math.max(0, table.rows.length - rows.length) },
      card: { tool: "run_report", href: link, items: [{ label: table.title, href: link, meta: { key: "period", params: { from: period.from, to: period.to } } }], more: 0 },
      subject: { type: "report", id: input.report },
      compensation: needsStepUp(input.report),
    };
  },
});

export const REPORT_TOOLS: readonly AnyAgentTool[] = [runReport];
