// Who is using a paid seat (FR-AST-11). A licence or subscription has so many seats; each one in use
// is a row of `licence_seat`, given to a person or to a device — the Adobe seat of the edit suite
// belongs to the machine, whoever sits at it. A released row stays, so the table is also the
// history, and the number that matters to whoever pays is `seats − open rows`: money for nothing.
//
// The cap is checked under a lock on the licence row, so two keepers handing out the last seat at
// the same instant give it to one person. That nobody (and no machine) holds two seats of one
// subscription is two partial unique indexes; the check in code is for a decent message.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { cancelOpenTasksOfContext, createTasks } from "@/modules/platform/tasks-engine/service";
import vi from "../../../messages/vi.json";
import { UNASSIGNABLE_STATUSES } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type LicenceSeatRow = typeof schema.licenceSeat.$inferSelect;
type LicenceRow = typeof schema.licence.$inferSelect;

const now = () => new Date();
const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
const open = isNull(schema.licenceSeat.releasedAt);
const taskTitle = createTranslator({ locale: "vi", messages: vi, namespace: "assets.offboarding" });

const SEAT_CONTEXT = "licence_seat";
const RELEASE_TASK_KIND = "licence_seat_release";

export const licenceLink = (licenceId: string) => `/assets/licences/${licenceId}`;

// ── Giving a seat and taking it back ────────────────────────────────────────────────────────

/** Exactly one of the two: the person who uses it, or the device it is installed on. */
export type SeatInput = { licenceId: string; personId: string | null; assetId: string | null; note: string | null };

export async function assignSeat(input: SeatInput, actorPersonId: string, executor?: Tx): Promise<{ seat: LicenceSeatRow; licence: LicenceRow }> {
  if (!!input.personId === !!input.assetId) throw new ActionError("seat_holder_required");
  const run = async (tx: Tx) => {
    const [licence] = await tx.select().from(schema.licence).where(eq(schema.licence.id, input.licenceId)).limit(1).for("update");
    if (!licence) throw new ActionError("licence_not_found");
    if (licence.status !== "active") throw new ActionError("licence_not_active");

    if (input.personId) {
      const [person] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.personId)).limit(1);
      if (!person) throw new ActionError("seat_holder_unknown");
      if (person.status === "offboarded") throw new ActionError("seat_holder_inactive");
    } else {
      const [device] = await tx.select({ status: schema.asset.status }).from(schema.asset).where(eq(schema.asset.id, input.assetId!)).limit(1);
      if (!device) throw new ActionError("seat_holder_unknown");
      // A machine that is lost or written off runs nothing.
      if (UNASSIGNABLE_STATUSES.includes(device.status)) throw new ActionError("seat_device_unavailable");
    }

    // How many seats are in use, and whether this holder already has one: counted by the database, under the lock.
    const holds = input.personId ? eq(schema.licenceSeat.personId, input.personId) : eq(schema.licenceSeat.assetId, input.assetId!);
    const [tally] = await tx
      .select({ used: sql<number>`count(*)::int`, own: sql<number>`count(*) filter (where ${holds})::int` })
      .from(schema.licenceSeat)
      .where(and(eq(schema.licenceSeat.licenceId, input.licenceId), open));
    if (Number(tally.own) > 0) throw new ActionError("seat_already_assigned");
    if (licence.seats !== null && Number(tally.used) >= licence.seats) throw new ActionError("seat_none_free");

    try {
      const [seat] = await tx.insert(schema.licenceSeat).values({ licenceId: input.licenceId, personId: input.personId, assetId: input.assetId, note: input.note, assignedByPersonId: actorPersonId }).returning();
      return { seat, licence };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ActionError("seat_already_assigned");
      throw error;
    }
  };
  return executor ? run(executor) : db().transaction(run);
}

export async function findSeat(seatId: string, executor: Executor = db()): Promise<{ seat: LicenceSeatRow; licence: LicenceRow } | undefined> {
  const [row] = await executor
    .select({ seat: schema.licenceSeat, licence: schema.licence })
    .from(schema.licenceSeat)
    .innerJoin(schema.licence, eq(schema.licence.id, schema.licenceSeat.licenceId))
    .where(eq(schema.licenceSeat.id, seatId))
    .limit(1);
  return row;
}

/** Takes a seat back. Whatever an offboarding had asked of anyone about it is settled with it. */
export async function releaseSeat(seatId: string, note: string | null, actorPersonId: string | null, executor?: Tx): Promise<{ seat: LicenceSeatRow; licence: LicenceRow }> {
  const run = async (tx: Tx) => {
    const found = await findSeat(seatId, tx);
    if (!found) throw new ActionError("seat_not_found");
    if (found.seat.releasedAt) throw new ActionError("seat_already_released");
    const [seat] = await tx
      .update(schema.licenceSeat)
      .set({ releasedAt: now(), releasedByPersonId: actorPersonId, releaseNote: note?.trim() || null, updatedAt: now() })
      .where(and(eq(schema.licenceSeat.id, seatId), open))
      .returning();
    if (!seat) throw new ActionError("seat_already_released");
    await cancelOpenTasksOfContext(tx, { type: SEAT_CONTEXT, id: seatId });
    return { seat, licence: found.licence };
  };
  return executor ? run(executor) : db().transaction(run);
}

