// The report catalogue (FR-RPT-05): every report that can be exported or scheduled, in one place.
//
// A catalogue entry is three things and nothing else:
//  - `canSee(user)` — may this person read this report *at all*? The same predicate the report's own
//    screen checks, imported from the owning module, never re-derived here;
//  - `build(user, params, period, locale)` — the rows, fetched **through the owning module's
//    `service.ts` with that person's own principal**. Every one of those functions scopes itself:
//    a department head's headcount is their department's, a viewer with no payroll reach gets an
//    empty cost table. This module adds no reach of its own and holds no query of its own;
//  - `parameters` — a zod schema, so what a schedule stored months ago is validated on the way out.
//
// That shape is what makes a *scheduled* report safe: the job builds it once per recipient, as the
// recipient (see `schedules.ts`). There is no "render as the creator and post it on". If a person
// who was added to a schedule in January may no longer read the report in March, `canSee` says no
// in March and the run records that it was withheld.
import "server-only";
import { createTranslator } from "next-intl";
import { z } from "zod";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { getHeadcountReport } from "@/modules/core-hr/service";
import { listInstances } from "@/modules/ops/service";
import { costTrend, payrollReadReach } from "@/modules/payroll/service";
import { type CsvFile, type ExportColumn, toCsv } from "@/modules/platform/export/csv";
import type { PersonRow } from "@/modules/platform/people/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { canReadRecruitReports, getRecruitReport } from "@/modules/recruit/service";
import { getWorkAnalytics, loadViewer } from "@/modules/work/service";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import type { Period } from "./engine/cadence";
import { getDeliveryDashboard } from "./delivery";
import type { DeliverySummary } from "./engine/delivery";
import { canOpenDelivery, canReadProfitability } from "./pjm-policy";
import { buildProfitability } from "./profitability";

export type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });

/** Everything a report needs about the person asking for it. `CurrentUser` satisfies it. */
export type ReportViewer = { person: PersonRow; principal: Principal };

/** A report is always one table: a title, named columns, and rows of plain cells. */
export type ReportTable = { title: string; columns: string[]; rows: (string | number)[][]; /** One line of prose for the email and the screen. */ summary: string };

export type ReportDefinition<Parameters> = {
  key: string;
  parameters: z.ZodType<Parameters, unknown>;
  canSee: (user: ReportViewer) => boolean | Promise<boolean>;
  /**
   * May this report be put on a schedule and emailed? Default yes. **The payroll cost report says
   * no** (the decision is recorded on its entry): compensation figures are behind step-up
   * re-authentication on every screen that shows them (FR-PLT-06), and an email is a channel with
   * no step-up at all. It stays exportable on demand from `/payroll/reports`, which does ask.
   */
  schedulable?: boolean;
  /**
   * Does reading this report need a fresh proof of identity (FR-PLT-06)? True for anything at the
   * compensation tier, so an export cannot become the one door to a pay figure that does not ask.
   * Screens gate themselves with `requireStepUp`; `exportReportAction` asks this.
   */
  stepUp?: boolean;
  /** Where the report lives, so an email can link to the screen behind the numbers. */
  href: (parameters: Parameters) => string;
  build: (user: ReportViewer, parameters: Parameters, period: Period, locale: Locale) => Promise<ReportTable>;
};

const optionalUuid = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.uuid().optional());
const number = (value: number | null, fallback = "—") => (value === null ? fallback : value);
const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/**
 * Does this person hold `payroll:read` over any entity at all? The figures themselves are still
 * filtered in SQL by `costTrend`; this only decides whether the tile or the catalogue entry is
 * offered, so that a reader with no reach sees nothing rather than an empty compensation table.
 */
function hasPayrollReach(principal: Principal): boolean {
  const reach = payrollReadReach(principal);
  return reach.all || reach.entityIds.length > 0;
}


// ── headcount ───────────────────────────────────────────────────────────────────────────────

