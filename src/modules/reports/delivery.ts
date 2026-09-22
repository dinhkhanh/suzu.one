// The delivery dashboards (FR-PJM-60): portfolio health and stale updates, milestone slip, on-time
// delivery, accepted vs promised, hours burn, retainers, revision rounds (internal vs client),
// returned hand-offs and hand-off wait, blocked time, and EOD-report and timesheet compliance.
//
// **Scope.** Exactly the projects the reader may open: the rows come from the portfolio
// (`listPortfolio` → `visibleProjects`, the work policy), so a team lead sees their teams'
// projects, a `pjm:portfolio` holder the non-private projects of their scope, and nobody a project
// they could not open. Every other figure is counted in SQL for those project ids only. Compliance
// is about people, not projects: it covers the teams the reader leads and, under `pjm:portfolio`,
// the teams of their scope — as team totals, never a list of names to rank.
//
// Fees and money budgets are not here at all (hours only), so the dashboard needs no
// `pjm:commercial` split; profitability is its own screen behind `pjm:cost`.
import "server-only";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { daysOf, loadReportReader, weekStartOf } from "@/modules/daily/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { PersonRow } from "@/modules/platform/people/service";
import { listPortfolio, type PortfolioRow } from "@/modules/projects/service";
import { listTeams, loadViewer } from "@/modules/work/service";
import { addCompliance, type Compliance, type DeliverySummary, EMPTY_BLOCKED, EMPTY_HANDOFFS, EMPTY_MILESTONES, EMPTY_ON_TIME, EMPTY_REVISIONS, type Health, type ProjectDeliveryFacts, reportCompliance, type RetainerSummary, summariseDelivery, summariseRetainers, timesheetCompliance } from "./engine/delivery";
import { activeMembersByTeam, blockedCountsByProject, handoffCountsByProject, milestoneCountsByProject, onTimeCountsByProject, revisionCountsByProject, submittedReportDates, submittedTimesheetWeeks } from "./pjm-queries";
import { complianceTeamIds } from "./pjm-policy";
import { loadRetainerFacts } from "./retainer-source";

export type DeliveryReader = { person: Pick<PersonRow, "id" | "primaryEntityId">; principal: Principal };
export type DeliveryFilter = { from: IsoDate; to: IsoDate; teamId?: string | null };

export type TeamCompliance = { teamId: string; name: string; people: number; reports: Compliance; timesheets: Compliance };
export type DeliveryDashboard = {
  period: { from: IsoDate; to: IsoDate };
  today: IsoDate;
  total: DeliverySummary;
  byTeam: { teamId: string; name: string; summary: DeliverySummary }[];
  /** The teams the filter bar may offer: those with a project the reader sees. */
  teams: { id: string; name: string }[];
  /** Projects to look at first: stale updates, off track, milestones slipped or overdue. */
  attention: { id: string; name: string; teamName: string; health: Health | null; stale: boolean; overdueMilestones: number; slippedMilestones: number }[];
  /** null when the projects module does not expose retainer consumption yet (see retainer-source.ts). */
  retainers: RetainerSummary | null;
  /** null when the reader leads no team and holds no `pjm:portfolio`. */
  compliance: { teams: TeamCompliance[]; total: { reports: Compliance; timesheets: Compliance } } | null;
};

/** The month so far: the period the dashboard opens on. */
export const defaultDeliveryPeriod = (today: IsoDate = todayInVietnam()): { from: IsoDate; to: IsoDate } => ({ from: `${today.slice(0, 8)}01`, to: today });

/** Compliance reads every person's calendar day by day; a quarter is plenty and keeps it quick. */
export const COMPLIANCE_MAX_DAYS = 92;

/** Is the project still running (health and staleness only mean something while it is)? */
const isLive = (row: PortfolioRow) => row.status !== "done" && row.status !== "archived" && row.status !== "cancelled";

