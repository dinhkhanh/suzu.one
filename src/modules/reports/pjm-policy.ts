// Who may read the PJM reports (FR-PJM-60, 63). Pure.
//
// - **Delivery dashboards** need no permission, like the work analytics: what they count is the
//   projects the reader may already open (`visibleProjects`, the work policy), so a person on
//   nothing sees an empty dashboard, and `pjm:portfolio` widens the set exactly as it widens the
//   portfolio. Compliance (EOD reports, timesheets) is about people, not projects: it covers the
//   teams the reader leads, and — as team totals only — the teams under their `pjm:portfolio` grant.
// - **Profitability** is salary-derived: `pjm:cost` (owner, C-level, finance), and per project only
//   where the reader holds both `pjm:cost` and `pjm:commercial` over the project's entity — a cost
//   without its fee, or a fee without its cost, is not a margin. Never a line manager, a department
//   head or an entity director (who hold neither `pjm:cost` nor compensation reach).
import { can, type Principal } from "../platform/rbac/policy";

/** The delivery dashboard itself: anybody signed in; each figure is scoped by what they may open. */
export const canOpenDelivery = (principal: Principal): boolean => principal.personId !== null;

type TeamPlace = { id: string; entityId: string | null; departmentId: string | null };
const scopeOf = (team: TeamPlace) => ({ entityId: team.entityId, unitPath: team.departmentId ? [team.departmentId] : [] });

/** The teams whose EOD-report and timesheet compliance the reader sees (as totals, never a list of people). */
export function complianceTeamIds(principal: Principal, ledTeamIds: ReadonlySet<string>, teams: readonly TeamPlace[]): string[] {
  return teams.filter((team) => ledTeamIds.has(team.id) || can(principal, "pjm:portfolio", scopeOf(team))).map((team) => team.id);
}

/** The profitability screen and its entry in navigation: `pjm:cost` somewhere. The page re-checks per project. */
export const canReadProfitability = (principal: Principal): boolean => can(principal, "pjm:cost");

/** One project's margin: cost *and* fee over the project's entity. A project with no entity takes a group-wide grant. */
export const canSeeProfitabilityOf = (principal: Principal, project: { entityId: string | null }): boolean => can(principal, "pjm:cost", { entityId: project.entityId }) && can(principal, "pjm:commercial", { entityId: project.entityId });