const headcount: ReportDefinition<{ entityId?: string }> = {
  key: "headcount",
  parameters: z.object({ entityId: optionalUuid }),
  canSee: (user) => can(user.principal, "report:read"),
  href: (parameters) => (parameters.entityId ? `/reports/headcount?entityId=${parameters.entityId}` : "/reports/headcount"),
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const report = await getHeadcountReport(user.principal, { asOf: period.to, from: period.from, to: period.to, entityId: parameters.entityId });
    const rows: (string | number)[][] = [];
    if (report) {
      rows.push([t("reports.headcount.total"), report.snapshot.asOf, report.snapshot.total]);
      for (const group of ["byEntity", "byDepartment", "byWorkforceType"] as const) {
        for (const row of report.snapshot[group]) rows.push([t(`reports.headcount.groups.${group}`), row.key === "unknown" ? t("reports.headcount.unknown") : row.key, row.count]);
      }
      const { movement } = report;
      rows.push([t("reports.headcount.movement"), t("reports.headcount.joiners"), movement.joiners]);
      rows.push([t("reports.headcount.movement"), t("reports.headcount.leavers"), movement.leavers]);
      rows.push([t("reports.headcount.movement"), t("reports.headcount.closing"), movement.closing]);
      for (const row of report.contractsExpiring) rows.push([t("reports.headcount.contractsExpiring"), `${row.employeeCode} ${row.fullName}`, row.endDate]);
    }
    return {
      title: t("reports.catalogue.headcount.name"),
      columns: [t("reports.headcount.columns.section"), t("reports.headcount.columns.group"), t("reports.headcount.columns.value")],
      rows,
      summary: report ? t("reports.catalogue.headcount.summary", { total: report.snapshot.total, joiners: report.movement.joiners, leavers: report.movement.leavers }) : "",
    };
  },
};

// ── payroll cost trend ──────────────────────────────────────────────────────────────────────

const monthOf = (date: IsoDate) => date.slice(0, 7);

