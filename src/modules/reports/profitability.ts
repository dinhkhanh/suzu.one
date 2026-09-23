// Project and client profitability (FR-PJM-63). Owner, C-level and finance — `pjm:cost`.
//
// Fee against cost per project and per client, where cost = hours logged × each person's monthly
// loaded cost rate from the signed payroll (`loadedCostRates`, payroll-owned, compensation tier).
//
// HOW PER-PERSON FIGURES ARE KEPT IN
//  - The rates and the per-person minutes live only inside `buildProfitability`; the pure engine
//    turns them into sums per project, client, team and role, and the view type below has no
//    field that could carry a person's id, rate or cost. Groups of one are folded into "other".
//  - Nothing is read unless the reader holds `pjm:cost`: the payroll function refuses too, and a
//    project is included only where the reader holds `pjm:cost` *and* `pjm:commercial` over its
//    entity (`canSeeProfitabilityOf`).
//  - Private projects are not named: their figures go into one unnamed line (FR-WRK-18 keeps their
//    content with their members), while still counting in their client's and the total's margin.
//    Except to a reader who may open the project anyway — one of its people, or a `pjm:portfolio`
//    holder over its team since the owner's decision of 2026-09-23 (Q25): a line they could read in
//    full on the project's own pages is no secret in a report, so for them it is named like any
//    other. Those two are named here one by one, and the portfolio reader's is recorded as a
//    private read like every other reader path.
//  - Every read is written to the audit log as a compensation-tier read (who, which period, how
//    many projects) — the same trail an export of the payroll reports leaves. Screens ask for a
//    fresh step-up first (`requireStepUp`), exports through `exportReportAction` (stepUp: true).
import "server-only";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { listPositionHolders, listPositions } from "@/modules/core-hr/service";
import { loadedCostRates } from "@/modules/payroll/service";
import { recordAudit } from "@/modules/platform/audit/service";
import { canViewProject, listTeams, loadViewer, notePrivateProjectReads, readsPrivateByPortfolio } from "@/modules/work/service";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { type FeeBasis, type Margin, monthsBetween, OTHER_GROUP, profitability, type TimeLine } from "./engine/profitability";
import { feesByProject, loggedMinutesByProjectPersonMonth, projectsOfEntities } from "./pjm-queries";
import { canReadProfitability, canSeeProfitabilityOf } from "./pjm-policy";

export type ProfitabilityReader = { userId?: string | null; email?: string | null; person: { id: string; primaryEntityId: string | null }; principal: Principal; request?: { ipAddress?: string | null; userAgent?: string | null } };
export type ProfitabilityFilter = { from: IsoDate; to: IsoDate; clientId?: string | null };

/**
 * A group's hours and cost — a team or a role, never a person. `name` null: time with no team
 * (logged on the project itself) or no position; `other`: small groups folded together.
 */
export type CostGroup = { name: string | null; other: boolean; hours: number; costVnd: number };
export type ProjectLine = Margin & { id: string; name: string; jobNumber: string | null; teamName: string; clientId: string | null; clientName: string | null; basis: FeeBasis; hours: number; unratedHours: number; estimated: boolean; byTeam: CostGroup[]; byRole: CostGroup[] };
export type ClientLine = Margin & { clientId: string | null; clientName: string | null; projects: number; hours: number; estimated: boolean };
export type ProfitabilityView = {
  period: { from: IsoDate; to: IsoDate };
  projects: ProjectLine[];
  /** Private projects in the reader's reach they may not open, summed and unnamed; null when there are none. */
  privateProjects: (Margin & { projects: number; hours: number; estimated: boolean }) | null;
  clients: ClientLine[];
  total: Margin & { hours: number; estimated: boolean };
  clientsOffered: { id: string; name: string }[];
};

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/** A row of `projectsOfEntities` as the work policy reads it, so "may this reader open it?" can be asked. */
const workFactsOf = (project: { id: string; entityId: string | null; visibility: string; teamId: string; teamEntityId: string | null; teamDepartmentId: string | null; teamDefaultVisibility: string }) => ({
  id: project.id,
  entityId: project.entityId,
  visibility: project.visibility as Parameters<typeof canViewProject>[1]["visibility"],
  team: { id: project.teamId, entityId: project.teamEntityId, departmentId: project.teamDepartmentId, defaultVisibility: project.teamDefaultVisibility as Parameters<typeof canViewProject>[1]["visibility"] },
});
/** How far back a month without a signed run may look for the person's last known rate. */
const RATE_LOOKBACK_MONTHS = 12;
const monthMinus = (month: string, count: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
};

