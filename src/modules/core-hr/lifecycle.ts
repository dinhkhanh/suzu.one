// Lifecycle use-cases (FR-CHR-09/11/16, FR-PLT-15): events HR records by hand, termination (which
// ends access), calling a termination off, rehire, a move to another entity, and the
// likely-duplicate check before a hire.
import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { toSearchKey } from "@/lib/text";
// The register decides what happens to a leaver's equipment; reached through its barrel, which is
// the boundary the module rule allows.
import { cancelReturnTasks, openReturnTasks } from "@/modules/assets/service";
import { canReadTier, type Principal } from "@/modules/platform/rbac/policy";
import { assertNotLastActiveOwner, endRoleGrantsOf, invalidateGrants, restoreRoleGrants } from "@/modules/platform/rbac/service";
import { cancelOpenTasksOfContext } from "@/modules/platform/tasks-engine/service";
import { revokeSessionsOf } from "@/modules/platform/auth/service";
import { invalidatePeople, type PersonRow, setPersonSuspended } from "@/modules/platform/people/service";
import { describePlacement, findLifecycleEvent, LIFECYCLE_CONTEXT, type LifecycleEventRow, type LifecycleEventView, loadTimeline, recordLifecycleEvent, startChecklist } from "./lifecycle-events";
import { type ContractInput, createContract } from "./records";
import { changeWorkforceTypeIn, getPersonTarget, type HireInput, inTransaction, invalidatePersonView, offboardLeavers, openEmployment, resolvePlacement, type WorkforceType } from "./service";

/** A person's timeline. null = the viewer does not read the personal tier of this person. */
export async function listLifecycleEvents(principal: Principal, personId: string): Promise<LifecycleEventView[] | null> {
  const target = await getPersonTarget(personId);
  if (!target || !canReadTier(principal, target, "personal")) return null;
  return loadTimeline(personId, { seesRestricted: canReadTier(principal, target, "restricted"), seesCompensation: canReadTier(principal, target, "compensation") });
}

async function latestEmployment(tx: Tx, personId: string) {
  const [employment] = await tx.select().from(schema.employment).where(eq(schema.employment.personId, personId)).orderBy(desc(schema.employment.startDate)).limit(1).for("update");
  if (!employment) throw new ActionError("no_employment");
  return employment;
}

// ── Events with no side effects ─────────────────────────────────────────────────────────────

export type RecordedEventType = "probation_pass" | "probation_fail" | "contract_renewal" | "salary_change" | "discipline" | "reward" | "long_leave";

export async function recordEvent(personId: string, input: { type: RecordedEventType; effectiveDate: IsoDate; reason: string | null; note: string | null }, actorPersonId: string): Promise<LifecycleEventRow> {
  return inTransaction(async (tx) => {
    const employment = await latestEmployment(tx, personId);
    if (input.effectiveDate < employment.startDate) throw new ActionError("event_before_start");
    return recordLifecycleEvent(tx, { personId, employmentId: employment.id, entityId: employment.entityId, ...input }, actorPersonId);
  });
}

// ── A passed probation, a renewed contract ──────────────────────────────────────────────────

export type ContractEventInput = {
  type: "probation_pass" | "contract_renewal";
  effectiveDate: IsoDate;
  reason: string | null;
  note: string | null;
  /** The labour contract that starts with the event. */
  contract: Omit<ContractInput, "parentContractId">;
  /** A probation pass moves the person to this type from the effective date (an employee, usually). */
  workforceType?: WorkforceType | null;
};

/**
 * A probation passed, or a contract renewed, as one change (FR-CHR-09): the new labour contract,
 * the workforce type from that day (for a probation, "employee" instead of "probation") and the
 * event on the timeline, in one transaction — so the record never says "passed probation" while the
 * person is still on probation terms, or the reverse. The contract it follows stops the day before,
 * if it was still running; the decision paper is issued by the action, linked to the event.
 */