const payrollCost: ReportDefinition<{ entityId?: string; months: number }> = {
  key: "payroll_cost",
  parameters: z.object({ entityId: optionalUuid, months: z.coerce.number().int().min(1).max(24).default(6) }),
  // Compensation tier, and deliberately the coarsest shape of it: entity totals per month, exactly
  // what /payroll/reports already shows a `payroll:read` holder. A line manager holds no such
  // permission and never will through this catalogue.
  canSee: (user) => hasPayrollReach(user.principal),
  // Never emailed on a schedule: see `schedulable` on ReportDefinition. Compensation is read after
  // proving who you are, and a mailbox proves nothing. The on-demand export asks for the same
  // proof `/payroll/reports` asks for, so this is not a quieter way in.
  schedulable: false,
  stepUp: true,
  href: (parameters) => (parameters.entityId ? `/payroll/reports?entityId=${parameters.entityId}` : "/payroll/reports"),
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const toMonth = monthOf(period.to);
    const from = new Date(`${toMonth}-01T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - (parameters.months - 1));
    const points = await costTrend(user.principal, { entityId: parameters.entityId ?? null, fromMonth: from.toISOString().slice(0, 7), toMonth });
    const latest = points.at(-1);
    return {
      title: t("reports.catalogue.payroll_cost.name"),
      columns: [t("reports.catalogue.payroll_cost.month"), t("reports.catalogue.payroll_cost.headcount"), t("reports.catalogue.payroll_cost.gross"), t("reports.catalogue.payroll_cost.net"), t("reports.catalogue.payroll_cost.employerCost")],
      rows: points.map((point) => [point.month, point.headcount, point.gross, point.net, point.employerCost]),
      summary: latest ? t("reports.catalogue.payroll_cost.summary", { month: latest.month, cost: latest.employerCost }) : t("reports.catalogue.empty"),
    };
  },
};

// ── work analytics ──────────────────────────────────────────────────────────────────────────

const workAnalytics: ReportDefinition<{ teamId?: string; clientId?: string }> = {
  key: "work_analytics",
  parameters: z.object({ teamId: optionalUuid, clientId: optionalUuid }),
  // No permission gates work: what a person sees is their teams and projects, decided in SQL by
  // `visibleTaskCondition`. Somebody on nothing gets an empty table, which is the honest answer.
  canSee: () => true,
  href: (parameters) => (parameters.teamId ? `/work/analytics?team=${parameters.teamId}` : "/work/analytics"),
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const viewer = await loadViewer(user);
    const analytics = await getWorkAnalytics(viewer, { from: period.from, to: period.to, teamId: parameters.teamId ?? null, clientId: parameters.clientId ?? null });
    const line = (kind: string, name: string, cell: (typeof analytics.total)) => [kind, name, cell.completed, cell.onTime, cell.late, percent(cell.onTimeRate), cell.open, cell.overdue, number(cell.revisionsPerTask === null ? null : Math.round(cell.revisionsPerTask * 10) / 10), cell.contributors];
    return {
      title: t("reports.catalogue.work_analytics.name"),
      columns: [
        t("reports.analytics.columns.kind"),
        t("reports.analytics.columns.name"),
        t("reports.analytics.columns.completed"),
        t("reports.analytics.columns.onTime"),
        t("reports.analytics.columns.late"),
        t("reports.analytics.columns.onTimeRate"),
        t("reports.analytics.columns.open"),
        t("reports.analytics.columns.overdue"),
        t("reports.analytics.columns.revisions"),
        t("reports.analytics.columns.contributors"),
      ],
      rows: [
        line(t("reports.analytics.total"), "—", analytics.total),
        ...analytics.byTeam.map((group) => line(t("reports.analytics.byTeam"), group.name, group.cell)),
        ...analytics.byClient.map((group) => line(t("reports.analytics.byClient"), group.name, group.cell)),
      ],
      summary: t("reports.catalogue.work_analytics.summary", { completed: analytics.total.completed, rate: percent(analytics.total.onTimeRate), overdue: analytics.total.overdue }),
    };
  },
};

// ── overdue obligations ─────────────────────────────────────────────────────────────────────

const opsOverdue: ReportDefinition<{ entityId?: string }> = {
  key: "ops_overdue",
  parameters: z.object({ entityId: optionalUuid }),
  canSee: (user) => can(user.principal, "ops:read") || can(user.principal, "ops:manage"),
  href: () => "/ops",
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const today = todayInVietnam();
    const instances = await listInstances({ principal: user.principal, personId: user.person.id }, { open: true, entityId: parameters.entityId ?? null, dueTo: today, limit: 200 }, today);
    const overdue = instances.filter((instance) => (instance.dueDate ?? instance.nominalDueDate) < today);
    return {
      title: t("reports.catalogue.ops_overdue.name"),
      columns: [t("reports.catalogue.ops_overdue.entity"), t("reports.catalogue.ops_overdue.obligation"), t("reports.catalogue.ops_overdue.due"), t("reports.catalogue.ops_overdue.owner")],
      rows: overdue.map((instance) => [instance.entityCode, instance.templateName, instance.dueDate ?? instance.nominalDueDate, instance.assigneeName ?? "—"]),
      summary: t("reports.catalogue.ops_overdue.summary", { count: overdue.length }),
    };
  },
};

// ── recruitment funnel ──────────────────────────────────────────────────────────────────────

const recruitFunnel: ReportDefinition<{ entityId?: string }> = {
  key: "recruit_funnel",
  parameters: z.object({ entityId: optionalUuid }),
  canSee: (user) => canReadRecruitReports(user.principal),
  href: () => "/recruit/reports",
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const report = await getRecruitReport(user.principal, { from: period.from, to: period.to, entityId: parameters.entityId });
    return {
      title: t("reports.catalogue.recruit_funnel.name"),
      columns: [t("reports.catalogue.recruit_funnel.stage"), t("reports.catalogue.recruit_funnel.count")],
      rows: [
        [t("reports.catalogue.recruit_funnel.openOpenings"), report.openOpenings],
        [t("reports.catalogue.recruit_funnel.applications"), report.applications],
        [t("reports.catalogue.recruit_funnel.active"), report.active],
        ...report.steps.map((step) => [t(`recruit.stageCategory.${step.category}` as never), step.reached] as (string | number)[]),
      ],
      summary: t("reports.catalogue.recruit_funnel.summary", { applications: report.applications, open: report.openOpenings }),
    };
  },
};

// ── delivery (FR-PJM-60) ────────────────────────────────────────────────────────────────────

const delivery: ReportDefinition<{ teamId?: string }> = {
  key: "delivery",
  parameters: z.object({ teamId: optionalUuid }),
  // Like the work analytics: no permission, the projects are the ones the reader may open, and
  // compliance covers the teams they lead or oversee through `pjm:portfolio`. Hours, never money.
  canSee: (user) => canOpenDelivery(user.principal),
  href: (parameters) => (parameters.teamId ? `/reports/delivery?team=${parameters.teamId}` : "/reports/delivery"),
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const view = await getDeliveryDashboard(user, { from: period.from, to: period.to, teamId: parameters.teamId ?? null });
    const line = (name: string, summary: DeliverySummary): (string | number)[] => [
      name,
      summary.projects,
      summary.health.on_track,
      summary.health.at_risk,
      summary.health.off_track,
      summary.health.stale,
      summary.milestones.slipped,
      summary.milestones.overdue,
      percent(summary.onTime.rate),
      percent(summary.register.rate),
      percent(summary.burn.rate),
      summary.revisions.internalRounds,
      summary.revisions.clientRounds,
      summary.handoffs.returned,
      number(summary.handoffs.averageWaitMinutes === null ? null : Math.round((summary.handoffs.averageWaitMinutes / 60) * 10) / 10),
      summary.blocked.blockedHours,
    ];
    const compliance = view.compliance?.total;
    return {
      title: t("reports.catalogue.delivery.name"),
      columns: (["team", "projects", "onTrack", "atRisk", "offTrack", "stale", "slipped", "overdueMilestones", "onTimeRate", "acceptedRate", "burnRate", "internalRounds", "clientRounds", "returnedHandoffs", "handoffWaitHours", "blockedHours"] as const).map((key) => t(`reports.delivery.columns.${key}`)),
      rows: [line(t("reports.delivery.total"), view.total), ...view.byTeam.map((team) => line(team.name, team.summary))],
      summary: t("reports.catalogue.delivery.summary", { projects: view.total.projects, onTime: percent(view.total.onTime.rate), stale: view.total.health.stale, eod: percent(compliance?.reports.rate ?? null) }),
    };
  },
};

// ── profitability (FR-PJM-63) ───────────────────────────────────────────────────────────────

const profitabilityReport: ReportDefinition<{ clientId?: string }> = {
  key: "profitability",
  parameters: z.object({ clientId: optionalUuid }),
  // Salary-derived: `pjm:cost` only, per project also `pjm:commercial` (see pjm-policy.ts). The
  // rows are projects and their team totals — never a person, never a rate.
  canSee: (user) => canReadProfitability(user.principal),
  // Compensation tier: never emailed (a mailbox proves nothing), and exported only after step-up.
  schedulable: false,
  stepUp: true,
  href: (parameters) => (parameters.clientId ? `/reports/profitability?client=${parameters.clientId}` : "/reports/profitability"),
  build: async (user, parameters, period, locale) => {
    const t = translator(locale);
    const view = await buildProfitability(user, { from: period.from, to: period.to, clientId: parameters.clientId ?? null });
    const rows: (string | number)[][] = [];
    const cell = (value: number | null) => (value === null ? "—" : value);
    if (view) {
      for (const project of view.projects) rows.push([t("reports.profitability.project"), [project.jobNumber, project.name].filter(Boolean).join(" · "), project.clientName ?? "—", t(`reports.profitability.basis.${project.basis}`), project.hours, cell(project.feeVnd), project.costVnd, cell(project.marginVnd), percent(project.marginRate), project.estimated ? t("reports.profitability.estimated") : ""]);
      if (view.privateProjects) rows.push([t("reports.profitability.project"), t("reports.profitability.privateProjects", { count: view.privateProjects.projects }), "—", "—", view.privateProjects.hours, cell(view.privateProjects.feeVnd), view.privateProjects.costVnd, cell(view.privateProjects.marginVnd), percent(view.privateProjects.marginRate), view.privateProjects.estimated ? t("reports.profitability.estimated") : ""]);
      for (const client of view.clients) rows.push([t("reports.profitability.client"), client.clientName ?? t("reports.profitability.noClient"), "—", "—", client.hours, cell(client.feeVnd), client.costVnd, cell(client.marginVnd), percent(client.marginRate), client.estimated ? t("reports.profitability.estimated") : ""]);
      rows.push([t("reports.profitability.total"), "—", "—", "—", view.total.hours, cell(view.total.feeVnd), view.total.costVnd, cell(view.total.marginVnd), percent(view.total.marginRate), view.total.estimated ? t("reports.profitability.estimated") : ""]);
    }
    return {
      title: t("reports.catalogue.profitability.name"),
      columns: (["kind", "name", "client", "basis", "hours", "fee", "cost", "margin", "marginRate", "note"] as const).map((key) => t(`reports.profitability.columns.${key}`)),
      rows,
      summary: view ? t("reports.catalogue.profitability.summary", { projects: view.projects.length, margin: percent(view.total.marginRate) }) : t("reports.catalogue.empty"),
    };
  },
};

// ── the catalogue ───────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each entry has its own parameter type; the map is keyed by report, not by shape.
const DEFINITIONS: ReportDefinition<any>[] = [headcount, payrollCost, workAnalytics, opsOverdue, recruitFunnel, delivery, profitabilityReport];

export const REPORT_KEYS = DEFINITIONS.map((definition) => definition.key);
export type ReportKey = (typeof REPORT_KEYS)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
export function findReport(key: string): ReportDefinition<any> | undefined {
  return DEFINITIONS.find((definition) => definition.key === key);
}

export function isSchedulable(key: string): boolean {
  return findReport(key)?.schedulable !== false;
}

/** Does this report need a fresh step-up before it may be read outside its own screen? */
export function needsStepUp(key: string): boolean {
  return findReport(key)?.stepUp === true;
}

/**
 * The reports this person may read today. `forScheduling` drops the ones that may never be
 * emailed, so the schedule form cannot offer what the job would refuse to send.
 */
export async function listReportsFor(user: ReportViewer, options: { forScheduling?: boolean } = {}): Promise<{ key: string }[]> {
  const candidates = options.forScheduling ? DEFINITIONS.filter((definition) => definition.schedulable !== false) : DEFINITIONS;
  const allowed = await Promise.all(candidates.map(async (definition) => ((await definition.canSee(user)) ? definition : null)));
  return allowed.filter((definition) => definition !== null).map((definition) => ({ key: definition.key }));
}

/**
 * Builds a report for one person, or answers null because they may not read it. **The only way to
 * render a report**: there is no variant that takes somebody else's permissions.
 */
export async function buildReportFor(user: ReportViewer, key: string, rawParameters: unknown, period: Period, locale: Locale): Promise<ReportTable | null> {
  const definition = findReport(key);
  if (!definition) return null;
  if (!(await definition.canSee(user))) return null;
  const parsed = definition.parameters.safeParse(rawParameters ?? {});
  if (!parsed.success) return null;
  return definition.build(user, parsed.data, period, locale);
}

export function reportToCsv(table: ReportTable, fileName: string): CsvFile {
  const columns: ExportColumn<(string | number)[]>[] = table.columns.map((header, index) => ({ header, value: (row) => row[index] ?? "" }));
  return { fileName, csv: toCsv(columns, table.rows), rowCount: table.rows.length, truncated: false };
}

/** The plain-text body of a scheduled report's email: the summary, the table, and where to look. */
export function reportToText(table: ReportTable, period: Period, link: string): string {
  const widths = table.columns.map((header, index) => Math.max(header.length, ...table.rows.map((row) => String(row[index] ?? "").length)));
  const line = (cells: (string | number)[]) => cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  const body = table.rows.length ? [line(table.columns), widths.map((width) => "-".repeat(width)).join("  "), ...table.rows.map(line)].join("\n") : "";
  return [`${table.title}`, `${period.from} → ${period.to}`, "", table.summary, "", body, "", link].join("\n");
}