export async function getDeliveryDashboard(reader: DeliveryReader, filter: DeliveryFilter, today: IsoDate = todayInVietnam()): Promise<DeliveryDashboard> {
  const period = { from: filter.from, to: filter.to };
  const viewer = await loadViewer({ person: { id: reader.person.id, primaryEntityId: reader.person.primaryEntityId }, principal: reader.principal });
  // Done projects stay in: work finished this month on a project closed this month still counts.
  const visible = await listPortfolio(viewer, { today, includeDone: true });
  const teams = [...new Map(visible.map((row) => [row.teamId, { id: row.teamId, name: row.teamName }])).values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const rows = filter.teamId ? visible.filter((row) => row.teamId === filter.teamId) : visible;
  const ids = rows.map((row) => row.id);

  const [milestones, onTime, revisions, handoffs, blocked, retainers, compliance] = await Promise.all([
    milestoneCountsByProject(ids, today),
    onTimeCountsByProject(ids, period),
    revisionCountsByProject(ids, period),
    handoffCountsByProject(ids, period),
    blockedCountsByProject(ids, period),
    loadRetainerFacts(rows.filter((row) => row.kind === "retainer").map((row) => row.id), period),
    getCompliance(reader, filter, today),
  ]);

  const facts: ProjectDeliveryFacts[] = rows.map((row) => ({
    projectId: row.id,
    teamId: row.teamId,
    // Health and staleness describe running projects; a finished one is neither on track nor stale.
    health: isLive(row) ? row.health : null,
    stale: isLive(row) && row.stale,
    milestones: milestones.get(row.id) ?? EMPTY_MILESTONES,
    onTime: onTime.get(row.id) ?? EMPTY_ON_TIME,
    register: { promised: row.register.promised, accepted: row.register.accepted },
    burn: { loggedMinutes: row.burn.loggedMinutes, budgetMinutes: row.burn.budgetMinutes, level: row.burn.level },
    revisions: revisions.get(row.id) ?? EMPTY_REVISIONS,
    handoffs: handoffs.get(row.id) ?? EMPTY_HANDOFFS,
    blocked: blocked.get(row.id) ?? EMPTY_BLOCKED,
  }));
  // The health distribution counts running projects only; the other figures count every row.
  const live = new Set(rows.filter(isLive).map((row) => row.id));
  const summarise = (subset: ProjectDeliveryFacts[]) => {
    const summary = summariseDelivery(subset);
    summary.health.none = subset.filter((row) => live.has(row.projectId) && row.health === null).length;
    return summary;
  };

  const attention = rows
    .filter(isLive)
    .map((row) => ({ id: row.id, name: row.name, teamName: row.teamName, health: row.health, stale: row.stale, overdueMilestones: milestones.get(row.id)?.overdue ?? 0, slippedMilestones: milestones.get(row.id)?.slipped ?? 0 }))
    .filter((row) => row.stale || row.health === "off_track" || row.health === "at_risk" || row.overdueMilestones > 0)
    .sort((a, b) => Number(b.health === "off_track") - Number(a.health === "off_track") || b.overdueMilestones - a.overdueMilestones || Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name, "vi"))
    .slice(0, 12);

  return {
    period,
    today,
    total: summarise(facts),
    byTeam: [...Map.groupBy(facts, (row) => row.teamId)].map(([teamId, subset]) => ({ teamId, name: teams.find((team) => team.id === teamId)?.name ?? "—", summary: summarise(subset) })).sort((a, b) => a.name.localeCompare(b.name, "vi")),
    teams,
    attention,
    retainers: retainers ? summariseRetainers(retainers) : null,
    compliance,
  };
}

/**
 * EOD-report and timesheet compliance for the teams the reader oversees, over the period's days up
 * to yesterday (today's report is not late yet), capped at `COMPLIANCE_MAX_DAYS` back from its end.
 */