export async function recordContractEvent(personId: string, input: ContractEventInput, actorPersonId: string) {
  const result = await inTransaction(async (tx) => {
    const employment = await latestEmployment(tx, personId);
    if (input.effectiveDate < employment.startDate) throw new ActionError("event_before_start");
    if (employment.endDate && input.effectiveDate > employment.endDate) throw new ActionError("already_terminated");
    if (input.contract.startDate !== input.effectiveDate) throw new ActionError("contract_start_not_effective");

    // What it follows stops the day before: the probation contract after a pass, the running labour
    // contract after a renewal. Ended, not deleted: it stays the record of what was signed.
    const follows = input.type === "probation_pass" ? ["probation"] : ["probation", "fixed_term", "indefinite"];
    const dayBefore = addDays(input.effectiveDate, -1);
    const ended = await tx
      .update(schema.contract)
      .set({ terminatedOn: dayBefore, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contract.employmentId, employment.id),
          isNull(schema.contract.deletedAt),
          isNull(schema.contract.terminatedOn),
          inArray(schema.contract.type, follows as ("probation" | "fixed_term" | "indefinite")[]),
          lte(schema.contract.startDate, dayBefore),
          or(isNull(schema.contract.endDate), gte(schema.contract.endDate, input.effectiveDate)),
        ),
      )
      .returning({ id: schema.contract.id, number: schema.contract.number });
    const contract = await createContract(personId, { ...input.contract, parentContractId: null }, actorPersonId, tx);
    const moved = input.workforceType ? await changeWorkforceTypeIn(tx, personId, { validFrom: input.effectiveDate, workforceType: input.workforceType, changeReason: input.reason }, actorPersonId) : null;
    const event = await recordLifecycleEvent(
      tx,
      {
        personId,
        employmentId: employment.id,
        entityId: employment.entityId,
        type: input.type,
        effectiveDate: input.effectiveDate,
        reason: input.reason,
        note: input.note,
        assignmentId: moved?.after.id ?? null,
        details: { contractId: contract.id, contractNumber: contract.number, endedContracts: ended.map((row) => row.id), ...(moved ? { workforceType: { from: moved.before.workforceType, to: moved.after.workforceType } } : {}) },
      },
      actorPersonId,
    );
    return { event, contract, ended, moved };
  });
  await invalidatePersonView(personId);
  return result;
}

/** An event that wrote a contract or moved the placement mirrors a change still in force: struck only by correcting those. */
const hasEffects = (event: LifecycleEventRow) => typeof event.details.contractId === "string" || !!event.details.workforceType;

/** Only hand-recorded events can be struck: the others mirror a change that would still be in force. */
export async function cancelRecordedEvent(eventId: string): Promise<{ before: LifecycleEventRow; after: LifecycleEventRow }> {
  const before = await findLifecycleEvent(eventId);
  if (!before || before.status === "cancelled") throw new ActionError("event_not_found");
  if (hasEffects(before)) throw new ActionError("event_has_effects");
  const [after] = await db().update(schema.lifecycleEvent).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.lifecycleEvent.id, eventId)).returning();
  return { before, after };
}

// ── Termination ─────────────────────────────────────────────────────────────────────────────

export type TerminationInput = { lastDay: IsoDate; reason: string; note: string | null; /** The approved resignation this carries out, if any. */ resignationEventId?: string | null };
type Closed = { assignments: { id: string; validTo: IsoDate | null }[]; grants: { id: string; validTo: IsoDate | null }[]; contracts: string[] };

/**
 * Ends the employment on `lastDay` (inclusive). In the same transaction: open assignments and
 * contracts stop on that day, assignments that would only start later are dropped, role grants
 * end, and the offboarding checklist starts. Access ends when the last day has passed — at once
 * for a past date, otherwise through the daily roll-over; until then the person keeps working.
 */
export async function terminateEmployment(personId: string, input: TerminationInput, actorPersonId: string) {
  const result = await inTransaction((tx) => terminateEmploymentIn(tx, personId, input, actorPersonId));
  await invalidateGrants(personId);
  return result;
}

