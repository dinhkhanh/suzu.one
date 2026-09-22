// Resource bookings (FR-PJM-13): hours per week of a person — or of a placeholder role ("Motion
// designer – TBD") until someone is found — on a project, tentative (a pitch, an unsigned deal) or
// confirmed. The booked person hears of every change to their bookings; a placeholder hears nothing.
// The actions check who may book (whoever runs the project); these functions keep the rows sane.
import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { BOOKING_STATUSES, type BookingStatus, isMonday } from "./engine/capacity";

export type BookingRow = typeof schema.projectBooking.$inferSelect;
export type BookingView = BookingRow & { personName: string | null };

const formatWeek = (date: IsoDate) => date.split("-").reverse().join("/");

async function projectName(executor: Tx | ReturnType<typeof db>, projectId: string): Promise<string> {
  const [row] = await executor.select({ name: schema.workProject.name, status: schema.workProject.status }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!row) throw new ActionError("project_not_found");
  if (row.status === "archived") throw new ActionError("project_archived");
  return row.name;
}

async function activePerson(executor: Tx | ReturnType<typeof db>, personId: string): Promise<void> {
  const [row] = await executor.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || row.status === "offboarded") throw new ActionError("person_not_found");
}

/** The booked person is told, unless they made the change themselves. */
async function tellBooked(executor: Tx, personId: string | null, actor: { personId: string; fullName: string }, project: { id: string; name: string }, week: IsoDate): Promise<void> {
  if (!personId || personId === actor.personId) return;
  await notify({ recipients: [personId], kind: "projects.booking_changed", params: { actor: actor.fullName, project: project.name, week: formatWeek(week) }, link: `/projects/${project.id}/team` }, executor);
}

export const findBooking = async (bookingId: string): Promise<BookingRow | undefined> => (await db().select().from(schema.projectBooking).where(eq(schema.projectBooking.id, bookingId)).limit(1))[0];

/** A project's bookings in a range of weeks, people by name, placeholders last. The caller has checked the viewer may read the plan. */
export async function listProjectBookings(projectId: string, from: IsoDate, to: IsoDate): Promise<BookingView[]> {
  const rows = await db()
    .select({ booking: schema.projectBooking, personName: schema.person.fullName })
    .from(schema.projectBooking)
    .leftJoin(schema.person, eq(schema.person.id, schema.projectBooking.personId))
    .where(and(eq(schema.projectBooking.projectId, projectId), gte(schema.projectBooking.weekStart, from), lte(schema.projectBooking.weekStart, to)))
    .orderBy(asc(schema.person.searchName), asc(schema.projectBooking.placeholderRole), asc(schema.projectBooking.weekStart));
  return rows.map(({ booking, personName }) => ({ ...booking, personName }));
}

export type PersonBookingView = BookingRow & { projectName: string };

/**
 * One person's bookings on every project between two Mondays (both included), for callers that
 * plan around a person — the work module's cover plans. No authorization inside: the caller has
 * already decided it may see this person's planned time.
 */
export async function listBookingsOfPerson(personId: string, fromWeek: IsoDate, toWeek: IsoDate): Promise<PersonBookingView[]> {
  const rows = await db()
    .select({ booking: schema.projectBooking, projectName: schema.workProject.name })
    .from(schema.projectBooking)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBooking.projectId))
    .where(and(eq(schema.projectBooking.personId, personId), gte(schema.projectBooking.weekStart, fromWeek), lte(schema.projectBooking.weekStart, toWeek)))
    .orderBy(asc(schema.projectBooking.weekStart), asc(schema.workProject.name));
  return rows.map(({ booking, projectName }) => ({ ...booking, projectName }));
}

export type BookingInput = {
  /** Exactly one of the two for a new booking: a person, or a placeholder role to fill later. */
  personId: string | null;
  placeholderRole: string | null;
  weekStart: IsoDate;
  minutes: number;
  status: BookingStatus;
  note: string | null;
  /** The same hours for this many weeks in a row, starting with `weekStart`. */
  weeks: number;
};

export type Actor = { personId: string; fullName: string };

/**
 * Books a person or a placeholder for one or more weeks. A week that already has a booking of the
 * same person (or the same open placeholder) on the project is changed, not doubled.
 */
