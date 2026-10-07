// Money and company health (FR-AGT-16) and the salary estimate (FR-AGT-17). Each tool is one door of
// the module that owns the figures, read with the asker's principal:
//
//   payroll_cost      payroll `costTrend` + `costReport` (`payroll:read` reach) — step-up
//   profitability     reports `buildProfitability` (`pjm:cost`, per project `pjm:commercial`) — step-up
//   receivables       crm `agingSummary` + `listInvoices` (`canOpenReceivables`, `invoiceReach`)
//   sales_pipeline    crm `salesDashboard` + `forecast` (`canOpenPipeline`, `dealValueReach`)
//   company_health    reports `getDashboard` — the tiles the asker's dashboard shows; the payroll
//                     tile only on a fresh step-up, as the dashboard locks it
//   salary_estimate   payroll `estimateNet` / `quoteOffer` (`canManageCompensation` over the entity)
//                     and `estimateFromSalaryFile` (`getSalaryFile`'s own gate) — step-up
//
// Pay (D36): the figures reach the model only after the page's step-up, for an asker the payroll
// module opens them to; a turn that read them is shown once and not stored. The cards under the
// answer name the screen and never carry a figure, because cards are stored.
import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { recordHref } from "@/lib/record-routes";
import { agingSummary, AGING_BUCKETS, canOpenPipeline, canOpenReceivables, forecast, listInvoices, loadCrm, managesAnAccount, ownsAnyDeal, salesDashboard } from "@/modules/crm/service";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { canManageCompensation, compensationReach, costReport, costTrend, estimateFromSalaryFile, estimateNet, listEntityOptions, type OfferQuote, payrollReadReach, quoteOffer } from "@/modules/payroll/service";
import { buildProfitability, canReadProfitability, type DashboardViewer, getDashboard } from "@/modules/reports/service";
import { toSearchKey } from "@/lib/text";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows } from "../../engine/views";
import { type AgentUser, type AnyAgentTool, defineTool, type ToolResult } from "../registry";
import { peopleNamed } from "./lookup";
import { PERIOD_INPUT, periodOf } from "./period";

const CAP = TURN_CEILINGS.rowsPerTool;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const reaches = (reach: { all: boolean; entityIds?: readonly string[] }) => reach.all || (reach.entityIds?.length ?? 0) > 0;
/** The screens these modules read for a person; the agent's user holds the fields they use. */
const asViewer = (user: AgentUser) => user as unknown as DashboardViewer;
const screen = (tool: string, href: string, key: string): ToolResult["card"] => ({ tool, href, items: [{ label: "", title: { key, params: {} }, href, meta: null }], more: 0 });
const monthsBack = (month: string, count: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
};

// ── Payroll cost ────────────────────────────────────────────────────────────────────────────

const payrollCost = defineTool({
  name: "payroll_cost",
  module: "payroll",
  description:
    "Payroll cost of the entities whose payroll the asker reads: month by month (headcount paid, gross, net, employer cost), and for one month the split by entity and by department (headcount, gross, employer insurance, union fund, employer cost). Totals only — nobody is named. Default: the last six months, split for the latest. Needs a recent identity confirmation (step-up).",
  input: z.strictObject({
    fromMonth: MONTH.optional().describe("YYYY-MM. Default: five months before toMonth."),
    toMonth: MONTH.optional().describe("YYYY-MM. Default: this month."),
    splitMonth: MONTH.optional().describe("The month to split by entity and department. Default: the latest month with a run."),
  }),
  offeredTo: (principal) => reaches(payrollReadReach(principal)),
  tier: "compensation",
  stepUp: true,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const toMonth = input.toMonth ?? today.slice(0, 7);
    const fromMonth = input.fromMonth ?? monthsBack(toMonth, 5);
    const points = await costTrend(user.principal, { fromMonth: fromMonth <= toMonth ? fromMonth : toMonth, toMonth: fromMonth <= toMonth ? toMonth : fromMonth });
    const splitMonth = input.splitMonth ?? points.at(-1)?.month ?? null;
    if (points.length === 0 && !input.splitMonth) return { outcome: "empty", model: { link: "/payroll/reports", fromMonth, toMonth, months: [] }, card: null, subject: null };
    const split = splitMonth ? await costReport(user.principal, { month: splitMonth }) : null;
    const costRow = { label: "text", headcount: "value", gross: "value", employerInsurance: "value", unionFund: "value", employerCost: "value" } as const;
    return {
      outcome: "answered",
      model: {
        link: "/payroll/reports",
        currency: "VND",
        months: points.map((point) => ({ month: point.month, headcount: point.headcount, grossVnd: point.gross, netVnd: point.net, employerCostVnd: point.employerCost })),
        ...(split && split.byEntity.length ? { split: { month: splitMonth, byEntity: modelRows(split.byEntity, costRow, CAP), byDepartment: modelRows(split.byDepartment, costRow, CAP), total: { headcount: split.total.headcount, grossVnd: split.total.gross, employerCostVnd: split.total.employerCost } } } : {}),
      },
      card: screen("payroll_cost", "/payroll/reports", "payrollReports"),
      subject: null,
    };
  },
});