/** The termination in the caller's transaction — an approved one (FR-CHR-09). The caller drops the person's grants (`invalidateGrants`) once it has committed. */
export async function terminateEmploymentIn(tx: Tx, personId: string, input: TerminationInput, actorPersonId: string) {
  const employment = await latestEmployment(tx, personId);
  if (employment.endDate) throw new ActionError("already_terminated");
  if (input.lastDay < employment.startDate) throw new ActionError("termination_before_start");

  const [ended] = await tx.update(schema.employment).set({ endDate: input.lastDay, updatedAt: new Date() }).where(eq(schema.employment.id, employment.id)).returning();

  const assignments = await tx.select().from(schema.assignment).where(eq(schema.assignment.employmentId, employment.id));
  const never = assignments.filter((row) => row.validFrom > input.lastDay);
  const open = assignments.filter((row) => row.validFrom <= input.lastDay && (row.validTo === null || row.validTo > input.lastDay));
  if (never.length) await tx.delete(schema.assignment).where(inArray(schema.assignment.id, never.map((row) => row.id)));
  if (open.length) await tx.update(schema.assignment).set({ validTo: input.lastDay, updatedAt: new Date() }).where(inArray(schema.assignment.id, open.map((row) => row.id)));
  await invalidatePersonView(personId);
  const current = open.find((row) => row.kind === "primary") ?? null;

  const contracts = await tx
    .update(schema.contract)
    .set({ terminatedOn: input.lastDay, updatedAt: new Date() })
    .where(and(eq(schema.contract.employmentId, employment.id), isNull(schema.contract.deletedAt), isNull(schema.contract.terminatedOn), or(isNull(schema.contract.endDate), gt(schema.contract.endDate, input.lastDay))))
    .returning({ id: schema.contract.id });
  const { ended: grants } = await endRoleGrantsOf(tx, personId, input.lastDay);

  const closed: Closed = { assignments: open.map((row) => ({ id: row.id, validTo: row.validTo })), grants, contracts: contracts.map((row) => row.id) };
  const today = todayInVietnam();
  const event = await recordLifecycleEvent(
    tx,
    { personId, employmentId: employment.id, entityId: employment.entityId, type: "termination", effectiveDate: input.lastDay, status: input.lastDay < today ? "applied" : "pending", reason: input.reason, note: input.note, details: { closed, droppedAssignments: never.length, resignationEventId: input.resignationEventId ?? null } },
    actorPersonId,
  );
  if (input.resignationEventId) {
    await tx.update(schema.lifecycleEvent).set({ status: "applied", updatedAt: new Date() }).where(and(eq(schema.lifecycleEvent.id, input.resignationEventId), eq(schema.lifecycleEvent.personId, personId), eq(schema.lifecycleEvent.type, "resignation")));
  }
  const { tasks } = await startChecklist(tx, event, "offboarding", { departmentId: current?.departmentId ?? null, positionId: current?.positionId ?? null }, actorPersonId);
  // Whatever the leaver is still holding becomes one return task each, due by the last working
  // day, beside the checklist's own "collect the equipment" step (FR-AST-02). What happens to a
  // camera is the register's business, so it decides who collects it and what it is called.
  const returns = await openReturnTasks(tx, personId, input.lastDay, actorPersonId);
  const offboardedNow = (await offboardLeavers(today, personId, tx, actorPersonId)) > 0;
  return { employment: ended, before: employment, event, tasks, closed, offboardedNow, returns };
}

/** Calls off a termination whose last day has not passed: everything it closed is reopened. Assignments it dropped are not brought back. */
export async function cancelTermination(eventId: string) {
  const result = await inTransaction(async (tx) => {
    const event = await findLifecycleEvent(eventId, tx);
    if (!event || event.type !== "termination" || event.status !== "pending") throw new ActionError("event_not_found");
    const employment = await latestEmployment(tx, event.personId);
    if (employment.id !== event.employmentId || employment.endDate === null || employment.endDate < todayInVietnam()) throw new ActionError("termination_already_effective");

    const closed = (event.details.closed ?? { assignments: [], grants: [], contracts: [] }) as Closed;
    await tx.update(schema.employment).set({ endDate: null, updatedAt: new Date() }).where(eq(schema.employment.id, employment.id));
    for (const row of closed.assignments) await tx.update(schema.assignment).set({ validTo: row.validTo, updatedAt: new Date() }).where(eq(schema.assignment.id, row.id));
    await invalidatePersonView(event.personId);
    if (closed.contracts.length) await tx.update(schema.contract).set({ terminatedOn: null, updatedAt: new Date() }).where(inArray(schema.contract.id, closed.contracts));
    await restoreRoleGrants(tx, closed.grants);
    // The resignation it carried out is called off with it: the person is staying, and may resign again later.
    const resignationEventId = typeof event.details.resignationEventId === "string" ? event.details.resignationEventId : null;
    if (resignationEventId) await tx.update(schema.lifecycleEvent).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.lifecycleEvent.id, resignationEventId), eq(schema.lifecycleEvent.type, "resignation")));
    const cancelledTasks = await cancelOpenTasksOfContext(tx, { type: LIFECYCLE_CONTEXT, id: event.id });
    // The equipment is not going back after all. Anything already handed in stays handed in.
    const cancelledReturns = await cancelReturnTasks(tx, event.personId);
    const [after] = await tx.update(schema.lifecycleEvent).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.lifecycleEvent.id, event.id)).returning();
    return { before: event, after, employment, cancelledTasks, cancelledReturns };
  });
  await invalidateGrants(result.before.personId);
  return result;
}

// ── Suspension (FR-PLT-05) ──────────────────────────────────────────────────────────────────

