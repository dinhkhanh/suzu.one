// Utilisation (FR-PJM-61): hours logged ÷ hours available per person and week, and the billable
// share, for the people above them — each lead for their teams' people, each line manager for their
// reports (`listOverseen`, the list form of `canViewUtilisation`). A viewer with `work:manage`
// also sees the teams in their scope that they do not lead, as team totals only: there is no
// company-wide list of individuals to rank.
//
// `work:manage`, not `pjm:portfolio` — how busy a team was is a figure about people, like the
// report and timesheet compliance beside it (reports/pjm-policy.ts), and since 2026-09-23
// `pjm:portfolio` is also finance's way into project pages. Whoever runs the team reads its hours.
//
// Available hours come from the same records the workload view reads — the work schedule and the
// calendar (attendance's day plans), and approved leave — and never from the time entries.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDayPlans } from "@/modules/attendance/service";
import { getLeaveOnDays } from "@/modules/leave/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { listTeams } from "@/modules/work/service";
import { foldSmallGroups } from "./engine/privacy";
import { lastWeeks, personWeeks, type PlanKind, type ScheduledDay, totalOf, type Utilisation } from "./engine/utilisation";
import { listOverseen, loadReportReader, loadSubjects } from "./people";
import { canViewUtilisation } from "./policy";
import { loggedMinutesByPersonWeek } from "./totals";

export const UTILISATION_WEEKS = 8;

export type UtilisationPerson = { personId: string; name: string; weeks: Utilisation[] };
export type UtilisationGroup =
  | { kind: "team"; teamId: string; name: string; people: UtilisationPerson[]; total: Utilisation[] }
  | { kind: "reports"; people: UtilisationPerson[]; total: Utilisation[] }
  /** A team in the viewer's `work:manage` scope that they do not lead: its totals, no people. */
  | { kind: "portfolio"; teamId: string; name: string; headcount: number; total: Utilisation[] }
  /** Teams too small to stand on their own (engine/privacy.ts), added together: the page names them "other teams". */
  | { kind: "portfolio_other"; teams: number; headcount: number; total: Utilisation[] };
export type UtilisationView = { weeks: IsoDate[]; groups: UtilisationGroup[] };

/** Each person's weeks, in a fixed number of queries. */
export async function utilisationOfPeople(personIds: readonly string[], weeks: readonly IsoDate[], today: IsoDate): Promise<Map<string, Utilisation[]>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, Utilisation[]>();
  if (ids.length === 0 || weeks.length === 0) return result;
  const from = weeks[0];
  const to = addDays(weeks.at(-1)!, 6);
  const [plans, leave, logged] = await Promise.all([getDayPlans(ids, from, to), getLeaveOnDays(ids, from, to), loggedMinutesByPersonWeek(ids, weeks)]);
  const leaveOn = new Map<string, number>();
  for (const day of leave) leaveOn.set(`${day.personId}:${day.date}`, (leaveOn.get(`${day.personId}:${day.date}`) ?? 0) + day.amountCenti);
  for (const personId of ids) {
    const days: ScheduledDay[] = (plans.get(personId)?.days ?? []).map((plan) => ({ date: plan.date, kind: plan.kind as PlanKind, requiredMinutes: plan.requiredMinutes, leaveCenti: leaveOn.get(`${personId}:${plan.date}`) ?? 0 }));
    result.set(personId, personWeeks(weeks, days, logged.get(personId) ?? new Map(), today));
  }
  return result;
}

/** The teams a `work:manage` holder sees as totals: active, in their scope, not led by them. */
async function portfolioTeams(principal: Principal, ledTeamIds: ReadonlySet<string>): Promise<{ id: string; name: string; personIds: string[] }[]> {
  const teams = (await listTeams()).filter((team) => team.isActive && !ledTeamIds.has(team.id) && can(principal, "work:manage", { entityId: team.entityId, unitPath: team.departmentId ? [team.departmentId] : [] }));
  if (teams.length === 0) return [];
  const members = await db()
    .select({ teamId: schema.workTeamMember.teamId, personId: schema.workTeamMember.personId })
    .from(schema.workTeamMember)
    .innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId))
    .where(and(inArray(schema.workTeamMember.teamId, teams.map((team) => team.id)), eq(schema.person.status, "active")));
  const byTeam = Map.groupBy(members, (row) => row.teamId);
  return teams.map((team) => ({ id: team.id, name: team.name, personIds: (byTeam.get(team.id) ?? []).map((row) => row.personId) })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

export async function getUtilisation(viewer: { personId: string; principal: Principal }, today: IsoDate, count = UTILISATION_WEEKS): Promise<UtilisationView> {
  const weeks = lastWeeks(today, count);
  const reader = await loadReportReader(viewer.personId);
  const [overseen, portfolio] = await Promise.all([listOverseen(reader), portfolioTeams(viewer.principal, reader.ledTeamIds)]);
  const named = [...new Set(overseen.flatMap((group) => group.personIds))];
  const subjects = await loadSubjects(named);
  // The list is the policy's: anyone it would refuse is dropped, whatever listed them.
  const visible = named.filter((personId) => {
    const subject = subjects.get(personId);
    return !!subject && canViewUtilisation(reader, subject);
  });
  // A team of one person is that person: the small ones are added together, and if even that would
  // be one person they are left out (security review, finding 22). The reader's own teams are theirs.
  const folded = foldSmallGroups(portfolio.map((team) => ({ key: team.id, personIds: team.personIds })), new Set());
  const shownTeams = portfolio.filter((team) => folded.kept.includes(team.id));
  const otherPeople = folded.other?.personIds ?? [];
  const numbers = await utilisationOfPeople([...visible, ...shownTeams.flatMap((team) => team.personIds), ...otherPeople], weeks, today);
  const person = (personId: string): UtilisationPerson => ({ personId, name: subjects.get(personId)!.fullName, weeks: numbers.get(personId)! });
  const totals = (people: readonly UtilisationPerson[]) => weeks.map((_, index) => totalOf(people.map((row) => row.weeks[index])));
  const groups: UtilisationGroup[] = [];
  for (const group of overseen) {
    const people = group.personIds
      .filter((personId) => visible.includes(personId))
      .map(person)
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    if (people.length === 0) continue;
    groups.push(group.kind === "team" ? { kind: "team", teamId: group.teamId, name: group.name, people, total: totals(people) } : { kind: "reports", people, total: totals(people) });
  }
  // Summed here, on the server: the page receives a team's numbers and never its people's.
  const totalsOf = (personIds: readonly string[]) => weeks.map((_, index) => totalOf(personIds.map((personId) => numbers.get(personId)![index])));
  for (const team of shownTeams) {
    if (team.personIds.length === 0) continue;
    groups.push({ kind: "portfolio", teamId: team.id, name: team.name, headcount: team.personIds.length, total: totalsOf(team.personIds) });
  }
  if (folded.other) groups.push({ kind: "portfolio_other", teams: folded.other.keys.length, headcount: otherPeople.length, total: totalsOf(otherPeople) });
  return { weeks, groups };
}