// ── Profitability ───────────────────────────────────────────────────────────────────────────

const profitability = defineTool({
  name: "profitability",
  module: "reports",
  description:
    "Project and client profitability over a period, from logged hours costed at loaded salary rates: per project and per client the hours, fee, cost, margin and margin rate, worst margin first, and the total. Private projects the asker may not open are one unnamed line. Default period: this year so far. Needs a recent identity confirmation (step-up).",
  input: z.strictObject({ ...PERIOD_INPUT }),
  offeredTo: canReadProfitability,
  tier: "compensation",
  stepUp: true,
  kind: "read",
  rowCap: CAP,
  tags: ["complex"],
  run: async ({ user, today }, input) => {
    const period = periodOf(input, today, "year");
    const view = await buildProfitability(user, period);
    if (!view) return { outcome: "refused", model: { link: "/reports" }, card: null, subject: null };
    if (view.projects.length === 0 && !view.privateProjects) return { outcome: "empty", model: { link: "/reports/profitability", period, projects: [] }, card: null, subject: null };
    const rate = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);
    const projects = view.projects.map((row) => ({ project: [row.jobNumber, row.name].filter(Boolean).join(" · "), client: row.clientName, team: row.teamName, basis: row.basis, hours: row.hours, feeVnd: row.feeVnd, costVnd: row.costVnd, marginVnd: row.marginVnd, marginPercent: rate(row.marginRate), estimated: row.estimated, link: recordHref("project", row.id) }));
    const clients = view.clients.map((row) => ({ client: row.clientName ?? "—", projects: row.projects, hours: row.hours, feeVnd: row.feeVnd, costVnd: row.costVnd, marginVnd: row.marginVnd, marginPercent: rate(row.marginRate) }));
    return {
      outcome: "answered",
      model: {
        link: "/reports/profitability",
        period,
        note: "feeVnd null = no fee recorded for the period (margin unknown). estimated = some hours had no rate and were costed at an estimate.",
        total: { hours: view.total.hours, feeVnd: view.total.feeVnd, costVnd: view.total.costVnd, marginVnd: view.total.marginVnd, marginPercent: rate(view.total.marginRate), estimated: view.total.estimated },
        projects: modelRows(projects, { project: "text", client: "text", team: "text", basis: "value", hours: "value", feeVnd: "value", costVnd: "value", marginVnd: "value", marginPercent: "value", estimated: "value", link: "value" }, CAP),
        clients: modelRows(clients, { client: "text", projects: "value", hours: "value", feeVnd: "value", costVnd: "value", marginVnd: "value", marginPercent: "value" }, CAP),
        ...(view.privateProjects ? { privateProjects: { projects: view.privateProjects.projects, hours: view.privateProjects.hours, feeVnd: view.privateProjects.feeVnd, costVnd: view.privateProjects.costVnd, marginVnd: view.privateProjects.marginVnd } } : {}),
      },
      card: screen("profitability", `/reports/profitability?from=${period.from}&to=${period.to}`, "profitabilityReport"),
      subject: null,
    };
  },
});

// ── Receivables and the pipeline (the CRM's own reach) ──────────────────────────────────────