/**
 * Suspends a person's account: they are signed out everywhere at once and cannot sign in until it
 * is lifted. Nothing else moves — employment, placement and role grants stay as they are, so
 * lifting it gives back exactly what was there. Approvals waiting for them are not moved either:
 * an administrator reassigns them or sets a delegation in their name (PLT-02). Only someone active
 * is suspended (a leaver is already locked out, a newcomer has not started), never oneself, and
 * never the last owner who can still sign in.
 */
export async function suspendPerson(personId: string, actorPersonId: string): Promise<{ person: PersonRow; sessionsRevoked: number }> {
  if (personId === actorPersonId) throw new ActionError("suspend_self");
  return inTransaction(async (tx) => {
    const [before] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1).for("update");
    if (!before) throw new ActionError("person_not_found");
    if (before.status !== "active") throw new ActionError("suspend_not_active");
    await assertNotLastActiveOwner(tx, personId);
    const person = (await setPersonSuspended(tx, personId, true))!;
    return { person, sessionsRevoked: await revokeSessionsOf(person.workEmail, tx) };
  });
}

/** Lifts a suspension: the person is active again, with the grants and the placement they had, and signs in afresh. */
export async function liftSuspension(personId: string): Promise<{ person: PersonRow }> {
  return inTransaction(async (tx) => {
    const person = await setPersonSuspended(tx, personId, false);
    if (!person) throw new ActionError("suspend_not_suspended");
    return { person };
  });
}

// ── Rehire and duplicates ───────────────────────────────────────────────────────────────────

export type RehireInput = Pick<HireInput, "entityId" | "employeeCode" | "startDate" | "seniorityDate" | "placement">;

/**
 * A former employee comes back (FR-CHR-16): the same person row, a new employment period. The
 * employee code is new (or given): the old one stays with the old period, and codes are unique
 * within an entity. Seniority restarts unless HR enters an earlier seniority date.
 */
export async function rehirePerson(personId: string, input: RehireInput, actorPersonId: string) {
  return inTransaction(async (tx) => {
    const [person] = await tx.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1).for("update");
    if (!person) throw new ActionError("person_not_found");
    const previous = await latestEmployment(tx, personId);
    if (previous.endDate === null) throw new ActionError("still_employed");
    if (input.startDate <= previous.endDate) throw new ActionError("employment_overlap");
    const [entity] = await tx.select().from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
    if (!entity?.isActive) throw new ActionError("entity_not_found");

    const values = await resolvePlacement(tx, input.placement, { entityId: entity.id, personId });
    const status = input.startDate > todayInVietnam() ? ("preboarding" as const) : ("active" as const);
    await tx.update(schema.person).set({ status, updatedAt: new Date() }).where(eq(schema.person.id, personId));
    await invalidatePeople([person]);
    const opened = await openEmployment(tx, personId, entity, input, values, actorPersonId, { type: "rehire", onboarding: true });
    return { person: { ...person, status }, previous, ...opened };
  });
}

// ── Transfer between entities ───────────────────────────────────────────────────────────────

export type EntityTransferInput = Pick<HireInput, "entityId" | "employeeCode" | "placement"> & { startDate: IsoDate; reason: string | null };

/**
 * Moves an employee to another entity of the group (FR-PLT-15). Employment is with an entity, so
 * the one with the old entity ends the day before `startDate` — its assignments and contracts with
 * it, as a termination would close them — and a new one opens with the new entity: a new employee
 * code from its scheme (or the one given), the same seniority date, no onboarding checklist. Role
 * grants and the leave ledger are the person's and stay. Dated today or earlier only: until the
 * day comes, the latest employment would already read as the new entity everywhere.
 */
