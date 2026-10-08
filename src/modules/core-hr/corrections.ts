// Correcting what was entered wrong (CHR-02): an employment's first day, seniority date and
// employee code; a position's name in the shared catalogue; and a person who should never have been
// created at all. Part of the core-hr service (split from service.ts for size). Each is a
// correction, not an event: nothing here writes the timeline, and the audit entry is the record of it.
import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
import { activatePerson, invalidatePeople } from "@/modules/platform/people/service";
import { normalizeEmployeeCode } from "./engine/employee-code";
import { LIFECYCLE_CONTEXT } from "./lifecycle-events";
import { inTransaction, invalidatePersonView, invalidatePositions } from "./service";

export type EmploymentRow = typeof schema.employment.$inferSelect;

export async function findEmployment(employmentId: string): Promise<EmploymentRow | undefined> {
  const [row] = await db().select().from(schema.employment).where(eq(schema.employment.id, employmentId)).limit(1);
  return row;
}

/** A person's employment periods, newest first — for HR's corrections on the person page. Personal tier; the page checks. */
export async function listEmploymentsOf(personId: string): Promise<{ id: string; entityName: string; employeeCode: string; startDate: IsoDate; seniorityDate: IsoDate; endDate: IsoDate | null }[]> {
  return db()
    .select({
      id: schema.employment.id,
      entityName: schema.entity.shortName,
      employeeCode: schema.employment.employeeCode,
      startDate: schema.employment.startDate,
      seniorityDate: schema.employment.seniorityDate,
      endDate: schema.employment.endDate,
    })
    .from(schema.employment)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.employment.entityId))
    .where(eq(schema.employment.personId, personId))
    .orderBy(desc(schema.employment.startDate));
}

export type EmploymentCorrection = { employeeCode: string; startDate: IsoDate; seniorityDate: IsoDate };

/**
 * Corrects one employment period — any of them, not only the latest. A new first day carries the
 * first assignment (and the hire, rehire or transfer that opened the period) with it; it may not
 * pass the end of that first assignment, the period's last day, or — for someone already at work —
 * today: that is not a correction but a person who has not started, and needs the record redone.
 * A preboarding person whose first day is moved to today or earlier is let in now, as the nightly
 * roll-over would.
 */
export async function correctEmployment(employmentId: string, input: EmploymentCorrection) {
  const result = await inTransaction(async (tx) => {
    const [before] = await tx.select().from(schema.employment).where(eq(schema.employment.id, employmentId)).limit(1).for("update");
    if (!before) throw new ActionError("no_employment");
    const employeeCode = normalizeEmployeeCode(input.employeeCode);
    if (!employeeCode) throw new ActionError("employee_code_invalid");
    if (before.endDate && input.startDate > before.endDate) throw new ActionError("employment_start_after_end");
    if (input.seniorityDate > input.startDate) throw new ActionError("seniority_after_start");
    const [person] = await tx.select().from(schema.person).where(eq(schema.person.id, before.personId)).limit(1);
    const today = todayInVietnam();
    if (person && person.status !== "preboarding" && before.startDate <= today && input.startDate > today) throw new ActionError("employment_start_after_today");

    if (input.startDate !== before.startDate) {
      const assignments = await tx.select().from(schema.assignment).where(eq(schema.assignment.employmentId, employmentId)).orderBy(asc(schema.assignment.validFrom));
      // Nothing may end before the new first day; whatever started on the old one starts on the new one.
      if (assignments.some((row) => row.validTo !== null && row.validTo < input.startDate)) throw new ActionError("employment_start_after_first_change");
      if (assignments.some((row) => row.validFrom > before.startDate && row.validFrom < input.startDate)) throw new ActionError("employment_start_after_first_change");
      const moving = assignments.filter((row) => row.validFrom === before.startDate || row.validFrom < input.startDate).map((row) => row.id);
      if (moving.length) await tx.update(schema.assignment).set({ validFrom: input.startDate, updatedAt: new Date() }).where(inArray(schema.assignment.id, moving));
      await tx
        .update(schema.lifecycleEvent)
        .set({ effectiveDate: input.startDate, updatedAt: new Date() })
        .where(and(eq(schema.lifecycleEvent.employmentId, employmentId), inArray(schema.lifecycleEvent.type, ["hire", "rehire", "transfer"]), eq(schema.lifecycleEvent.effectiveDate, before.startDate)));
    }
    const [after] = await tx.update(schema.employment).set({ employeeCode, startDate: input.startDate, seniorityDate: input.seniorityDate, updatedAt: new Date() }).where(eq(schema.employment.id, employmentId)).returning();
    const activated = person?.status === "preboarding" && input.startDate <= today;
    if (activated) await activatePerson(tx, before.personId);
    return { before, after, activated };
  });
  await invalidatePersonView(result.before.personId);
  return result;
}

// ── Positions ───────────────────────────────────────────────────────────────────────────────

export type PositionEntry = { id: string; name: string; holders: number };