/** Every open seat matching the condition, released in one statement, with the tasks about them. */
async function releaseWhere(tx: Tx, condition: ReturnType<typeof eq>, note: string, actorPersonId: string | null): Promise<number> {
  const released = await tx.update(schema.licenceSeat).set({ releasedAt: now(), releasedByPersonId: actorPersonId, releaseNote: note, updatedAt: now() }).where(and(condition, open)).returning({ id: schema.licenceSeat.id });
  if (released.length === 0) return 0;
  await tx
    .update(schema.task)
    .set({ status: "cancelled", updatedAt: now() })
    .where(
      and(
        eq(schema.task.contextType, SEAT_CONTEXT),
        inArray(
          schema.task.contextId,
          released.map((row) => row.id),
        ),
        inArray(schema.task.status, ["todo", "in_progress"]),
      ),
    );
  return released.length;
}

/** A device was lost or written off: the seats installed on it are free again. */
export const releaseSeatsOfAsset = (tx: Tx, assetId: string, actorPersonId: string | null): Promise<number> => releaseWhere(tx, eq(schema.licenceSeat.assetId, assetId), taskTitle("deviceGoneNote"), actorPersonId);

/** A subscription was cancelled or ran out: it has no seats to hold. */
export const releaseSeatsOfLicence = (tx: Tx, licenceId: string, actorPersonId: string | null): Promise<number> => releaseWhere(tx, eq(schema.licenceSeat.licenceId, licenceId), taskTitle("licenceEndedNote"), actorPersonId);

/** How many seats of one licence are in use, inside the caller's transaction. */
export async function countOpenSeats(executor: Executor, licenceId: string): Promise<number> {
  const [row] = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.licenceSeat)
    .where(and(eq(schema.licenceSeat.licenceId, licenceId), open));
  return Number(row?.value ?? 0);
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

const seatPerson = alias(schema.person, "seat_person");
const deviceHolder = alias(schema.person, "device_holder");
const assigner = alias(schema.person, "seat_assigner");
const releaser = alias(schema.person, "seat_releaser");

export type SeatView = {
  id: string;
  personId: string | null;
  personName: string | null;
  assetId: string | null;
  assetCode: string | null;
  assetName: string | null;
  /** Who is holding the device the seat is on, when somebody is. */
  deviceHolderPersonId: string | null;
  deviceHolderName: string | null;
  assignedAt: Date;
  assignedByPersonId: string | null;
  assignedByName: string | null;
  note: string | null;
  releasedAt: Date | null;
  releasedByPersonId: string | null;
  releasedByName: string | null;
  releaseNote: string | null;
};

/** One licence's seats: those in use, and the last of those given back. */
export async function listSeatsOfLicence(licenceId: string, executor: Executor = db()): Promise<{ open: SeatView[]; released: SeatView[] }> {
  const rows = await executor
    .select({
      seat: schema.licenceSeat,
      personName: seatPerson.fullName,
      assetCode: schema.asset.code,
      assetName: schema.asset.name,
      deviceHolderPersonId: schema.assetAssignment.holderPersonId,
      deviceHolderName: deviceHolder.fullName,
      assignedByName: assigner.fullName,
      releasedByName: releaser.fullName,
    })
    .from(schema.licenceSeat)
    .leftJoin(seatPerson, eq(seatPerson.id, schema.licenceSeat.personId))
    .leftJoin(schema.asset, eq(schema.asset.id, schema.licenceSeat.assetId))
    .leftJoin(schema.assetAssignment, and(eq(schema.assetAssignment.assetId, schema.licenceSeat.assetId), isNull(schema.assetAssignment.returnedAt)))
    .leftJoin(deviceHolder, eq(deviceHolder.id, schema.assetAssignment.holderPersonId))
    .leftJoin(assigner, eq(assigner.id, schema.licenceSeat.assignedByPersonId))
    .leftJoin(releaser, eq(releaser.id, schema.licenceSeat.releasedByPersonId))
    .where(eq(schema.licenceSeat.licenceId, licenceId))
    // Seats in use first, by who or what holds them; then the most recently released.
    .orderBy(sql`${schema.licenceSeat.releasedAt} is not null`, desc(schema.licenceSeat.releasedAt), asc(seatPerson.fullName), asc(schema.asset.code))
    .limit(300);
  const views = rows.map(({ seat, ...names }) => ({
    id: seat.id,
    personId: seat.personId,
    assetId: seat.assetId,
    assignedAt: seat.assignedAt,
    assignedByPersonId: seat.assignedByPersonId,
    note: seat.note,
    releasedAt: seat.releasedAt,
    releasedByPersonId: seat.releasedByPersonId,
    releaseNote: seat.releaseNote,
    ...names,
  }));
  return { open: views.filter((seat) => !seat.releasedAt), released: views.filter((seat) => seat.releasedAt).slice(0, 30) };
}