export async function transferToEntity(personId: string, input: EntityTransferInput, actorPersonId: string) {
  return inTransaction(async (tx) => {
    const previous = await latestEmployment(tx, personId);
    if (previous.endDate !== null) throw new ActionError("transfer_not_employed");
    if (previous.entityId === input.entityId) throw new ActionError("transfer_same_entity");
    if (input.startDate <= previous.startDate) throw new ActionError("transfer_before_start");
    if (input.startDate > todayInVietnam()) throw new ActionError("transfer_in_future");
    const entities = await tx.select().from(schema.entity).where(inArray(schema.entity.id, [previous.entityId, input.entityId]));
    const entity = entities.find((row) => row.id === input.entityId);
    if (!entity?.isActive) throw new ActionError("entity_not_found");
    const fromEntity = entities.find((row) => row.id === previous.entityId)!;
    const values = await resolvePlacement(tx, input.placement, { entityId: entity.id, personId });

    const lastDay = addDays(input.startDate, -1);
    const [ended] = await tx.update(schema.employment).set({ endDate: lastDay, updatedAt: new Date() }).where(eq(schema.employment.id, previous.id)).returning();
    const assignments = await tx.select().from(schema.assignment).where(eq(schema.assignment.employmentId, previous.id));
    const never = assignments.filter((row) => row.validFrom > lastDay);
    const open = assignments.filter((row) => row.validFrom <= lastDay && (row.validTo === null || row.validTo > lastDay));
    if (never.length) await tx.delete(schema.assignment).where(inArray(schema.assignment.id, never.map((row) => row.id)));
    if (open.length) await tx.update(schema.assignment).set({ validTo: lastDay, updatedAt: new Date() }).where(inArray(schema.assignment.id, open.map((row) => row.id)));
    const before = open.find((row) => row.kind === "primary") ?? null;
    // A labour contract is signed with an entity: the new one needs its own.
    const contracts = await tx
      .update(schema.contract)
      .set({ terminatedOn: lastDay, updatedAt: new Date() })
      .where(and(eq(schema.contract.employmentId, previous.id), isNull(schema.contract.deletedAt), isNull(schema.contract.terminatedOn), or(isNull(schema.contract.endDate), gt(schema.contract.endDate, lastDay))))
      .returning({ id: schema.contract.id });

    const from = before ? { ...(await describePlacement(tx, before)), entity: fromEntity.shortName } : { entity: fromEntity.shortName };
    const opened = await openEmployment(tx, personId, entity, { employeeCode: input.employeeCode, startDate: input.startDate, seniorityDate: previous.seniorityDate }, values, actorPersonId, {
      type: "transfer",
      onboarding: false,
      reason: input.reason,
      from,
      entityName: entity.shortName,
    });
    return { previous, ended, droppedAssignments: never.length, contractsEnded: contracts.length, ...opened };
  });
}

export type DuplicateCandidate = { id: string; fullName: string; entityName: string | null; employeeCode: string | null; former: boolean; reasons: ("name_and_birth" | "personal_email" | "phone")[] };

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * People already on the books who look like the person about to be added (known gap 3): same
 * name and date of birth, same personal email, or same phone. Names, entity and "former
 * employee" only — what HR needs to decide, nothing above the directory tier but that flag.
 */
export async function findLikelyDuplicates(input: { fullName: string; dateOfBirth: IsoDate | null; personalEmail: string | null; phone: string | null }, exceptPersonId?: string): Promise<DuplicateCandidate[]> {
  const searchName = toSearchKey(input.fullName.trim().replace(/\s+/g, " "));
  const phone = input.phone ? digits(input.phone) : "";
  const profile = schema.personProfile;
  const matches = await db()
    .select({ id: schema.person.id, fullName: schema.person.fullName, searchName: schema.person.searchName, status: schema.person.status, dateOfBirth: profile.dateOfBirth, personalEmail: profile.personalEmail, phone: profile.phone })
    .from(schema.person)
    .leftJoin(profile, eq(profile.personId, schema.person.id))
    .where(
      and(
        exceptPersonId ? ne(schema.person.id, exceptPersonId) : undefined,
        or(
          input.dateOfBirth ? and(eq(schema.person.searchName, searchName), eq(profile.dateOfBirth, input.dateOfBirth)) : undefined,
          input.personalEmail ? sql`lower(${profile.personalEmail}) = ${input.personalEmail.toLowerCase()}` : undefined,
          phone.length >= 8 ? sql`regexp_replace(coalesce(${profile.phone}, ''), '\\D', '', 'g') = ${phone}` : undefined,
        ) ?? sql`false`,
      ),
    )
    .limit(10);
  if (matches.length === 0) return [];

  const employments = await db()
    .select({ personId: schema.employment.personId, employeeCode: schema.employment.employeeCode, entityName: schema.entity.shortName })
    .from(schema.employment)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.employment.entityId))
    .where(inArray(schema.employment.personId, matches.map((row) => row.id)))
    .orderBy(desc(schema.employment.startDate));
  return matches.map((row) => {
    const latest = employments.find((employment) => employment.personId === row.id);
    const reasons: DuplicateCandidate["reasons"] = [];
    if (input.dateOfBirth && row.searchName === searchName && row.dateOfBirth === input.dateOfBirth) reasons.push("name_and_birth");
    if (input.personalEmail && row.personalEmail?.toLowerCase() === input.personalEmail.toLowerCase()) reasons.push("personal_email");
    if (phone.length >= 8 && row.phone && digits(row.phone) === phone) reasons.push("phone");
    return { id: row.id, fullName: row.fullName, entityName: latest?.entityName ?? null, employeeCode: latest?.employeeCode ?? null, former: row.status === "offboarded", reasons };
  });
}
