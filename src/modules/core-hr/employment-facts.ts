// What other modules (leave, attendance, later payroll) need to know about someone's employment,
// in one read: where they sit, since when, on probation or not. Re-exported by service.ts, the
// only door into this module. Nothing here is above the personal tier; the caller decides who sees it.
import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
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
  seniorityDate: IsoDate | null;
  endDate: IsoDate | null;
  /** Probation contracts of the latest employment, as date ranges (end null = open). */
  probation: { start: IsoDate; end: IsoDate | null }[];
};

/** Employment facts of the given people (or, without ids, of everyone in the given entities / the group). */
export async function listEmploymentFacts(filter: { personIds?: readonly string[]; entityIds?: readonly string[]; employeeCodes?: readonly string[] } = {}, executor: Executor = db()): Promise<EmploymentFacts[]> {
  if (filter.personIds?.length === 0 || filter.entityIds?.length === 0 || filter.employeeCodes?.length === 0) return [];
  let personIds = filter.personIds ? [...filter.personIds] : null;
  if (filter.employeeCodes) {
    const rows = await executor.select({ personId: schema.employment.personId }).from(schema.employment).where(inArray(schema.employment.employeeCode, [...filter.employeeCodes]));
    personIds = rows.map((row) => row.personId);
    if (personIds.length === 0) return [];
  }
  const people = await executor
    .select({ person: schema.person, gender: schema.personProfile.gender, dateOfBirth: schema.personProfile.dateOfBirth })
    .from(schema.person)
    .leftJoin(schema.personProfile, eq(schema.personProfile.personId, schema.person.id))
    .where(and(personIds ? inArray(schema.person.id, personIds) : undefined, filter.entityIds ? inArray(schema.person.primaryEntityId, [...filter.entityIds]) : undefined));
  if (people.length === 0) return [];
  const ids = people.map((row) => row.person.id);
  const [employments, contracts] = await Promise.all([
    executor.select().from(schema.employment).where(inArray(schema.employment.personId, ids)).orderBy(desc(schema.employment.startDate)),
    executor.select({ personId: schema.contract.personId, employmentId: schema.contract.employmentId, startDate: schema.contract.startDate, endDate: schema.contract.endDate, terminatedOn: schema.contract.terminatedOn }).from(schema.contract).where(and(inArray(schema.contract.personId, ids), eq(schema.contract.type, "probation"), isNull(schema.contract.deletedAt))),
  ]);
  return people.map(({ person, gender, dateOfBirth }) => {
    const latest = employments.find((row) => row.personId === person.id) ?? null;
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
      seniorityDate: latest?.seniorityDate ?? null,
      endDate: latest?.endDate ?? null,
      probation: contracts.filter((row) => row.personId === person.id && (!latest || row.employmentId === latest.id)).map((row) => ({ start: row.startDate, end: row.terminatedOn ?? row.endDate })),
    };
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