const receivables = defineTool({
  name: "receivables",
  module: "crm",
  description: "Money clients owe, as far as the asker's CRM reach goes: outstanding by ageing bucket (current, 1–30, 31–60, 61–90, over 90 days late) and the overdue invoices with client, number, due date, days late and amount outstanding, latest first.",
  input: z.strictObject({}),
  offeredTo: (principal, facts) => can(principal, "pjm:commercial") || can(principal, "crm:manage") || facts.worksAccounts,
  tier: "restricted",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }) => {
    const { viewer } = await loadCrm(user);
    if (!canOpenReceivables(viewer, managesAnAccount(viewer))) return { outcome: "refused", model: { link: "/crm" }, card: null, subject: null };
    const [aging, overdue] = await Promise.all([agingSummary(viewer, {}, today), listInvoices(viewer, { status: "overdue" }, today, CAP + 1)]);
    const shaped = overdue.map((invoice) => ({ client: invoice.accountName, number: invoice.number, dueOn: invoice.dueOn, daysLate: invoice.daysPastDue, outstandingVnd: invoice.outstandingVnd, link: recordHref("invoice", invoice.id) }));
    return {
      outcome: aging.invoices === 0 ? "empty" : "answered",
      model: {
        link: "/crm/invoices?status=overdue",
        currency: "VND",
        outstanding: { ...Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, aging[bucket]])), total: aging.total, openInvoices: aging.invoices },
        overdueInvoices: modelRows(shaped, { client: "text", number: "value", dueOn: "value", daysLate: "value", outstandingVnd: "value", link: "value" }, CAP),
      },
      card: shaped.length ? { tool: "receivables", href: "/crm/invoices?status=overdue", items: shaped.slice(0, 8).map((row) => ({ label: `${row.number} · ${row.client}`, href: row.link, meta: { key: "daysLate", params: { days: row.daysLate } } })), more: Math.max(0, shaped.length - 8) } : null,
      subject: null,
    };
  },
});

const salesPipeline = defineTool({
  name: "sales_pipeline",
  module: "crm",
  description:
    "The sales pipeline over the deals whose value the asker may see: open deals by stage (count, value, weighted value), by expected close month, won and lost in each of the last six months, win rate, average won deal, average cycle in days, top lost reasons, and deals gone stale.",
  input: z.strictObject({}),
  offeredTo: (principal, facts) => can(principal, "crm:sell") || can(principal, "crm:manage") || facts.worksAccounts,
  tier: "restricted",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today, locale }) => {
    const { viewer } = await loadCrm(user);
    if (!canOpenPipeline(viewer, await ownsAnyDeal(user.person.id))) return { outcome: "refused", model: { link: "/crm" }, card: null, subject: null };
    const [dashboard, months] = await Promise.all([salesDashboard(viewer, {}, today), forecast(viewer, {}, today)]);
    if (!dashboard) return { outcome: "refused", model: { link: "/crm" }, card: null, subject: null };
    return {
      outcome: "answered",
      model: {
        link: "/crm/reports",
        currency: "VND",
        openDeals: dashboard.openCount,
        staleDeals: dashboard.staleCount,
        winRatePercent: dashboard.winRate === null ? null : Math.round(dashboard.winRate * 1000) / 10,
        averageWonVnd: dashboard.averageWon,
        averageCycleDays: dashboard.averageCycleDays,
        byStage: dashboard.byStage.map((stage) => ({ stage: locale === "en" ? (stage.nameEn ?? stage.name) : stage.name, deals: stage.count, valueVnd: stage.value, weightedVnd: stage.weighted })),
        byCloseMonth: months.map((month) => ({ month: month.month === "none" ? "no date or past" : month.month, deals: month.count, valueVnd: month.value, weightedVnd: month.weighted })),
        outcomesByMonth: dashboard.byMonth.map((month) => ({ month: month.month, won: month.wonCount, wonVnd: month.wonValue, lost: month.lostCount })),
        lostReasons: dashboard.lostReasons.slice(0, 5),
      },
      card: { tool: "sales_pipeline", href: "/crm/reports", items: [{ label: "", title: { key: "openDeals", params: { count: dashboard.openCount } }, href: "/crm/deals", meta: dashboard.staleCount ? { key: "stale", params: { count: dashboard.staleCount } } : null }], more: 0 },
      subject: null,
    };
  },
});

// ── Company health: the asker's own dashboard ───────────────────────────────────────────────