async function getCompliance(reader: DeliveryReader, filter: DeliveryFilter, today: IsoDate): Promise<DeliveryDashboard["compliance"]> {
  const [readerTeams, allTeams] = await Promise.all([loadReportReader(reader.person.id), listTeams()]);
  const active = allTeams.filter((team) => team.isActive && (!filter.teamId || team.id === filter.teamId));
  const teamIds = complianceTeamIds(reader.principal, readerTeams.ledTeamIds, active);
  if (teamIds.length === 0) return null;
  const until = filter.to < today ? filter.to : addDays(today, -1);
  const earliest = addDays(until, -(COMPLIANCE_MAX_DAYS - 1));
  const from = filter.from > earliest ? filter.from : earliest;
  const members = await activeMembersByTeam(teamIds);
  const people = [...new Set([...members.values()].flat())];
  const empty = { due: 0, met: 0, rate: null } satisfies Compliance;
  if (people.length === 0 || until < from) {
    const teams = teamIds.map((teamId) => ({ teamId, name: active.find((team) => team.id === teamId)!.name, people: members.get(teamId)?.length ?? 0, reports: empty, timesheets: empty }));
    return { teams, total: { reports: empty, timesheets: empty } };
  }

  // Whole weeks: a timesheet week is judged on all seven of its days.
  const firstWeek = weekStartOf(from);
  const weeks: IsoDate[] = [];
  for (let week = firstWeek; addDays(week, 6) <= until; week = addDays(week, 7)) if (week >= from || addDays(week, 6) >= from) weeks.push(week);
  const [days, reports, timesheets] = await Promise.all([daysOf(people, firstWeek, until), submittedReportDates(people, { from, to: until }), submittedTimesheetWeeks(people, weeks)]);

  const ofPerson = new Map<string, { reports: Compliance; timesheets: Compliance }>();
  for (const personId of people) {
    const own = days.get(personId) ?? new Map();
    const submitted = reports.get(personId) ?? new Set<IsoDate>();
    const reportDays = [...own.values()].filter((day) => day.day.date >= from).map((day) => ({ required: day.report.required, submitted: submitted.has(day.day.date) }));
    const sheetWeeks = weeks.map((week) => {
      const weekDays = [...own.values()].filter((day) => day.day.date >= week && day.day.date <= addDays(week, 6));
      const rules = weekDays[0]?.rules;
      const due = !!rules?.timesheetApproval && rules.timeMode !== "off" && weekDays.some((day) => !day.dayOff);
      return { due, submitted: timesheets.has(`${personId}:${week}`) };
    });
    ofPerson.set(personId, { reports: reportCompliance(reportDays), timesheets: timesheetCompliance(sheetWeeks) });
  }
  const teams = teamIds
    .map((teamId): TeamCompliance => {
      const own = (members.get(teamId) ?? []).map((personId) => ofPerson.get(personId)!);
      return { teamId, name: active.find((team) => team.id === teamId)!.name, people: own.length, reports: addCompliance(own.map((row) => row.reports)), timesheets: addCompliance(own.map((row) => row.timesheets)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  // A person in two teams counts once in the total.
  const everyone = [...ofPerson.values()];
  return { teams, total: { reports: addCompliance(everyone.map((row) => row.reports)), timesheets: addCompliance(everyone.map((row) => row.timesheets)) } };
}

// ── The owner dashboard's tile (FR-RPT-01 + FR-PJM-60) ──────────────────────────────────────

export type DeliveryTile = { projects: number; health: Record<Health | "none", number>; stale: number; overdueMilestones: number };

/** Health and overdue milestones of the running projects the reader may open; null when there are none. */
export async function getDeliveryTile(reader: DeliveryReader, today: IsoDate = todayInVietnam()): Promise<DeliveryTile | null> {
  const viewer = await loadViewer({ person: { id: reader.person.id, primaryEntityId: reader.person.primaryEntityId }, principal: reader.principal });
  const rows = (await listPortfolio(viewer, { today })).filter(isLive);
  if (rows.length === 0) return null;
  const milestones = await milestoneCountsByProject(rows.map((row) => row.id), today);
  const health = { on_track: 0, at_risk: 0, off_track: 0, none: 0 };
  for (const row of rows) health[row.health ?? "none"] += 1;
  return { projects: rows.length, health, stale: rows.filter((row) => row.stale).length, overdueMilestones: [...milestones.values()].reduce((sum, row) => sum + row.overdue, 0) };
}
