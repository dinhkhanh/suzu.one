// Lifecycle events, the low level: writing an event row, starting the checklist that goes with
// it, and reading a person's timeline. The use-cases that *cause* events live in service.ts (hire,
// change of assignment) and lifecycle.ts (termination, rehire, resignation); both import this
// file, which imports neither.
import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { instantiateTemplate, listTasksAbout, type TaskView } from "@/modules/platform/tasks-engine/service";

type Executor = Tx | ReturnType<typeof db>;
export type LifecycleEventRow = typeof schema.lifecycleEvent.$inferSelect;
export type LifecycleEventType = LifecycleEventRow["type"];

export const LIFECYCLE_CONTEXT = "lifecycle_event";

export type NewLifecycleEvent = {
  personId: string;
  employmentId: string;
  entityId: string;
  type: LifecycleEventType;
  effectiveDate: IsoDate;
  status?: LifecycleEventRow["status"];
  reason?: string | null;
  note?: string | null;
  details?: Record<string, unknown>;
  approvalRequestId?: string | null;
  assignmentId?: string | null;
};

export async function recordLifecycleEvent(tx: Executor, event: NewLifecycleEvent, actorPersonId: string | null): Promise<LifecycleEventRow> {
  const [row] = await tx.insert(schema.lifecycleEvent).values({ ...event, createdByPersonId: actorPersonId }).returning();
  return row;
}

/** The onboarding or offboarding checklist of an event, from the template that fits the person's placement. */
export async function startChecklist(tx: Executor, event: LifecycleEventRow, purpose: "onboarding" | "offboarding", placement: { departmentId: string | null; positionId: string | null }, actorPersonId: string | null) {
  return instantiateTemplate(tx, {
    purpose,
    entityId: event.entityId,
    departmentId: placement.departmentId,
    positionId: placement.positionId,
    anchorDate: event.effectiveDate,
    context: { type: LIFECYCLE_CONTEXT, id: event.id },
    subjectPersonId: event.personId,
    actorId: actorPersonId,
  });
}

/** A placement in words, for the from → to snapshot of a transfer or promotion. Names, not ids: the timeline must still read right after a department is renamed or a manager leaves. */
export async function describePlacement(tx: Executor, row: { departmentId: string | null; teamId: string | null; positionId: string | null; managerId: string | null; jobLevel: string | null; workforceType: string }) {
  const [[department], [team], [position], [manager]] = await Promise.all([
    row.departmentId ? tx.select({ name: schema.orgUnit.name }).from(schema.orgUnit).where(eq(schema.orgUnit.id, row.departmentId)) : [],
    row.teamId ? tx.select({ name: schema.orgUnit.name }).from(schema.orgUnit).where(eq(schema.orgUnit.id, row.teamId)) : [],
    row.positionId ? tx.select({ name: schema.position.name }).from(schema.position).where(eq(schema.position.id, row.positionId)) : [],
    row.managerId ? tx.select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, row.managerId)) : [],
  ]);
  return { department: department?.name ?? null, team: team?.name ?? null, position: position?.name ?? null, manager: manager?.name ?? null, jobLevel: row.jobLevel, workforceType: row.workforceType };
}

export type PlacementWords = Awaited<ReturnType<typeof describePlacement>>;

export type LifecycleEventView = Pick<LifecycleEventRow, "id" | "type" | "effectiveDate" | "status" | "reason" | "note" | "approvalRequestId" | "createdAt"> & {
  from: PlacementWords | null;
  to: PlacementWords | null;
  createdByName: string | null;
  /** The event's checklist, if it has one. */
  tasks: TaskView[];
};

/** The events whose reason and note are about pay: that there was one is personal, why is compensation. */
const PAY_EVENT_TYPES: readonly LifecycleEventType[] = ["salary_change", "pay_profile_change"];

/**
 * Newest first. `seesRestricted` decides whether discipline notes come along, `seesCompensation`
 * whether a pay change's reason and note do (a line manager sees that a raise happened, not why);
 * the caller has already checked the personal tier.
 */
