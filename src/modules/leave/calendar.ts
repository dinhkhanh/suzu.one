// The team leave calendar (FR-LVE-05): who is away when. Everyone sees their own group (team, or
// department within the entity); managers their reports; HR and department heads their scope.
// Why someone is away is personal-tier — see `seesLeaveTypeOf`.
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDayPlans } from "@/modules/attendance/service";
import { matchesReach, permissionReach, type Principal, reachesNothing, type TierReach, tierReach } from "@/modules/platform/rbac/policy";
import { personInReachSql } from "@/modules/platform/rbac/reach-sql";
import type { Portion } from "./engine/request";
import { seesLeaveTypeOf } from "./policy";

export type CalendarCell = { date: IsoDate; portion: Portion; status: "pending" | "approved"; /** null = the viewer sees only that the person is away. */ typeName: string | null; typeCode: string | null };
export type CalendarPerson = { personId: string; fullName: string; departmentName: string | null; isSelf: boolean; cells: CalendarCell[] };
export type TeamCalendar = { dates: { date: IsoDate; kind: string }[]; people: CalendarPerson[]; departments: { id: string; name: string }[] };

type PersonRow = typeof schema.person.$inferSelect;

// A reach as a clause: "all" admits everyone, null admits no one.
const reachClause = (reach: TierReach): SQL | "all" | null => (reach.all ? "all" : reachesNothing(reach) ? null : (personInReachSql(reach) ?? null));

/**
 * Who the viewer may see on the calendar, as a WHERE clause over `person` (undefined = everyone),
 * and the same rule as a predicate, kept as a guard over the rows the clause returned.
 */
async function calendarScope(viewer: { personId: string; principal: Principal }) {
  const active = eq(schema.person.status, "active");
  const [meRow] = await db()
    .select()
    .from(schema.person)
    .where(and(eq(schema.person.id, viewer.personId), active))
    .limit(1);
  const me = meRow as PersonRow | undefined;
  const hrReach = permissionReach(viewer.principal, "leave:manage");
  const personalReach = tierReach(viewer.principal, "personal");
  const target = (person: PersonRow) => ({ personId: person.id, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId });
  // Collaborators have no directory: they see themselves only.
  const inGroup = !!me && viewer.principal.workforceType !== "collaborator";
  const sameGroup = (person: PersonRow) => inGroup && (me!.teamId ? person.teamId === me!.teamId : !!me!.departmentId && person.departmentId === me!.departmentId && person.primaryEntityId === me!.primaryEntityId);
  const sameGroupSql = !inGroup
    ? undefined
    : me!.teamId
      ? eq(schema.person.teamId, me!.teamId)
      : me!.departmentId
        ? and(eq(schema.person.departmentId, me!.departmentId), me!.primaryEntityId ? eq(schema.person.primaryEntityId, me!.primaryEntityId) : isNull(schema.person.primaryEntityId))
        : undefined;
  const reaches = [reachClause(hrReach), reachClause(personalReach)];
  // Only the people the viewer may see are loaded; the predicate stays as a guard.
  const visibleSql = reaches.includes("all") ? undefined : or(eq(schema.person.id, viewer.personId), eq(schema.person.managerId, viewer.personId), sameGroupSql, ...reaches.filter((clause): clause is SQL => !!clause && clause !== "all"));
  const visible = (person: PersonRow) => person.id === viewer.personId || sameGroup(person) || person.managerId === viewer.personId || matchesReach(hrReach, target(person)) || matchesReach(personalReach, target(person));
  return { where: and(active, visibleSql), visible, target };
}

