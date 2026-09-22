// The workload view (FR-WRK-13): for the teams the viewer leads or administers, how full each
// member's coming weeks are — with approved leave and public holidays taken off their capacity.
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDaysOff } from "@/modules/attendance/service";
import { getLeaveOnDays } from "@/modules/leave/service";
import { workDirectory } from "./directory";
import { type AwayDay, type Week, weeksFrom, workload, type WorkloadRow } from "./engine/workload";
import { canAdminTeam, type WorkViewer } from "./policy";
import { WORK_KIND } from "./tasks";
import { teamFacts } from "./teams";

export const WORKLOAD_WEEKS = 6;

export type WorkloadPerson = { id: string; fullName: string; entityId: string | null; teamIds: string[] };
export type WorkloadView = { weeks: Week[]; teams: { id: string; name: string; key: string }[]; rows: WorkloadRow<WorkloadPerson>[]; daysOff: { date: IsoDate; name: string }[] };

/** Null when the viewer leads no team: there is nobody whose load is theirs to plan. */
export async function getWorkload(viewer: WorkViewer, today: IsoDate, options: { teamId?: string | null } = {}): Promise<WorkloadView | null> {
  const allTeams = (await workDirectory()).teams.filter((team) => team.isActive);
  const teams = allTeams.filter((team) => viewer.teamRoles.get(team.id) === "lead" || canAdminTeam(viewer, teamFacts(team)));
  if (teams.length === 0) return null;
  const chosen = options.teamId && teams.some((team) => team.id === options.teamId) ? teams.filter((team) => team.id === options.teamId) : teams;

  const members = await db()
    .select({ id: schema.person.id, fullName: schema.person.fullName, entityId: schema.person.primaryEntityId, teamId: schema.workTeamMember.teamId })
    .from(schema.workTeamMember)
    .innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId))
    .where(and(inArray(schema.workTeamMember.teamId, chosen.map((team) => team.id)), inArray(schema.person.status, ["active", "preboarding"])))
    .orderBy(asc(schema.person.searchName));
  const people = [...Map.groupBy(members, (row) => row.id).values()].map((own) => ({ id: own[0].id, fullName: own[0].fullName, entityId: own[0].entityId, teamIds: own.map((row) => row.teamId) }));
  const weeks = weeksFrom(today, WORKLOAD_WEEKS);
  const range = { from: weeks[0].start, to: weeks.at(-1)!.end };
  if (people.length === 0) return { weeks, teams: teams.map(({ id, name, key }) => ({ id, name, key })), rows: [], daysOff: [] };
  const personIds = people.map((person) => person.id);

  // Every open work task of a member counts, whichever team or project it sits in — a private
  // project the lead cannot open still takes the person's hours. Only numbers leave this function.
  const [tasks, leave, ...calendars] = await Promise.all([
    db()
      .select({ assigneePersonId: schema.task.assigneePersonId, startDate: schema.task.startDate, dueDate: schema.task.dueDate, estimateMinutes: schema.task.estimateMinutes })
      .from(schema.task)
      .where(and(eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress"]), isNotNull(schema.task.assigneePersonId), inArray(schema.task.assigneePersonId, personIds))),
    getLeaveOnDays(personIds, range.from, range.to),
    ...[...new Set(people.map((person) => person.entityId))].map(async (entityId) => [entityId, await getDaysOff(entityId, range.from, addDays(range.to, 0))] as const),
  ]);
  const offByEntity = new Map(calendars.map(([entityId, days]) => [entityId, new Set(days.map((day) => day.date))]));
  // The leave module tells us the type; the view must not. Keep the date and the portion only.
  const away: AwayDay[] = leave.map((day) => ({ personId: day.personId, date: day.date, days: Math.min(1, day.amountCenti / 100) }));

  const rows = workload({ people, tasks: tasks.map((task) => ({ ...task, assigneePersonId: task.assigneePersonId! })), away, daysOff: (person) => offByEntity.get(person.entityId) ?? new Set(), weeks, today });
  const named = new Map(calendars.flatMap(([, days]) => days.map((day) => [day.date, day.name] as const)));
  return { weeks, teams: teams.map(({ id, name, key }) => ({ id, name, key })), rows, daysOff: [...named].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date)) };
}