const companyHealth = defineTool({
  name: "company_health",
  module: "reports",
  description:
    "The asker's dashboard, tile by tile, each from its own module and only the tiles the asker's dashboard shows: headcount and movement this month, payroll cost (only after a recent identity confirmation), attendance and leave today, recruitment, overdue obligations, work at risk, project health, sales and receivables, approvals waiting. Use it for 'how is the company doing' and 'tình hình công ty'.",
  input: z.strictObject({}),
  offeredTo: (principal, facts) => principal.grants.length > 0 || facts.leadsWork || facts.managesPeople || facts.worksAccounts,
  tier: "compensation",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: ["complex"],
  run: async ({ user, today }) => {
    const dashboard = await getDashboard(asViewer(user), today);
    // The dashboard's own lock on its payroll tile: figures only on a fresh step-up.
    const payFresh = isStepUpFresh(user.reauthAt ?? null);
    const payroll = dashboard.payroll ? (payFresh ? { latest: dashboard.payroll.latest && { month: dashboard.payroll.latest.month, headcount: dashboard.payroll.latest.headcount, employerCostVnd: dashboard.payroll.latest.employerCost }, previous: dashboard.payroll.previous && { month: dashboard.payroll.previous.month, employerCostVnd: dashboard.payroll.previous.employerCost } } : { locked: "Confirm identity at /step-up to see payroll figures." }) : null;
    const tiles: Record<string, unknown> = {
      headcount: dashboard.headcount,
      payroll,
      attendanceToday: dashboard.attendance,
      awayToday: dashboard.leave && { count: dashboard.leave.away.length, pending: dashboard.leave.away.filter((row) => row.pending).length },
      recruitment: dashboard.recruit,
      obligations: dashboard.ops && { overdue: dashboard.ops.overdue, dueWithin14Days: dashboard.ops.dueSoon, worst: dashboard.ops.worst.map((row) => ({ entity: row.entityCode, obligation: row.templateName, dueDate: row.dueDate })) },
      work: dashboard.work,
      projects: dashboard.delivery,
      sales: dashboard.sales && { wonThisMonth: dashboard.sales.wonCount, wonVnd: dashboard.sales.wonVnd, openDeals: dashboard.sales.openDeals, weightedPipelineVnd: dashboard.sales.weightedVnd, overdueReceivablesVnd: dashboard.sales.overdueVnd, collectedThisMonthVnd: dashboard.sales.collectedVnd },
      approvalsWaitingOnAsker: dashboard.approvals.waiting,
    };
    const shown = Object.fromEntries(Object.entries(tiles).filter(([, value]) => value !== null && value !== undefined));
    return {
      outcome: "answered",
      model: { link: "/reports", today, period: dashboard.period, tiles: shown, note: "A tile that is absent is one the asker's dashboard does not show them." },
      card: screen("company_health", "/reports", "dashboard"),
      subject: null,
      compensation: !!payroll && payFresh,
    };
  },
});

// ── Salary estimate (FR-AGT-17) ─────────────────────────────────────────────────────────────

/** The entities whose pay the asker may price, and the one a question names (by code or short name). */
async function pricedEntity(principal: Principal, named: string | undefined) {
  const entities = await listEntityOptions(compensationReach(principal));
  if (!named) return { entities, entity: entities.length === 1 ? entities[0] : null };
  const wanted = toSearchKey(named);
  return { entities, entity: entities.find((row) => toSearchKey(row.code) === wanted || toSearchKey(row.shortName) === wanted) ?? entities.find((row) => toSearchKey(row.shortName).includes(wanted)) ?? null };
}

const quoteView = (quote: OfferQuote) => ({
  grossBaseVnd: quote.gross,
  netVnd: quote.net,
  exact: quote.exact,
  ...(quote.nearest ? { nearest: quote.nearest } : {}),
  employeeInsuranceVnd: quote.totals.employeeInsurance,
  incomeTaxVnd: quote.totals.pit,
  grossEarningsVnd: quote.totals.grossEarnings,
  employerCostVnd: quote.totals.employerCost,
  ...(quote.unverifiedParameters.length ? { unverifiedStatutoryParameters: quote.unverifiedParameters.length } : {}),
});