export async function getTeamCalendar(viewer: { personId: string; principal: Principal }, range: { from: IsoDate; to: IsoDate; departmentId?: string | null }): Promise<TeamCalendar> {
  // The viewer's own calendar does not depend on who is shown, so it is read alongside.
  const [scope, plansByPerson] = await Promise.all([calendarScope(viewer), getDayPlans([viewer.personId], range.from, range.to)]);
  const { target } = scope;
  const rows = await db().select({ person: schema.person, departmentName: schema.orgUnit.name }).from(schema.person).leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId)).where(scope.where);
  const visible = rows.filter(({ person }) => scope.visible(person));
  const departments = [...new Map(visible.flatMap((row) => (row.person.departmentId && row.departmentName ? [[row.person.departmentId, { id: row.person.departmentId, name: row.departmentName }] as const] : []))).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const shown = visible.filter((row) => !range.departmentId || row.person.departmentId === range.departmentId);

  const ids = shown.map((row) => row.person.id);
  const days = ids.length
    ? await db()
        .select({ day: schema.leaveRequestDay, status: schema.leaveRequest.status, approvalStatus: schema.approvalRequest.status, typeName: schema.leaveType.name, typeCode: schema.leaveType.code })
        .from(schema.leaveRequestDay)
        .innerJoin(schema.leaveRequest, eq(schema.leaveRequest.id, schema.leaveRequestDay.requestId))
        .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveRequest.leaveTypeId))
        .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.leaveRequest.approvalRequestId))
        .where(and(inArray(schema.leaveRequestDay.personId, ids), gte(schema.leaveRequestDay.date, range.from), lte(schema.leaveRequestDay.date, range.to), inArray(schema.leaveRequest.status, ["approved", "pending"])))
    : [];
  const cellsOf = new Map<string, typeof days>();
  for (const row of days) {
    if (!(row.status === "approved" || row.approvalStatus === "pending" || row.approvalStatus === "returned")) continue;
    const list = cellsOf.get(row.day.personId);
    if (list) list.push(row);
    else cellsOf.set(row.day.personId, [row]);
  }

  const plans = plansByPerson.get(viewer.personId)?.days ?? [];
  const people = shown
    .map(({ person, departmentName }) => {
      const detailed = seesLeaveTypeOf(viewer.principal, target(person));
      const cells = (cellsOf.get(person.id) ?? [])
        .filter((row) => detailed || row.status === "approved")
        .map((row) => ({ date: row.day.date, portion: row.day.portion, status: row.status as "pending" | "approved", typeName: detailed ? row.typeName : null, typeCode: detailed ? row.typeCode : null }));
      return { personId: person.id, fullName: person.fullName, departmentName, isSelf: person.id === viewer.personId, cells };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.fullName.localeCompare(b.fullName, "vi"));
  return { dates: plans.map((plan) => ({ date: plan.date, kind: plan.kind })), people, departments };
}

export type LeaveTakenByUnit = { departmentId: string | null; departmentName: string | null; people: number; daysCenti: number };

/**
 * Approved leave taken between two days by the people the viewer's calendar shows, per department —
 * counted by Postgres: how many people were away and how many days, never who or why (the type of
 * leave is personal tier). The same people as `getTeamCalendar`, by the same clause.
 */
export async function getLeaveTakenByUnit(viewer: { personId: string; principal: Principal }, range: { from: IsoDate; to: IsoDate }): Promise<LeaveTakenByUnit[]> {
  const scope = await calendarScope(viewer);
  const day = schema.leaveRequestDay;
  const rows = await db()
    .select({
      departmentId: schema.person.departmentId,
      departmentName: schema.orgUnit.name,
      people: sql<number>`count(distinct ${day.personId})::int`,
      daysCenti: sql<number>`coalesce(sum(${day.amountCenti}), 0)::int`,
    })
    .from(day)
    .innerJoin(schema.leaveRequest, eq(schema.leaveRequest.id, day.requestId))
    .innerJoin(schema.person, eq(schema.person.id, day.personId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId))
    .where(and(scope.where, eq(schema.leaveRequest.status, "approved"), gte(day.date, range.from), lte(day.date, range.to)))
    .groupBy(schema.person.departmentId, schema.orgUnit.name)
    .orderBy(desc(sql`sum(${day.amountCenti})`), asc(schema.orgUnit.name));
  return rows.map((row) => ({ ...row, people: Number(row.people), daysCenti: Number(row.daysCenti) }));
}