export async function loadTimeline(personId: string, options: { seesRestricted: boolean; seesCompensation: boolean }): Promise<LifecycleEventView[]> {
  const [rows, tasks] = await Promise.all([
    db()
      .select({ event: schema.lifecycleEvent, createdByName: schema.person.fullName })
      .from(schema.lifecycleEvent)
      .leftJoin(schema.person, eq(schema.person.id, schema.lifecycleEvent.createdByPersonId))
      .where(eq(schema.lifecycleEvent.personId, personId))
      .orderBy(desc(schema.lifecycleEvent.effectiveDate), desc(schema.lifecycleEvent.createdAt)),
    listTasksAbout(personId, "checklist"),
  ]);
  return rows.map(({ event, createdByName }) => {
    const hidesPay = PAY_EVENT_TYPES.includes(event.type) && !options.seesCompensation;
    return {
      id: event.id,
      type: event.type,
      effectiveDate: event.effectiveDate,
      status: event.status,
      reason: hidesPay ? null : event.reason,
      note: hidesPay || (event.type === "discipline" && !options.seesRestricted) ? null : event.note,
      approvalRequestId: event.approvalRequestId,
      createdAt: event.createdAt,
      from: (event.details.from as PlacementWords | undefined) ?? null,
      to: (event.details.to as PlacementWords | undefined) ?? null,
      createdByName,
      tasks: tasks.filter((task) => task.contextType === LIFECYCLE_CONTEXT && task.contextId === event.id),
    };
  });
}

export async function findLifecycleEvent(eventId: string, executor: Executor = db()): Promise<LifecycleEventRow | undefined> {
  const [row] = await executor.select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, eventId)).limit(1);
  return row;
}

/** Terminations whose last day has passed take effect: marked applied by the daily roll-over. */
export async function markDueTerminationsApplied(tx: Executor, personId: string, today: IsoDate = todayInVietnam()): Promise<void> {
  const due = await tx
    .select({ id: schema.lifecycleEvent.id, effectiveDate: schema.lifecycleEvent.effectiveDate })
    .from(schema.lifecycleEvent)
    .where(and(eq(schema.lifecycleEvent.personId, personId), eq(schema.lifecycleEvent.type, "termination"), eq(schema.lifecycleEvent.status, "pending")));
  const ids = due.filter((event) => event.effectiveDate < today).map((event) => event.id);
  if (ids.length) await tx.update(schema.lifecycleEvent).set({ status: "applied", updatedAt: new Date() }).where(inArray(schema.lifecycleEvent.id, ids));
}

/** A lifecycle event as other modules may know it: who, where, what and when — never the note or the reason. */
export type LifecycleEventFact = { id: string; type: LifecycleEventType; status: LifecycleEventRow["status"]; personId: string; personName: string; entityId: string; effectiveDate: IsoDate; /** A long absence carries its last day. */ until: IsoDate | null; createdAt: Date };

/**
 * The events written since a moment, oldest first — the durable log that the ops tracker pulls its
 * event-driven obligations from (register insurance after a hire, close the book after a
 * termination…). Read-only; cancelled events are included so their obligations can be called off.
 */
export async function listLifecycleEventFacts(filter: { createdSince: Date; types: readonly LifecycleEventType[] }, executor: Executor = db()): Promise<LifecycleEventFact[]> {
  if (filter.types.length === 0) return [];
  const rows = await executor
    .select({ event: schema.lifecycleEvent, personName: schema.person.fullName })
    .from(schema.lifecycleEvent)
    .innerJoin(schema.person, eq(schema.person.id, schema.lifecycleEvent.personId))
    .where(and(gte(schema.lifecycleEvent.createdAt, filter.createdSince), inArray(schema.lifecycleEvent.type, [...filter.types])))
    .orderBy(asc(schema.lifecycleEvent.createdAt));
  return rows.map(({ event, personName }) => ({ id: event.id, type: event.type, status: event.status, personId: event.personId, personName, entityId: event.entityId, effectiveDate: event.effectiveDate, until: typeof event.details.to === "string" ? event.details.to : null, createdAt: event.createdAt }));
}
