// What other modules (leave, attendance, later payroll) need to know about someone's employment,
// in one read: where they sit, since when, on probation or not. Re-exported by service.ts, the
// only door into this module. Nothing here is above the personal tier; the caller decides who sees it.
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { recordLifecycleEvent } from "./lifecycle-events";

type Executor = Tx | ReturnType<typeof db>;

export type EmploymentFacts = {
  personId: string;
  fullName: string;
  workEmail: string | null;
  status: "preboarding" | "active" | "suspended" | "offboarded";
  workforceType: string;
  entityId: string | null;
  departmentId: string | null;
  teamId: string | null;
  managerId: string | null;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: IsoDate | null;
  /** The latest employment period; null for someone who never had one. */
  employmentId: string | null;
  employeeCode: string | null;
  startDate: IsoDate | null;
  /**
   * The first day of the unbroken run of employments that ends in the latest one. The same as
   * `startDate`, except after a move to another entity: the person never stopped working for the group.
   */
  serviceStartDate: IsoDate | null;
  seniorityDate: IsoDate | null;
  endDate: IsoDate | null;
  /** Probation contracts of the latest employment, as date ranges (end null = open). */
  probation: { start: IsoDate; end: IsoDate | null }[];
};

export type PeopleFilter = { personIds?: readonly string[]; entityIds?: readonly string[]; employeeCodes?: readonly string[] };

/**
 * The filter as a condition on a `person_id` column — the same people every read asks about, so
 * the reads can go out together instead of each waiting for the id list of the one before.
 * Employee codes win over person ids, as they always have; entities narrow either.
 */
export function peopleScope(filter: PeopleFilter, executor: Executor): (column: AnyPgColumn) => SQL | undefined {
  // Plain ids need no subquery.
  if (filter.personIds && !filter.employeeCodes && !filter.entityIds) {
    const ids = [...filter.personIds];
    return (column) => inArray(column, ids);
  }
  const onPerson = and(
    filter.employeeCodes
      ? inArray(schema.person.id, executor.select({ id: schema.employment.personId }).from(schema.employment).where(inArray(schema.employment.employeeCode, [...filter.employeeCodes])))
      : filter.personIds
        ? inArray(schema.person.id, [...filter.personIds])
        : undefined,
    filter.entityIds ? inArray(schema.person.primaryEntityId, [...filter.entityIds]) : undefined,
  );
  return (column) => (onPerson ? inArray(column, executor.select({ id: schema.person.id }).from(schema.person).where(onPerson)) : undefined);
}

/** Employment facts of the given people (or, without ids, of everyone in the given entities / the group). */
export async function listEmploymentFacts(filter: PeopleFilter = {}, executor: Executor = db()): Promise<EmploymentFacts[]> {
  if (filter.personIds?.length === 0 || filter.entityIds?.length === 0 || filter.employeeCodes?.length === 0) return [];
  const scope = peopleScope(filter, executor);
  // One round trip: the people, their employments (newest first) and the probation contracts, side by side.
  const [people, employments, contracts] = await Promise.all([
    executor
      .select({ person: schema.person, gender: schema.personProfile.gender, dateOfBirth: schema.personProfile.dateOfBirth })
      .from(schema.person)
      .leftJoin(schema.personProfile, eq(schema.personProfile.personId, schema.person.id))
      .where(scope(schema.person.id)),
    executor.select().from(schema.employment).where(scope(schema.employment.personId)).orderBy(schema.employment.personId, desc(schema.employment.startDate)),
    executor.select({ personId: schema.contract.personId, employmentId: schema.contract.employmentId, startDate: schema.contract.startDate, endDate: schema.contract.endDate, terminatedOn: schema.contract.terminatedOn }).from(schema.contract).where(and(scope(schema.contract.personId), eq(schema.contract.type, "probation"), isNull(schema.contract.deletedAt))),
  ]);
  if (people.length === 0) return [];
  const employmentsOf = new Map<string, typeof employments>();
  for (const row of employments) employmentsOf.set(row.personId, [...(employmentsOf.get(row.personId) ?? []), row]);
  const probationOf = new Map<string, typeof contracts>();
  for (const row of contracts) probationOf.set(row.personId, [...(probationOf.get(row.personId) ?? []), row]);
  return people.map(({ person, gender, dateOfBirth }) => {
    const periods = employmentsOf.get(person.id) ?? [];
    const latest = periods[0] ?? null;
    let serviceStart = latest?.startDate ?? null;
    for (const earlier of periods.slice(1)) {
      if (!serviceStart || earlier.endDate !== addDays(serviceStart, -1)) break;
      serviceStart = earlier.startDate;
    }
    return {
      personId: person.id,
      fullName: person.fullName,
      workEmail: person.workEmail,
      status: person.status,
      workforceType: person.workforceType,
      entityId: person.primaryEntityId,
      departmentId: person.departmentId,
      teamId: person.teamId,
      managerId: person.managerId,
      gender: gender ?? null,
      dateOfBirth: dateOfBirth ?? null,
      employmentId: latest?.id ?? null,
      employeeCode: latest?.employeeCode ?? null,
      startDate: latest?.startDate ?? null,
      serviceStartDate: serviceStart,
      seniorityDate: latest?.seniorityDate ?? null,
      endDate: latest?.endDate ?? null,
      probation: (probationOf.get(person.id) ?? []).filter((row) => !latest || row.employmentId === latest.id).map((row) => ({ start: row.startDate, end: row.terminatedOn ?? row.endDate })),
    };
  });
}