const salaryEstimate = defineTool({
  name: "salary_estimate",
  module: "payroll",
  description:
    "Salary estimates on the entity's own pay rules and the statutory values in force for the month: gross_to_net (what a gross base salary nets), net_to_gross (what gross gives a wanted net, for an offer), or person (what a named person's current salary file nets in an ordinary full month — no overtime, absence or one-off items). Shows insurance, income tax and employer cost. Needs a recent identity confirmation (step-up).",
  input: z.strictObject({
    mode: z.enum(["gross_to_net", "net_to_gross", "person"]),
    amountVnd: z.number().int().min(1).max(100_000_000_000).optional().describe("For gross_to_net the gross base salary; for net_to_gross the wanted net. Whole đồng."),
    person: z.string().min(2).max(80).optional().describe("For person: a personId from find_person, or the name."),
    month: MONTH.optional().describe("The month priced, YYYY-MM. Default: next month."),
    dependants: z.number().int().min(0).max(20).optional().describe("Registered dependants, for gross_to_net and net_to_gross. Default 0."),
    entity: z.string().max(40).optional().describe("Entity code or short name, when the asker prices for more than one."),
    nonResident: z.boolean().optional().describe("A non-resident for income tax (flat 20%). Default false."),
    insuranceExempt: z.boolean().optional().describe("Someone who does not contribute (probation, intern, collaborator). Default false."),
  }),
  offeredTo: (principal) => reaches(compensationReach(principal)),
  tier: "compensation",
  stepUp: true,
  kind: "read",
  rowCap: 10,
  tags: [],
  run: async ({ user, today }, input) => {
    const month = input.month ?? addDays(`${today.slice(0, 7)}-01`, 32).slice(0, 7);
    if (input.mode === "person") {
      if (!input.person) return { outcome: "failed", model: { error: "person_required" }, card: null, subject: null };
      let personId = UUID.test(input.person) ? input.person : null;
      if (!personId) {
        const found = await peopleNamed(user.principal, input.person);
        if (found.length === 0) return { outcome: "empty", model: { people: [], link: "/payroll/salaries" }, card: null, subject: null };
        if (found.length > 1) return { outcome: "answered", model: { note: "Several people match: ask which one.", people: found.map((row) => ({ personId: row.id, name: row.fullName, department: row.departmentName })) }, card: null, subject: null };
        personId = found[0].id;
      }
      const estimate = await estimateFromSalaryFile({ personId: user.person.id, principal: user.principal }, personId, month);
      if (!estimate) return { outcome: "refused", model: { note: "No salary file the asker may see, or none in force for the month.", link: "/payroll/salaries" }, card: null, subject: { type: "person", id: personId } };
      const link = `/payroll/salaries/${personId}`;
      return {
        outcome: "answered",
        model: { link, name: estimate.person.fullName, month, structureInForceFrom: estimate.structureFrom, dependants: estimate.dependents, note: "An ordinary full month on the salary file: no overtime, absence, bonus or one-off item. The payslip will differ when those apply.", ...quoteView(estimate.quote) },
        card: { tool: "salary_estimate", href: link, items: [{ label: estimate.person.fullName, href: link, meta: { key: "estimateFor", params: { month } } }], more: 0 },
        subject: { type: "person", id: personId },
      };
    }
    if (!input.amountVnd) return { outcome: "failed", model: { error: "amount_required" }, card: null, subject: null };
    const { entities, entity } = await pricedEntity(user.principal, input.entity);
    if (!entity) return { outcome: entities.length ? "answered" : "refused", model: entities.length ? { note: "Ask which entity to price for.", entities: entities.map((row) => ({ code: row.code, name: row.shortName })) } : { link: "/payroll" }, card: null, subject: null };
    if (!canManageCompensation(user.principal, { entityId: entity.id })) return { outcome: "refused", model: { link: "/payroll" }, card: null, subject: null };
    const terms = { entityId: entity.id, month, dependents: input.dependants ?? 0, profile: "statutory" as const, taxResidency: input.nonResident ? ("non_resident" as const) : ("resident" as const), insuranceExempt: input.insuranceExempt ?? false, allowances: [], insuranceSalary: null };
    const quote = input.mode === "gross_to_net" ? await estimateNet({ ...terms, grossSalary: input.amountVnd }) : await quoteOffer({ ...terms, netSalary: input.amountVnd });
    return {
      outcome: "answered",
      model: { link: "/payroll/tools/net-to-gross", entity: entity.shortName, month, mode: input.mode, dependants: terms.dependents, note: "No allowances; insurance on the whole base salary. The calculator page takes allowances and a declared insurance salary.", ...quoteView(quote) },
      card: screen("salary_estimate", "/payroll/tools/net-to-gross", "netToGross"),
      subject: { type: "entity", id: entity.id },
    };
  },
});

export const MONEY_TOOLS: readonly AnyAgentTool[] = [payrollCost, profitability, receivables, salesPipeline, companyHealth, salaryEstimate];
