// The portfolio (FR-PJM-08): every project the viewer may open — `visibleProjects()`, the same
// policy as the work screens — with its type, client, lead, health, next milestone, register
// progress, hours burn and open risks and issues. The fee column is filled per project only where the viewer holds
// `pjm:commercial` over that project's entity; everywhere else the field is absent, not zero.
import "server-only";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { type CsvFile, EXPORT_ROW_LIMIT, type ExportColumn, toCsv } from "@/modules/platform/export/csv";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { visibleProjects, type WorkViewer } from "../work/service";
import { slipDays } from "./engine/baseline";
import type { Burn } from "./engine/budget";
import type { ProjectKind } from "./engine/brief";
import { type Health, isStale } from "./engine/status";
import type { RaidCounts } from "./engine/raid";
import { loadBurns, loadRaidCounts, loadRegisters } from "./metrics";
import { readPlans } from "./plans";
import { canSeeFees } from "./policy";

export type PortfolioRow = {
  id: string;
  name: string;
  status: string;
  jobNumber: string | null;
  kind: ProjectKind;
  teamId: string;
  teamName: string;
  entityId: string | null;
  entityName: string | null;
  clientId: string | null;
  clientName: string | null;
  leadPersonId: string | null;
  leadName: string | null;
  accountManagerName: string | null;
  briefStatus: string;
  health: Health | null;
  stale: boolean;
  phaseName: string | null;
  nextMilestone: { name: string; dueDate: string | null } | null;
  startDate: string | null;
  dueDate: string | null;
  dueSlipDays: number | null;
  register: { promised: number; accepted: number; percent: number | null };
  burn: Pick<Burn, "loggedMinutes" | "burnMinutes" | "budgetMinutes" | "percent" | "level">;
  /** Open high risks and open issues of the RAID log (FR-PJM-29). */
  raid: RaidCounts;
  /** Present only for a viewer with `pjm:commercial` over the project's entity. */
  feeVnd?: number | null;
};

export const PORTFOLIO_GROUPS = ["none", "team", "client", "lead", "entity", "kind", "health"] as const;
export type PortfolioGroup = (typeof PORTFOLIO_GROUPS)[number];
export type PortfolioFilters = { teamId?: string; clientId?: string; leadPersonId?: string; entityId?: string; kind?: string; health?: string };

const matches = (row: PortfolioRow, filters: PortfolioFilters) =>
  (!filters.teamId || row.teamId === filters.teamId) &&
  (!filters.clientId || row.clientId === filters.clientId) &&
  (!filters.leadPersonId || row.leadPersonId === filters.leadPersonId) &&
  (!filters.entityId || row.entityId === filters.entityId) &&
  (!filters.kind || row.kind === filters.kind) &&
  (!filters.health || (filters.health === "stale" ? row.stale : filters.health === "none" ? row.health === null : row.health === filters.health));

export async function listPortfolio(viewer: WorkViewer, options: { today: IsoDate; filters?: PortfolioFilters; includeDone?: boolean }): Promise<PortfolioRow[]> {
  const projects = (await visibleProjects(viewer, { today: options.today })).filter((project) => options.includeDone || project.status !== "done");
  if (projects.length === 0) return [];
  const ids = projects.map((project) => project.id);
  const plans = await readPlans(ids);
  const managerIds = [...new Set([...plans.values()].flatMap((plan) => (plan.accountManagerPersonId ? [plan.accountManagerPersonId] : [])))];
  const entityIds = [...new Set(projects.flatMap((project) => (project.entityId ? [project.entityId] : [])))];
  const [registers, burns, milestones, phases, managers, entities, raid] = await Promise.all([
    loadRegisters(ids),
    loadBurns(ids, new Map([...plans].map(([id, plan]) => [id, plan.budgetMinutes]))),
    db().select().from(schema.projectMilestone).where(and(inArray(schema.projectMilestone.projectId, ids), isNull(schema.projectMilestone.doneAt))).orderBy(asc(schema.projectMilestone.dueDate)),
    db().select().from(schema.projectPhase).where(inArray(schema.projectPhase.projectId, ids)).orderBy(asc(schema.projectPhase.sortOrder)),
    managerIds.length ? db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, managerIds)) : [],
    entityIds.length ? db().select({ id: schema.entity.id, shortName: schema.entity.shortName }).from(schema.entity).where(inArray(schema.entity.id, entityIds)) : [],
    loadRaidCounts(ids),
  ]);
  const nextOf = new Map<string, { name: string; dueDate: string | null }>();
  // Earliest date first; Postgres sorts undated milestones last.
  for (const milestone of milestones) if (!nextOf.has(milestone.projectId)) nextOf.set(milestone.projectId, { name: milestone.name, dueDate: milestone.dueDate });
  const phasesOf = Map.groupBy(phases, (phase) => phase.projectId);
  const nameOf = new Map(managers.map((person) => [person.id, person.fullName]));
  const entityOf = new Map(entities.map((entity) => [entity.id, entity.shortName]));

  const rows = projects.map((project): PortfolioRow => {
    const plan = plans.get(project.id)!;
    const register = registers.get(project.id)!;
    const burn = burns.get(project.id)!;
    const current = (phasesOf.get(project.id) ?? []).find((phase) => (!phase.startDate || phase.startDate <= options.today) && (!phase.endDate || phase.endDate >= options.today));
    const since = todayInVietnam(plan.briefApprovedAt ?? plan.createdAt);
    const row: PortfolioRow = {
      id: project.id,
      name: project.name,
      status: project.status,
      jobNumber: plan.jobNumber,
      kind: plan.kind as ProjectKind,
      teamId: project.teamId,
      teamName: project.teamName,
      entityId: project.entityId,
      entityName: project.entityId ? (entityOf.get(project.entityId) ?? null) : null,
      clientId: project.clientId,
      clientName: project.clientName,
      leadPersonId: project.leadPersonId,
      leadName: project.leadName,
      accountManagerName: plan.accountManagerPersonId ? (nameOf.get(plan.accountManagerPersonId) ?? null) : null,
      briefStatus: plan.briefStatus,
      health: plan.health as Health | null,
      stale: isStale({ projectStatus: project.status, lastUpdateOn: plan.healthUpdatedAt ? todayInVietnam(plan.healthUpdatedAt) : null, since, cadenceDays: plan.updateCadenceDays }, options.today),
      phaseName: current?.name ?? null,
      nextMilestone: nextOf.get(project.id) ?? null,
      startDate: project.startDate,
      dueDate: project.dueDate,
      dueSlipDays: slipDays(plan.baseline?.dueDate, project.dueDate),
      register: { promised: register.promised, accepted: register.accepted, percent: register.percent },
      burn: { loggedMinutes: burn.loggedMinutes, burnMinutes: burn.burnMinutes, budgetMinutes: burn.budgetMinutes, percent: burn.percent, level: burn.level },
      raid: raid.get(project.id) ?? { highRisks: 0, openIssues: 0 },
    };
    // Per project: a director of one entity sees the fees of that entity's projects only, and the
    // lead or account manager of one project the fee of that project only (Q21).
    if (canSeeFees(viewer, { id: project.id, entityId: project.entityId })) row.feeVnd = plan.feeVnd;
    return row;
  });
  return filterPortfolio(rows, options.filters ?? {});
}

