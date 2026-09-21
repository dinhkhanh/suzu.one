// The team leave calendar (FR-LVE-05): who is away when. Everyone sees their own group (team, or
// department within the entity); managers their reports; HR and department heads their scope.
// Why someone is away is personal-tier — see `seesLeaveTypeOf`.
import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDayPlans } from "@/modules/attendance/service";
import { matchesReach, permissionReach, type Principal, tierReach } from "@/modules/platform/rbac/policy";
import type { Portion } from "./engine/request";
import { seesLeaveTypeOf } from "./policy";

export type CalendarCell = { date: IsoDate; portion: Portion; status: "pending" | "approved"; /** null = the viewer sees only that the person is away. */ typeName: string | null; typeCode: string | null };
export type CalendarPerson = { personId: string; fullName: string; departmentName: string | null; isSelf: boolean; cells: CalendarCell[] };
export type TeamCalendar = { dates: { date: IsoDate; kind: string }[]; people: CalendarPerson[]; departments: { id: string; name: string }[] };

export async function getTeamCalendar(viewer: { personId: string; principal: Principal }, range: { from: IsoDate; to: IsoDate; departmentId?: string | null }): Promise<TeamCalendar> {
  const rows = await db()
    .select({ person: schema.person, departmentName: schema.orgUnit.name })
    .from(schema.person)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId))
    .where(eq(schema.person.status, "active"));
  const me = rows.find((row) => row.person.id === viewer.personId)?.person;
  const hrReach = permissionReach(viewer.principal, "leave:manage");
  const personalReach = tierReach(viewer.principal, "personal");
  const target = (person: typeof schema.person.$inferSelect) => ({ personId: person.id, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId });
  // Collaborators have no directory: they see themselves only.
  const sameGroup = (person: typeof schema.person.$inferSelect) =>
    !!me && viewer.principal.workforceType !== "collaborator" && (me.teamId ? person.teamId === me.teamId : !!me.departmentId && person.departmentId === me.departmentId && person.primaryEntityId === me.primaryEntityId);
  const visible = rows.filter(({ person }) => person.id === viewer.personId || sameGroup(person) || person.managerId === viewer.personId || matchesReach(hrReach, target(person)) || matchesReach(personalReach, target(person)));
  const departments = [...new Map(visible.flatMap((row) => (row.person.departmentId && row.departmentName ? [[row.person.departmentId, { id: row.person.departmentId, name: row.departmentName }] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
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
  const inRange = days.filter((row) => row.status === "approved" || row.approvalStatus === "pending" || row.approvalStatus === "returned");

  const plans = (await getDayPlans([viewer.personId], range.from, range.to)).get(viewer.personId)?.days ?? [];
  const people = shown
    .map(({ person, departmentName }) => {
      const detailed = seesLeaveTypeOf(viewer.principal, target(person));
      const cells = inRange
        .filter((row) => row.day.personId === person.id && (detailed || row.status === "approved"))
        .map((row) => ({ date: row.day.date, portion: row.day.portion, status: row.status as "pending" | "approved", typeName: detailed ? row.typeName : null, typeCode: detailed ? row.typeCode : null }));
      return { personId: person.id, fullName: person.fullName, departmentName, isSelf: person.id === viewer.personId, cells };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.fullName.localeCompare(b.fullName, "vi"));
  return { dates: plans.map((plan) => ({ date: plan.date, kind: plan.kind })), people, departments };
}