/**
 * The figures, for a `pjm:cost` holder; null for anybody else. No audit here — `getProfitability`
 * (screens) and the catalogue entry (exports, audited by `report.export`) wrap it.
 */
/** The client key private projects are summed under, so that no client line carries them. */
const PRIVATE_GROUP = "private";

export async function buildProfitability(reader: Pick<ProfitabilityReader, "person" | "principal"> & Partial<Pick<ProfitabilityReader, "userId" | "email" | "request">>, filter: ProfitabilityFilter): Promise<ProfitabilityView | null> {
  if (!canReadProfitability(reader.principal)) return null;
  const reach = entityReach(reader.principal, "pjm:cost");
  const [rows, viewer] = await Promise.all([projectsOfEntities(reach), loadViewer({ person: { id: reader.person.id, primaryEntityId: reader.person.primaryEntityId }, principal: reader.principal, userId: reader.userId, email: reader.email, request: reader.request })]);
  const all = rows.filter((project) => canSeeProfitabilityOf(reader.principal, project));
  // A private project this reader could not open is summed without its name — nor its client: a
  // client whose only project is private would name the project in the filter and the per-client
  // rollup. Two readers see it named, and the report asks for each of them by name rather than for
  // whatever `canViewProject` happens to allow: **its own people** (a project role, or a lead of
  // the owning team) and the **one** reader D30 added, a `pjm:portfolio` holder over its team. That
  // second reader is reading a private project they are none of the people of, so the report leaves
  // the same trail the project's own pages leave (Q25).
  const factsOf = new Map(all.map((project) => [project.id, workFactsOf(project)]));
  const isOneOfItsPeople = (project: (typeof all)[number]) => viewer.projectRoles.has(project.id) || viewer.teamRoles.get(project.teamId) === "lead";
  const byPortfolio = all.filter((project) => readsPrivateByPortfolio(viewer, factsOf.get(project.id)!));
  const namedIds = new Set([...all.filter((project) => project.visibility !== "private" || isOneOfItsPeople(project)).map((project) => project.id), ...byPortfolio.map((project) => project.id)]);
  await notePrivateProjectReads(viewer, byPortfolio.map((project) => factsOf.get(project.id)!));
  const unnamed = (project: (typeof all)[number]) => !namedIds.has(project.id);
  const clientsOffered = [...new Map(all.flatMap((project) => (!unnamed(project) && project.clientId && project.clientName ? [[project.clientId, { id: project.clientId, name: project.clientName }] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const projects = filter.clientId ? all.filter((project) => project.clientId === filter.clientId && !unnamed(project)) : all;
  const period = { from: filter.from, to: filter.to };
  const empty: ProfitabilityView = { period, projects: [], privateProjects: null, clients: [], total: { feeVnd: null, costVnd: 0, marginVnd: null, marginRate: null, hours: 0, estimated: false }, clientsOffered };
  if (projects.length === 0) return empty;

  const ids = projects.map((project) => project.id);
  const [time, fees, holders, positions, teams] = await Promise.all([loggedMinutesByProjectPersonMonth(ids, period), feesByProject(ids, period), listPositionHolders(filter.to), listPositions(), listTeams()]);
  const periodMonths = monthsBetween(filter.from.slice(0, 7), filter.to.slice(0, 7));
  const personIds = [...new Set(time.map((line) => line.personId))];
  const rates = await loadedCostRates(reader.principal, { personIds, fromMonth: monthMinus(periodMonths[0], RATE_LOOKBACK_MONTHS), toMonth: todayInVietnam().slice(0, 7) });

  const positionOf = new Map(holders.map((holder) => [holder.personId, holder.positionId]));
  const positionName = new Map(positions.map((position) => [position.id, position.name]));
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const lines: TimeLine[] = time.map((line) => ({ projectId: line.projectId, personId: line.personId, month: line.month, minutes: line.minutes, teamKey: line.teamId ?? "", roleKey: positionOf.get(line.personId) ?? "" }));
  // Private projects roll up under a group of their own, which the per-client lines leave out (they
  // are the "private projects" line); the total still counts them.
  const result = profitability({ projects: projects.map((project) => ({ projectId: project.id, clientId: unnamed(project) ? PRIVATE_GROUP : project.clientId, fee: fees.get(project.id)! })), time: lines, rates, periodMonths });

  // The team whose task the time was logged on (time on the project itself has none: "other").
  const groupName = (kind: "team" | "role", key: string): string | null => (key === OTHER_GROUP || key === "" ? null : kind === "team" ? (teamName.get(key) ?? null) : (positionName.get(key) ?? null));
  const byId = new Map(projects.map((project) => [project.id, project]));
  const named = result.projects.filter((row) => !unnamed(byId.get(row.projectId)!));
  const hidden = result.projects.filter((row) => unnamed(byId.get(row.projectId)!));
  const sumMargin = (rows: typeof result.projects) => {
    const withFee = rows.filter((row) => row.feeVnd !== null);
    const feeVnd = withFee.length ? withFee.reduce((total, row) => total + (row.feeVnd ?? 0), 0) : null;
    const costVnd = rows.reduce((total, row) => total + row.costVnd, 0);
    return { feeVnd, costVnd, marginVnd: feeVnd === null ? null : feeVnd - costVnd, marginRate: feeVnd ? (feeVnd - costVnd) / feeVnd : null };
  };
  const clientName = new Map(projects.map((project) => [project.clientId, project.clientName]));

  return {
    period,
    projects: named
      .map((row): ProjectLine => {
        const project = byId.get(row.projectId)!;
        return {
          id: project.id,
          name: project.name,
          jobNumber: project.jobNumber,
          teamName: project.teamName,
          clientId: project.clientId,
          clientName: project.clientName,
          basis: row.basis,
          feeVnd: row.feeVnd,
          costVnd: row.costVnd,
          marginVnd: row.marginVnd,
          marginRate: row.marginRate,
          hours: hours(row.minutes),
          unratedHours: hours(row.unratedMinutes),
          estimated: row.estimated,
          byTeam: row.byTeam.map((group) => ({ name: groupName("team", group.key), other: group.key === OTHER_GROUP, hours: hours(group.minutes), costVnd: group.costVnd })),
          byRole: row.byRole.map((group) => ({ name: groupName("role", group.key), other: group.key === OTHER_GROUP, hours: hours(group.minutes), costVnd: group.costVnd })),
        };
      })
      .filter((row) => row.hours > 0 || row.feeVnd !== null)
      .sort((a, b) => (a.marginVnd ?? Infinity) - (b.marginVnd ?? Infinity) || a.name.localeCompare(b.name, "vi")),
    privateProjects: hidden.length ? { projects: hidden.length, hours: hours(hidden.reduce((total, row) => total + row.minutes, 0)), estimated: hidden.some((row) => row.estimated), ...sumMargin(hidden) } : null,
    clients: result.clients.filter((client) => client.clientId !== PRIVATE_GROUP).map((client) => ({ clientId: client.clientId, clientName: client.clientId ? (clientName.get(client.clientId) ?? null) : null, projects: client.projects, hours: hours(client.minutes), estimated: client.estimated, feeVnd: client.feeVnd, costVnd: client.costVnd, marginVnd: client.marginVnd, marginRate: client.marginRate })),
    total: { feeVnd: result.total.feeVnd, costVnd: result.total.costVnd, marginVnd: result.total.marginVnd, marginRate: result.total.marginRate, hours: hours(result.total.minutes), estimated: result.total.estimated },
    clientsOffered,
  };
}

/** The screen's read: the figures, and an audit entry saying who read them. Null = not for this reader. */
export async function getProfitability(reader: ProfitabilityReader, filter: ProfitabilityFilter): Promise<ProfitabilityView | null> {
  const view = await buildProfitability(reader, filter);
  if (!view) return null;
  await recordAudit({
    action: "pjm.profitability.read",
    actor: { userId: reader.userId ?? null, personId: reader.person.id, email: reader.email ?? null },
    request: reader.request,
    resource: { type: "pjm_profitability", id: filter.clientId ?? "all" },
    summary: `${filter.from} → ${filter.to}: ${view.projects.length} projects`,
    after: { from: filter.from, to: filter.to, clientId: filter.clientId ?? null, projects: view.projects.length, privateProjects: view.privateProjects?.projects ?? 0 },
  });
  return view;
}