/** The screen reads every row once (for its filter options) and narrows them here. */
export const filterPortfolio = (rows: readonly PortfolioRow[], filters: PortfolioFilters): PortfolioRow[] => rows.filter((row) => matches(row, filters));

/** Does any project on this viewer's list show money? Decides whether the fee column exists at all. */
export const showsFees = (rows: readonly PortfolioRow[]): boolean => rows.some((row) => "feeVnd" in row);

type Locale = "vi" | "en";
const translator = (locale: Locale) => createTranslator({ locale, messages: locale === "vi" ? vi : en });
const hours = (minutes: number | null) => (minutes === null ? null : Math.round((minutes / 60) * 10) / 10);

/**
 * The portfolio as CSV (FR-PLT-37): the same rows as the screen, the same filters, and the fee
 * column only when the viewer sees money — and then filled only on the rows they may read.
 */
export async function buildPortfolioExport(viewer: WorkViewer, filters: PortfolioFilters, locale: Locale): Promise<{ file: CsvFile; withFees: boolean }> {
  const rows = await listPortfolio(viewer, { today: todayInVietnam(), filters });
  const limited = rows.slice(0, EXPORT_ROW_LIMIT);
  const t = translator(locale);
  const withFees = showsFees(limited);
  const columns: ExportColumn<PortfolioRow>[] = [
    { header: t("projects.fields.jobNumber"), value: (row) => row.jobNumber },
    { header: t("projects.fields.name"), value: (row) => row.name },
    { header: t("projects.fields.kind"), value: (row) => t(`projects.kinds.${row.kind}`) },
    { header: t("projects.fields.status"), value: (row) => t(`work.projects.status.${row.status as "active"}`) },
    { header: t("projects.fields.team"), value: (row) => row.teamName },
    { header: t("projects.fields.entity"), value: (row) => row.entityName },
    { header: t("projects.fields.client"), value: (row) => row.clientName },
    { header: t("projects.fields.lead"), value: (row) => row.leadName },
    { header: t("projects.fields.accountManager"), value: (row) => row.accountManagerName },
    { header: t("projects.fields.health"), value: (row) => (row.health ? t(`projects.health.${row.health}`) : null) },
    { header: t("projects.fields.stale"), value: (row) => (row.stale ? t("projects.portfolio.staleYes") : null) },
    { header: t("projects.fields.phase"), value: (row) => row.phaseName },
    { header: t("projects.fields.nextMilestone"), value: (row) => (row.nextMilestone ? [row.nextMilestone.name, row.nextMilestone.dueDate].filter(Boolean).join(" · ") : null) },
    { header: t("projects.fields.startDate"), value: (row) => row.startDate },
    { header: t("projects.fields.dueDate"), value: (row) => row.dueDate },
    { header: t("projects.fields.dueSlip"), value: (row) => row.dueSlipDays },
    { header: t("projects.fields.accepted"), value: (row) => row.register.accepted },
    { header: t("projects.fields.promised"), value: (row) => row.register.promised },
    { header: t("projects.fields.hoursUsed"), value: (row) => hours(row.burn.loggedMinutes) },
    { header: t("projects.fields.hoursBurn"), value: (row) => hours(row.burn.burnMinutes) },
    { header: t("projects.fields.hoursBudget"), value: (row) => hours(row.burn.budgetMinutes) },
    { header: t("projects.raid.portfolio.highRisks"), value: (row) => row.raid.highRisks },
    { header: t("projects.raid.portfolio.openIssues"), value: (row) => row.raid.openIssues },
    ...(withFees ? [{ header: t("projects.fields.feeVnd"), value: (row: PortfolioRow) => row.feeVnd ?? null }] : []),
  ];
  return { file: { fileName: `portfolio-${todayInVietnam()}.csv`, csv: toCsv(columns, limited), rowCount: limited.length, truncated: rows.length > limited.length }, withFees };
}