export async function bookWeeks(projectId: string, input: BookingInput, actor: Actor): Promise<{ created: BookingRow[]; changed: { before: BookingRow; after: BookingRow }[] }> {
  if (!isMonday(input.weekStart)) throw new ActionError("booking_week_invalid");
  if (!BOOKING_STATUSES.includes(input.status)) throw new ActionError("invalid");
  if (!!input.personId === !!input.placeholderRole) throw new ActionError("booking_who_required");
  return db().transaction(async (tx) => {
    const name = await projectName(tx, projectId);
    if (input.personId) await activePerson(tx, input.personId);
    const weeks = Array.from({ length: Math.max(1, input.weeks) }, (_, index) => addDays(input.weekStart, index * 7));
    const same = input.personId ? eq(schema.projectBooking.personId, input.personId) : and(isNull(schema.projectBooking.personId), eq(schema.projectBooking.placeholderRole, input.placeholderRole!));
    const existing = await tx.select().from(schema.projectBooking).where(and(eq(schema.projectBooking.projectId, projectId), same, inArray(schema.projectBooking.weekStart, weeks))).for("update");
    const byWeek = new Map(existing.map((row) => [row.weekStart, row]));
    const created: BookingRow[] = [];
    const changed: { before: BookingRow; after: BookingRow }[] = [];
    for (const weekStart of weeks) {
      const values = { minutes: input.minutes, status: input.status, note: input.note };
      const before = byWeek.get(weekStart);
      if (before) {
        const [after] = await tx.update(schema.projectBooking).set({ ...values, updatedAt: new Date() }).where(eq(schema.projectBooking.id, before.id)).returning();
        changed.push({ before, after });
      } else {
        const [after] = await tx.insert(schema.projectBooking).values({ projectId, personId: input.personId, placeholderRole: input.personId ? null : input.placeholderRole, weekStart, ...values, createdByPersonId: actor.personId }).returning();
        created.push(after);
      }
    }
    // One notice for the whole run of weeks.
    await tellBooked(tx, input.personId, actor, { id: projectId, name }, input.weekStart);
    return { created, changed };
  });
}

export type BookingPatch = { minutes: number; status: BookingStatus; note: string | null };

/** Changes one booking's hours, status (confirming a tentative one) or note. */
export async function updateBooking(bookingId: string, patch: BookingPatch, actor: Actor): Promise<{ before: BookingRow; after: BookingRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projectBooking).where(eq(schema.projectBooking.id, bookingId)).limit(1).for("update");
    if (!before) throw new ActionError("booking_not_found");
    const name = await projectName(tx, before.projectId);
    const [after] = await tx.update(schema.projectBooking).set({ ...patch, updatedAt: new Date() }).where(eq(schema.projectBooking.id, bookingId)).returning();
    if (before.minutes !== after.minutes || before.status !== after.status) await tellBooked(tx, after.personId, actor, { id: before.projectId, name }, after.weekStart);
    return { before, after };
  });
}

export async function deleteBooking(bookingId: string, actor: Actor): Promise<BookingRow> {
  return db().transaction(async (tx) => {
    const [row] = await tx.delete(schema.projectBooking).where(eq(schema.projectBooking.id, bookingId)).returning();
    if (!row) throw new ActionError("booking_not_found");
    const [project] = await tx.select({ name: schema.workProject.name }).from(schema.workProject).where(eq(schema.workProject.id, row.projectId)).limit(1);
    await tellBooked(tx, row.personId, actor, { id: row.projectId, name: project?.name ?? "" }, row.weekStart);
    return row;
  });
}

/**
 * The placeholder is found: every open booking of that role on the project (from `fromWeek` on)
 * becomes the person's. The role stays on the rows — "Motion designer" filled by Huy — so the
 * plan still reads the way it was made. A week the person already has on the project is merged:
 * the hours add up, and the placeholder's row goes. One notice for the person.
 */
export async function fillPlaceholder(projectId: string, input: { placeholderRole: string; personId: string; fromWeek: IsoDate | null }, actor: Actor): Promise<{ filled: { before: BookingRow; after: BookingRow }[]; merged: number }> {
  return db().transaction(async (tx) => {
    const name = await projectName(tx, projectId);
    await activePerson(tx, input.personId);
    const open = await tx
      .select()
      .from(schema.projectBooking)
      .where(and(eq(schema.projectBooking.projectId, projectId), isNull(schema.projectBooking.personId), eq(schema.projectBooking.placeholderRole, input.placeholderRole), input.fromWeek ? gte(schema.projectBooking.weekStart, input.fromWeek) : undefined))
      .orderBy(asc(schema.projectBooking.weekStart))
      .for("update");
    if (open.length === 0) throw new ActionError("booking_not_found");
    const own = await tx.select().from(schema.projectBooking).where(and(eq(schema.projectBooking.projectId, projectId), eq(schema.projectBooking.personId, input.personId), inArray(schema.projectBooking.weekStart, open.map((row) => row.weekStart)))).for("update");
    const ownWeek = new Map(own.map((row) => [row.weekStart, row]));
    const filled: { before: BookingRow; after: BookingRow }[] = [];
    let merged = 0;
    for (const before of open) {
      const mine = ownWeek.get(before.weekStart);
      if (mine) {
        // Confirmed wins: a person already confirmed on the week stays confirmed.
        const status = mine.status === "confirmed" || before.status === "confirmed" ? "confirmed" : "tentative";
        const [after] = await tx.update(schema.projectBooking).set({ minutes: mine.minutes + before.minutes, status, updatedAt: new Date() }).where(eq(schema.projectBooking.id, mine.id)).returning();
        await tx.delete(schema.projectBooking).where(eq(schema.projectBooking.id, before.id));
        filled.push({ before, after });
        merged += 1;
        continue;
      }
      const [after] = await tx.update(schema.projectBooking).set({ personId: input.personId, updatedAt: new Date() }).where(eq(schema.projectBooking.id, before.id)).returning();
      filled.push({ before, after });
    }
    await tellBooked(tx, input.personId, actor, { id: projectId, name }, open[0].weekStart);
    return { filled, merged };
  });
}