export type HeldSeat = {
  seatId: string;
  licenceId: string;
  name: string;
  vendor: string | null;
  assignedAt: Date;
  /** Set when the seat is on a device the person holds, not on the person. */ viaAsset: { id: string; code: string; name: string } | null;
};

/**
 * The software one person uses: seats in their own name, and seats on the devices they are holding.
 * Their own list, and their record keeper's — never with a price on it.
 */
export async function listSeatsOfPerson(personId: string, executor: Executor = db()): Promise<HeldSeat[]> {
  const rows = await executor
    .select({ seat: schema.licenceSeat, name: schema.licence.name, vendor: schema.licence.vendor, assetCode: schema.asset.code, assetName: schema.asset.name })
    .from(schema.licenceSeat)
    .innerJoin(schema.licence, eq(schema.licence.id, schema.licenceSeat.licenceId))
    .leftJoin(schema.asset, eq(schema.asset.id, schema.licenceSeat.assetId))
    .where(and(open, sql`(${schema.licenceSeat.personId} = ${personId} or ${schema.licenceSeat.assetId} in (select a.asset_id from asset_assignment a where a.holder_person_id = ${personId} and a.returned_at is null))`))
    .orderBy(asc(schema.licence.name), asc(schema.licenceSeat.assignedAt));
  return rows.map(({ seat, name, vendor, assetCode, assetName }) => ({
    seatId: seat.id,
    licenceId: seat.licenceId,
    name,
    vendor,
    assignedAt: seat.assignedAt,
    viaAsset: seat.assetId && assetCode && assetName ? { id: seat.assetId, code: assetCode, name: assetName } : null,
  }));
}

/** What is installed on one device. */
export async function listSeatsOfAsset(assetId: string, executor: Executor = db()): Promise<{ seatId: string; licenceId: string; name: string; vendor: string | null; assignedAt: Date }[]> {
  return executor
    .select({ seatId: schema.licenceSeat.id, licenceId: schema.licenceSeat.licenceId, name: schema.licence.name, vendor: schema.licence.vendor, assignedAt: schema.licenceSeat.assignedAt })
    .from(schema.licenceSeat)
    .innerJoin(schema.licence, eq(schema.licence.id, schema.licenceSeat.licenceId))
    .where(and(eq(schema.licenceSeat.assetId, assetId), open))
    .orderBy(asc(schema.licence.name));
}

// ── What the lifecycle asks of the register ─────────────────────────────────────────────────

/**
 * When somebody leaves: one task per seat in their own name, given to whoever looks after that
 * subscription (else the leaver's manager, else the register's keeper), due by the last working
 * day. A seat on a device is not theirs to give back — it goes with the machine.
 */
export async function openSeatReleaseTasks(tx: Tx, leaver: { personId: string; lastDay: IsoDate; managerId: string | null; keepers: readonly string[] }, actorPersonId: string | null): Promise<number> {
  const seats = await tx
    .select({ id: schema.licenceSeat.id, licenceId: schema.licence.id, name: schema.licence.name, ownerPersonId: schema.licence.ownerPersonId, entityId: schema.licence.entityId })
    .from(schema.licenceSeat)
    .innerJoin(schema.licence, eq(schema.licence.id, schema.licenceSeat.licenceId))
    .where(and(eq(schema.licenceSeat.personId, leaver.personId), open));
  if (seats.length === 0) return 0;
  const existing = await tx
    .select({ contextId: schema.task.contextId })
    .from(schema.task)
    .where(
      and(
        eq(schema.task.contextType, SEAT_CONTEXT),
        inArray(
          schema.task.contextId,
          seats.map((seat) => seat.id),
        ),
        inArray(schema.task.status, ["todo", "in_progress"]),
      ),
    );
  const alreadyOpen = new Set(existing.map((row) => row.contextId));
  const wanted = seats.filter((seat) => !alreadyOpen.has(seat.id));
  if (wanted.length === 0) return 0;
  await createTasks(
    tx,
    wanted.map((seat) => ({
      kind: RELEASE_TASK_KIND,
      title: taskTitle("releaseSeat", { licence: seat.name }),
      assigneePersonId: (seat.ownerPersonId && seat.ownerPersonId !== leaver.personId ? seat.ownerPersonId : null) ?? leaver.managerId ?? leaver.keepers[0] ?? null,
      subjectPersonId: leaver.personId,
      dueDate: leaver.lastDay,
      entityId: seat.entityId,
      linkUrl: licenceLink(seat.licenceId),
      context: { type: SEAT_CONTEXT, id: seat.id },
    })),
    actorPersonId,
    { notify: true },
  );
  return wanted.length;
}

/** A termination called off: the tasks go with it. Seats already taken back stay taken back. */
export async function cancelSeatReleaseTasks(tx: Tx, personId: string): Promise<number> {
  const cancelled = await tx
    .update(schema.task)
    .set({ status: "cancelled", updatedAt: now() })
    .where(and(eq(schema.task.kind, RELEASE_TASK_KIND), eq(schema.task.subjectPersonId, personId), inArray(schema.task.status, ["todo", "in_progress"])))
    .returning({ id: schema.task.id });
  return cancelled.length;
}
