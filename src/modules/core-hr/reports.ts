// HR reports (FR-RPT-02, headcount subset). Permission `report:read`, scoped by where the viewer
// holds it: an entity director counts their entity, a department head their department. Only
// aggregates of personal-tier facts (gender, age) leave this file; the two lists (contracts
// running out, people on probation) carry what the people list already shows a report reader.
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { permissionReach, type Principal, reachesNothing, type TierReach } from "@/modules/platform/rbac/policy";
import { unitsWithin } from "@/modules/platform/rbac/reach-sql";
import { headcountSnapshot, type HeadcountSnapshot, movement, type Movement, type Span } from "./engine/headcount";

export type HeadcountFilters = { asOf: IsoDate; from: IsoDate; to: IsoDate; entityId?: string };
export type ContractDue = { personId: string; fullName: string; employeeCode: string; entity: string; department: string | null; type: string; endDate: IsoDate };
export type HeadcountReport = { snapshot: HeadcountSnapshot; movement: Movement; contractsExpiring: ContractDue[]; probations: ContractDue[]; /** The viewer sees a slice, not the whole group. */ scoped: boolean };

const EXPIRY_WINDOW_DAYS = 90;

// An employment with the primary assignment in force on the report date — or, for someone who
// has left or not started, the one they left with / will start with.
function spansOn(asOf: IsoDate) {
  const e = schema.employment;
  const a = db()
    .select()
    .from(schema.assignment)
    .where(and(eq(schema.assignment.employmentId, e.id), eq(schema.assignment.kind, "primary"), sql`${schema.assignment.validFrom} <= greatest(least(${asOf}::date, coalesce(${e.endDate}, ${asOf}::date)), ${e.startDate})`))
    .orderBy(desc(schema.assignment.validFrom))
    .limit(1)
    .as("a");
  return { e, a };
}

// `unitIds`: the reach's units widened to everything below them (`unitsWithin`).
function within(reach: TierReach, { entityId, orgUnitId }: { entityId: SQLWrapper; orgUnitId: SQLWrapper }, unitIds: readonly string[]): SQL | undefined {
  if (reach.all) return undefined;
  return or(reach.entityIds.length ? inArray(entityId, reach.entityIds) : undefined, unitIds.length ? inArray(orgUnitId, [...unitIds]) : undefined) ?? sql`false`;
}

/** null = the viewer holds `report:read` nowhere. */
export async function getHeadcountReport(principal: Principal, filters: HeadcountFilters): Promise<HeadcountReport | null> {
  const reach = permissionReach(principal, "report:read");
  if (reachesNothing(reach)) return null;
  const { e, a } = spansOn(filters.asOf);
  const scope = and(within(reach, { entityId: e.entityId, orgUnitId: a.orgUnitId }, reach.all ? [] : await unitsWithin(reach.unitIds)), filters.entityId ? eq(e.entityId, filters.entityId) : undefined);

  const rows = await db()
    .select({
      personId: e.personId,
      startDate: e.startDate,
      endDate: e.endDate,
      seniorityDate: e.seniorityDate,
      entity: schema.entity.shortName,
      department: schema.orgUnit.name,
      workforceType: a.workforceType,
      gender: schema.personProfile.gender,
      dateOfBirth: schema.personProfile.dateOfBirth,
    })
    .from(e)
    .innerJoin(schema.entity, eq(schema.entity.id, e.entityId))
    .leftJoinLateral(a, sql`true`)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, a.departmentId))
    .leftJoin(schema.personProfile, eq(schema.personProfile.personId, e.personId))
    .where(scope);
  const spans: Span[] = rows;

  const until = addDays(filters.asOf, EXPIRY_WINDOW_DAYS);
  const c = schema.contract;
  const due = await db()
    .select({ personId: e.personId, fullName: schema.person.fullName, employeeCode: e.employeeCode, entity: schema.entity.shortName, department: schema.orgUnit.name, type: c.type, endDate: c.endDate })
    .from(c)
    .innerJoin(e, eq(e.id, c.employmentId))
    .innerJoin(schema.person, eq(schema.person.id, e.personId))
    .innerJoin(schema.entity, eq(schema.entity.id, e.entityId))
    .leftJoinLateral(a, sql`true`)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, a.departmentId))
    .where(and(scope, isNull(c.deletedAt), isNull(c.terminatedOn), isNull(e.endDate), gte(c.endDate, filters.asOf), or(eq(c.type, "probation"), lte(c.endDate, until)), inArray(c.type, ["probation", "fixed_term", "service", "internship"])))
    .orderBy(asc(c.endDate));
  const lists = due.flatMap((row) => (row.endDate ? [{ ...row, endDate: row.endDate }] : []));

  return {
    snapshot: headcountSnapshot(spans, filters.asOf),
    movement: movement(spans, filters.from, filters.to),
    contractsExpiring: lists.filter((row) => row.type !== "probation"),
    probations: lists.filter((row) => row.type === "probation"),
    scoped: !reach.all,
  };
}