/**
 * Who holds which position on a day (the primary assignment of the employment running then) —
 * for modules that key on the position: the KPI templates of the performance module.
 */
export async function listPositionHolders(onDate: IsoDate, executor: Executor = db()): Promise<{ personId: string; entityId: string; positionId: string; employeeCode: string | null }[]> {
  const rows = await executor
    .select({ personId: schema.employment.personId, entityId: schema.employment.entityId, positionId: schema.assignment.positionId, employeeCode: schema.employment.employeeCode, validFrom: schema.assignment.validFrom })
    .from(schema.assignment)
    .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
    .where(and(eq(schema.assignment.kind, "primary"), isNotNull(schema.assignment.positionId), lte(schema.assignment.validFrom, onDate), or(isNull(schema.assignment.validTo), gte(schema.assignment.validTo, onDate)), or(isNull(schema.employment.endDate), gte(schema.employment.endDate, onDate))))
    .orderBy(desc(schema.assignment.validFrom));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.personId) || !row.positionId) return [];
    seen.add(row.personId);
    return [{ personId: row.personId, entityId: row.entityId, positionId: row.positionId, employeeCode: row.employeeCode }];
  });
}

/**
 * A long absence (maternity, long sick leave, sabbatical — FR-LVE-08) on the person's timeline.
 * Called by the leave module inside the transaction that approves the leave.
 */
export async function recordLongLeave(tx: Executor, input: { personId: string; from: IsoDate; to: IsoDate; leaveTypeName: string; approvalRequestId: string | null }, actorPersonId: string | null): Promise<{ eventId: string } | null> {
  const [latest] = await tx.select().from(schema.employment).where(eq(schema.employment.personId, input.personId)).orderBy(desc(schema.employment.startDate)).limit(1);
  if (!latest) return null;
  const event = await recordLifecycleEvent(
    tx,
    { personId: input.personId, employmentId: latest.id, entityId: latest.entityId, type: "long_leave", effectiveDate: input.from, status: "applied", reason: input.leaveTypeName, details: { from: input.from, to: input.to, source: "leave_request" }, approvalRequestId: input.approvalRequestId },
    actorPersonId,
  );
  return { eventId: event.id };
}

/** The leave was cancelled: the event stays on the timeline as called off. */
export async function cancelLongLeave(tx: Executor, eventId: string): Promise<void> {
  await tx.update(schema.lifecycleEvent).set({ status: "cancelled" }).where(and(eq(schema.lifecycleEvent.id, eventId), eq(schema.lifecycleEvent.type, "long_leave")));
}
