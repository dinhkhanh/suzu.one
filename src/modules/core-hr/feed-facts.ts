// What the home feed and announcement targeting may know about people (Phase 4, FR-COM-01, 02).
// Read-only. Directory-tier facts only — and of the date of birth, which is personal tier, just the
// day and the month: the year is never selected, so it cannot leave the database through here.
import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;
const { assignment, branch, employment, entity, orgUnit, person, personProfile, position } = schema;

const currentAssignment = (onDate: IsoDate) => and(eq(assignment.kind, "primary"), lte(assignment.validFrom, onDate), or(isNull(assignment.validTo), gte(assignment.validTo, onDate)));
const currentEmployment = (onDate: IsoDate) => and(lte(employment.startDate, onDate), or(isNull(employment.endDate), gte(employment.endDate, onDate)));

/** The branch (location) of the person's primary assignment on the day, if any. */
export async function currentBranchOf(personId: string, onDate: IsoDate, executor: Executor = db()): Promise<string | null> {
  const [row] = await executor
    .select({ branchId: assignment.branchId })
    .from(assignment)
    .innerJoin(employment, eq(employment.id, assignment.employmentId))
    .where(and(eq(employment.personId, personId), currentAssignment(onDate), currentEmployment(onDate)))
    .limit(1);
  return row?.branchId ?? null;
}

/** Everyone whose primary assignment sits at one of the branches on the day. */
export async function listPeopleAtBranches(branchIds: readonly string[], onDate: IsoDate, executor: Executor = db()): Promise<string[]> {
  if (branchIds.length === 0) return [];
  const rows = await executor
    .selectDistinct({ personId: employment.personId })
    .from(assignment)
    .innerJoin(employment, eq(employment.id, assignment.employmentId))
    .where(and(inArray(assignment.branchId, [...branchIds]), currentAssignment(onDate), currentEmployment(onDate)));
  return rows.map((row) => row.personId);
}

export async function findBranchEntity(branchId: string, executor: Executor = db()): Promise<{ entityId: string } | null> {
  const [row] = await executor.select({ entityId: branch.entityId }).from(branch).where(eq(branch.id, branchId)).limit(1);
  return row ?? null;
}

export type StaffOccasionFacts = {
  personId: string;
  fullName: string;
  entityName: string | null;
  departmentName: string | null;
  positionName: string | null;
  /** Day and month of birth — never the year. null = not on file. */
  birthMonth: number | null;
  birthDay: number | null;
  startDate: IsoDate;
  seniorityDate: IsoDate;
};

/** Active staff (no collaborators — they are not in the directory) with a running employment on the day. */
export async function listStaffOccasionFacts(onDate: IsoDate, executor: Executor = db()): Promise<StaffOccasionFacts[]> {
  const rows = await executor
    .select({
      personId: person.id,
      fullName: person.fullName,
      entityName: entity.shortName,
      departmentName: orgUnit.name,
      positionName: position.name,
      birthMonth: sql<number | null>`extract(month from ${personProfile.dateOfBirth})::int`,
      birthDay: sql<number | null>`extract(day from ${personProfile.dateOfBirth})::int`,
      startDate: employment.startDate,
      seniorityDate: employment.seniorityDate,
    })
    .from(person)
    .innerJoin(employment, and(eq(employment.personId, person.id), currentEmployment(onDate)))
    .leftJoin(personProfile, eq(personProfile.personId, person.id))
    .leftJoin(assignment, and(eq(assignment.employmentId, employment.id), currentAssignment(onDate)))
    .leftJoin(position, eq(position.id, assignment.positionId))
    .leftJoin(entity, eq(entity.id, employment.entityId))
    .leftJoin(orgUnit, eq(orgUnit.id, person.departmentId))
    .where(and(eq(person.status, "active"), ne(person.workforceType, "collaborator")))
    .orderBy(asc(person.searchName));
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.personId) ? false : (seen.add(row.personId), true)));
}