/** The position catalogue with how many people hold each today — counted in SQL. For HR's catalogue page. */
export async function listPositionCatalogue(): Promise<PositionEntry[]> {
  const today = todayInVietnam();
  const holders = db()
    .select({ positionId: schema.assignment.positionId, holders: count(sql`distinct ${schema.employment.personId}`).as("holders") })
    .from(schema.assignment)
    .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
    .where(and(eq(schema.assignment.kind, "primary"), sql`${schema.assignment.validFrom} <= ${today}::date`, or(isNull(schema.assignment.validTo), gte(schema.assignment.validTo, today))))
    .groupBy(schema.assignment.positionId)
    .as("holders");
  const rows = await db()
    .select({ id: schema.position.id, name: schema.position.name, holders: sql<number>`coalesce(${holders.holders}, 0)::int` })
    .from(schema.position)
    .leftJoin(holders, eq(holders.positionId, schema.position.id))
    .orderBy(asc(schema.position.searchName));
  return rows;
}

/**
 * Corrects a position's name everywhere it is held — the catalogue keeps one row per post, so a
 * misspelling typed once is fixed once. A name that is already another position is refused: two
 * posts are not merged behind HR's back (the KPI and checklist templates key on each).
 */
export async function renamePosition(positionId: string, name: string): Promise<{ before: { id: string; name: string }; after: { id: string; name: string } }> {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new ActionError("position_name_empty");
  const searchName = toSearchKey(cleaned);
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select({ id: schema.position.id, name: schema.position.name }).from(schema.position).where(eq(schema.position.id, positionId)).limit(1).for("update");
    if (!before) throw new ActionError("position_not_found");
    const [twin] = await tx
      .select({ id: schema.position.id })
      .from(schema.position)
      .where(and(eq(schema.position.searchName, searchName), ne(schema.position.id, positionId)))
      .limit(1);
    if (twin) throw new ActionError("position_name_taken");
    await tx.update(schema.position).set({ name: cleaned, searchName, updatedAt: new Date() }).where(eq(schema.position.id, positionId));
    return { before, after: { id: positionId, name: cleaned } };
  });
  // Pages show the old name for at most their cache's life (`personViewRows` says so).
  await invalidatePositions();
  return result;
}

// ── A person created in error ───────────────────────────────────────────────────────────────

/**
 * Removes a person who should never have been created — a duplicate, a test, a typo hire. Only what
 * creating them made goes with them: the profile, the employment and its assignments, the
 * hire event and its onboarding checklist, and the notices those sent them. **Anything else that
 * names them — a contract, a leave request, a role, a payslip, a task they did — keeps them**: the
 * database refuses the delete, and the answer is `person_in_use`. Nothing is guessed: that refusal
 * is the list of dependants, kept by the foreign keys themselves rather than by this code.
 */
export async function removePersonCreatedInError(personId: string, actorPersonId: string, confirmName: string) {
  if (personId === actorPersonId) throw new ActionError("remove_self");
  try {
    const removed = await db().transaction(async (tx) => {
      const [person] = await tx.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1).for("update");
      if (!person) throw new ActionError("person_not_found");
      // The name typed back, accents and spacing aside: removal is not something to do by a slip.
      if (toSearchKey(confirmName) !== toSearchKey(person.fullName)) throw new ActionError("remove_name_mismatch");
      const employments = await tx.select({ id: schema.employment.id }).from(schema.employment).where(eq(schema.employment.personId, personId));
      const employmentIds = employments.map((row) => row.id);
      const events = employmentIds.length ? await tx.select({ id: schema.lifecycleEvent.id, type: schema.lifecycleEvent.type }).from(schema.lifecycleEvent).where(inArray(schema.lifecycleEvent.employmentId, employmentIds)) : [];
      // Only the hire's own events go; a termination, a promotion or a resignation means a history.
      if (events.some((event) => event.type !== "hire" && event.type !== "rehire")) throw new ActionError("person_in_use");

      // The checklist the hire started goes too — unless somebody has already done a step of it.
      if (events.length) {
        const checklist = and(
          eq(schema.task.contextType, LIFECYCLE_CONTEXT),
          inArray(
            schema.task.contextId,
            events.map((event) => event.id),
          ),
        );
        const [done] = await tx
          .select({ id: schema.task.id })
          .from(schema.task)
          .where(and(checklist, isNotNull(schema.task.completedByPersonId)))
          .limit(1);
        if (done) throw new ActionError("person_in_use");
        await tx.delete(schema.task).where(checklist);
      }
      await tx.delete(schema.notification).where(eq(schema.notification.recipientPersonId, personId));
      if (events.length)
        await tx.delete(schema.lifecycleEvent).where(
          inArray(
            schema.lifecycleEvent.id,
            events.map((event) => event.id),
          ),
        );
      if (employmentIds.length) {
        await tx.delete(schema.assignment).where(inArray(schema.assignment.employmentId, employmentIds));
        await tx.delete(schema.employment).where(inArray(schema.employment.id, employmentIds));
      }
      await tx.delete(schema.personProfile).where(eq(schema.personProfile.personId, personId));
      await tx.delete(schema.personSensitive).where(eq(schema.personSensitive.personId, personId));
      await tx.delete(schema.personCompetency).where(eq(schema.personCompetency.personId, personId));
      await tx.delete(schema.person).where(eq(schema.person.id, personId));
      return person;
    });
    await invalidatePeople([removed]);
    await invalidatePersonView(personId);
    return removed;
  } catch (error) {
    // 23503: a row elsewhere still names them. Whatever it is, it is a reason to keep the record.
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      if ((cause as { code?: string }).code === "23503") throw new ActionError("person_in_use");
    }
    throw error;
  }
}
