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
export type ContractDue = { personId: string; fullName: string; employeeCode: string; entityId: string; entity: string; departmentId: string | null; department: string | null; type: string; endDate: IsoDate };
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

/**
 * What both the report and the dashboard's totals count over: the viewer's slice of the
 * employments (`spansOn`), the window of employments the figures can count, and the contracts
 * that are due. null = the viewer holds `report:read` nowhere.
 */
async function headcountScope(principal: Principal, filters: HeadcountFilters) {
  const reach = permissionReach(principal, "report:read");
  if (reachesNothing(reach)) return null;
  const { e, a } = spansOn(filters.asOf);
  const scope = and(within(reach, { entityId: e.entityId, orgUnitId: a.orgUnitId }, reach.all ? [] : await unitsWithin(reach.unitIds)), filters.entityId ? eq(e.entityId, filters.entityId) : undefined);

  // Only the employments the figures can count: on the books somewhere between the opening day
  // (the day before the period) and the report date or the day after the period, whichever is
  // later. Joiners and leavers of the period fall inside that window (an employment never ends
  // before it starts).
  const earliest = [filters.asOf, addDays(filters.from, -1)].sort()[0];
  const latest = [filters.asOf, addDays(filters.to, 1)].sort()[1];
  const until = addDays(filters.asOf, EXPIRY_WINDOW_DAYS);
  const c = schema.contract;
  return {
    reach,
    e,
    a,
    c,
    scope,
    spansWindow: and(scope, lte(e.startDate, latest), or(isNull(e.endDate), gte(e.endDate, earliest))),
    contractsDue: and(scope, isNull(c.deletedAt), isNull(c.terminatedOn), isNull(e.endDate), gte(c.endDate, filters.asOf), or(eq(c.type, "probation"), lte(c.endDate, until)), inArray(c.type, ["probation", "fixed_term", "service", "internship"])),
  };
}

/** null = the viewer holds `report:read` nowhere. */
export async function getHeadcountReport(principal: Principal, filters: HeadcountFilters): Promise<HeadcountReport | null> {
  const found = await headcountScope(principal, filters);
  if (!found) return null;
  const { reach, e, a, spansWindow } = found;
  const [rows, due] = await Promise.all([
    db()
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
      .where(spansWindow),
    contractLists(found),
  ]);
  const spans: Span[] = rows;
  return { snapshot: headcountSnapshot(spans, filters.asOf), movement: movement(spans, filters.from, filters.to), ...due, scoped: !reach.all };
}

/**
 * The report's two lists alone — contracts running out within 90 days of `asOf` and probations
 * still running — over the same slice and rules as `getHeadcountReport`, without counting anybody.
 * null = the viewer holds `report:read` nowhere.
 */
export async function listContractsDue(principal: Principal, asOf: IsoDate): Promise<{ contractsExpiring: ContractDue[]; probations: ContractDue[]; scoped: boolean } | null> {
  const found = await headcountScope(principal, { asOf, from: asOf, to: asOf });
  if (!found) return null;
  return { ...(await contractLists(found)), scoped: !found.reach.all };
}

/** The contracts due in a scope, split into the two lists the report shows. */
async function contractLists({ e, a, c, contractsDue }: NonNullable<Awaited<ReturnType<typeof headcountScope>>>): Promise<{ contractsExpiring: ContractDue[]; probations: ContractDue[] }> {
  const due = await db()
    .select({ personId: e.personId, fullName: schema.person.fullName, employeeCode: e.employeeCode, entityId: e.entityId, entity: schema.entity.shortName, departmentId: a.departmentId, department: schema.orgUnit.name, type: c.type, endDate: c.endDate })
    .from(c)
    .innerJoin(e, eq(e.id, c.employmentId))
    .innerJoin(schema.person, eq(schema.person.id, e.personId))
    .innerJoin(schema.entity, eq(schema.entity.id, e.entityId))
    .leftJoinLateral(a, sql`true`)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, a.departmentId))
    .where(contractsDue)
    .orderBy(asc(c.endDate));
  const lists = due.flatMap((row) => (row.endDate ? [{ ...row, endDate: row.endDate }] : []));
  return { contractsExpiring: lists.filter((row) => row.type !== "probation"), probations: lists.filter((row) => row.type === "probation") };
}

export type HeadcountTotals = { total: number; joiners: number; leavers: number; contractsExpiring: number; probations: number; scoped: boolean };

/**
 * The report's headline figures alone — for the owner dashboard's tile, which shows five numbers
 * and no breakdown. Counted by Postgres over the same rows `getHeadcountReport` reads (the same
 * slice, window and contract rules, from `headcountScope`), so the tile and the report cannot
 * disagree; nothing but the counts leaves the database. null = no `report:read` anywhere.
 */
export async function getHeadcountTotals(principal: Principal, filters: HeadcountFilters): Promise<HeadcountTotals | null> {
  const found = await headcountScope(principal, filters);
  if (!found) return null;
  const { reach, e, a, c, spansWindow, contractsDue } = found;
  const inPeriod = (column: typeof e.startDate | typeof e.endDate) => sql`${column} >= ${filters.from}::date and ${column} <= ${filters.to}::date`;
  const [[spans], [due]] = await Promise.all([
    db()
      .select({
        total: sql<number>`count(*) filter (where ${e.startDate} <= ${filters.asOf}::date and (${e.endDate} is null or ${e.endDate} >= ${filters.asOf}::date))::int`,
        joiners: sql<number>`count(*) filter (where ${inPeriod(e.startDate)})::int`,
        leavers: sql<number>`count(*) filter (where ${inPeriod(e.endDate)})::int`,
      })
      .from(e)
      .innerJoin(schema.entity, eq(schema.entity.id, e.entityId))
      .leftJoinLateral(a, sql`true`)
      .where(spansWindow),
    db()
      .select({
        contractsExpiring: sql<number>`count(*) filter (where ${c.type} <> 'probation')::int`,
        probations: sql<number>`count(*) filter (where ${c.type} = 'probation')::int`,
      })
      .from(c)
      .innerJoin(e, eq(e.id, c.employmentId))
      .innerJoin(schema.person, eq(schema.person.id, e.personId))
      .innerJoin(schema.entity, eq(schema.entity.id, e.entityId))
      .leftJoinLateral(a, sql`true`)
      .where(contractsDue),
  ]);
  return {
    total: Number(spans?.total ?? 0),
    joiners: Number(spans?.joiners ?? 0),
    leavers: Number(spans?.leavers ?? 0),
    contractsExpiring: Number(due?.contractsExpiring ?? 0),
    probations: Number(due?.probations ?? 0),
    scoped: !reach.all,
  };
}
