// The capacity page (FR-PJM-13): people × the coming weeks — hours available (their work schedule,
// less approved leave and the entity's holidays), confirmed bookings as the load, tentative ones
// beside it, over-allocation flagged. The same sources as the workload view (FR-WRK-13), through
// their modules' services: attendance's day plans and days off, leave's approved days.
//
// Who is on the page is the list form of `canSeeCapacityOf`: the whole directory, filtered by the
// policy in memory, so the two can never disagree. Leave shows only as "away" — the type never
// leaves this file. Skills (FR-CHR-14) are not recorded anywhere yet: the page filters by position.
import "server-only";
import { and, asc, between, eq, inArray, isNull } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDayPlans, getDaysOff } from "@/modules/attendance/service";
import { listPositionHolders, listPositions } from "@/modules/core-hr/service";
import { loadReportReader } from "@/modules/daily/service";
import { getLeaveOnDays } from "@/modules/leave/service";
import { loadDirectory } from "@/modules/performance/service";
import type { CurrentUser } from "../platform/auth/session";
import { canViewProject, loadViewer, notePrivateProjectReads, projectFacts, type WorkViewer } from "../work/service";
import { type BookingStatus, capacity, type CapacityRow, type PlannedDay, type Week, weeksFrom } from "./engine/capacity";
import { type CapacityReader, type CapacitySubject, canOpenCapacity, canSeeCapacityOf } from "./policy";

export const CAPACITY_WEEKS = 8;

export type CapacityPerson = { id: string; fullName: string; entityId: string | null; positionId: string | null; positionName: string | null; teamIds: string[] };
/** A booking in a cell. `projectName` is null for a project the viewer may not open: the hours count, the name stays private. */
export type CellBooking = { projectId: string | null; projectName: string | null; weekStart: IsoDate; minutes: number; status: BookingStatus };
export type OpenPlaceholder = { projectId: string; projectName: string; placeholderRole: string; weeks: { weekStart: IsoDate; minutes: number; status: BookingStatus }[] };
export type CapacityFilters = { teamId?: string | null; positionId?: string | null; /** Only people with at least this many free hours in some week. */ freeMinutes?: number | null; from?: IsoDate | null };
export type CapacityView = {
  weeks: Week[];
  teams: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  rows: CapacityRow<CapacityPerson>[];
  bookings: Map<string, CellBooking[]>;
  openPlaceholders: OpenPlaceholder[];
  daysOff: { date: IsoDate; name: string }[];
};

export type LoadedReader = { reader: CapacityReader; managesSomeone: boolean; mayOpen: boolean };

export async function loadCapacityReader(user: Pick<CurrentUser, "person" | "principal">): Promise<LoadedReader> {
  const [{ ledTeamIds }, directory] = await Promise.all([loadReportReader(user.person.id), loadDirectory()]);
  const reader: CapacityReader = { personId: user.person.id, principal: user.principal, ledTeamIds };
  const managesSomeone = [...directory.values()].some((person) => person.status !== "offboarded" && person.chainAbove.includes(user.person.id));
  return { reader, managesSomeone, mayOpen: canOpenCapacity(reader, managesSomeone) };
}

/** Active work teams of these people. */
async function teamsOf(personIds: readonly string[]): Promise<{ teamIdsOf: Map<string, string[]>; names: Map<string, string> }> {
  if (personIds.length === 0) return { teamIdsOf: new Map(), names: new Map() };
  const rows = await db()
    .select({ personId: schema.workTeamMember.personId, teamId: schema.workTeam.id, name: schema.workTeam.name })
    .from(schema.workTeamMember)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTeamMember.teamId))
    .where(and(inArray(schema.workTeamMember.personId, [...personIds]), eq(schema.workTeam.isActive, true)));
  const teamIdsOf = new Map<string, string[]>();
  for (const row of rows) teamIdsOf.set(row.personId, [...(teamIdsOf.get(row.personId) ?? []), row.teamId]);
  return { teamIdsOf, names: new Map(rows.map((row) => [row.teamId, row.name])) };
}

/**
 * Everyone whose capacity the reader may see — the list form of `canSeeCapacityOf` over the
 * directory (active and pre-boarding people). A test keeps the two in step.
 */
export async function listCapacitySubjects(reader: CapacityReader): Promise<(CapacitySubject & { fullName: string })[]> {
  const directory = await loadDirectory();
  const people = [...directory.values()].filter((person) => person.status === "active" || person.status === "preboarding");
  const { teamIdsOf } = await teamsOf(people.map((person) => person.personId));
  return people
    .map((person) => ({ personId: person.personId, fullName: person.fullName, teamIds: teamIdsOf.get(person.personId) ?? [], chainAbove: person.chainAbove, entityId: person.entityId ?? null, unitPath: person.unitPath ?? null }))
    .filter((subject) => canSeeCapacityOf(reader, subject))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
}

/** Day plans, approved leave, days off and bookings of these people over the weeks, through the capacity engine. */
async function computeCapacity<Person extends { id: string; entityId: string | null }>(people: readonly Person[], weeks: readonly Week[]) {
  const ids = people.map((person) => person.id);
  const range = { from: weeks[0].start, to: addDays(weeks.at(-1)!.start, 6) };
  const [plans, leave, bookingRows, ...calendars] = await Promise.all([
    getDayPlans(ids, range.from, range.to),
    getLeaveOnDays(ids, range.from, range.to),
    db()
      .select({ booking: schema.projectBooking, project: schema.workProject, team: schema.workTeam })
      .from(schema.projectBooking)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBooking.projectId))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
      .where(and(inArray(schema.projectBooking.personId, ids), between(schema.projectBooking.weekStart, range.from, range.to))),
    ...[...new Set(people.map((person) => person.entityId))].map(async (entityId) => [entityId, await getDaysOff(entityId, range.from, range.to)] as const),
  ]);
  const offByEntity = new Map(calendars.map(([entityId, days]) => [entityId, new Set(days.map((day) => day.date))]));
  const rows = capacity({
    people,
    weeks,
    days: (person): PlannedDay[] => plans.get(person.id)?.days.map((day) => ({ date: day.date, kind: day.kind, requiredMinutes: day.requiredMinutes })) ?? [],
    // The leave module tells us the type; this view must not. Keep the date and the portion only.
    leave: leave.map((day) => ({ personId: day.personId, date: day.date, days: day.amountCenti / 100, minutes: day.minutes })),
    bookings: bookingRows.map(({ booking }) => ({ personId: booking.personId!, weekStart: booking.weekStart, minutes: booking.minutes, status: booking.status as BookingStatus })),
    daysOff: (person) => offByEntity.get(person.entityId) ?? new Set(),
  });
  return { rows, bookingRows, calendars };
}

/** null = the reader plans nobody's time: the page answers notFound(). */
export async function getCapacity(user: Pick<CurrentUser, "person" | "principal">, today: IsoDate, filters: CapacityFilters = {}): Promise<CapacityView | null> {
  const loaded = await loadCapacityReader(user);
  if (!loaded.mayOpen) return null;
  const [subjects, viewer, holders, positionList] = await Promise.all([listCapacitySubjects(loaded.reader), loadViewer(user), listPositionHolders(today), listPositions()]);
  const weeks = weeksFrom(filters.from ?? today, CAPACITY_WEEKS);
  const range = { from: weeks[0].start, to: weeks.at(-1)!.end };
  const positionOf = new Map(holders.map((holder) => [holder.personId, holder.positionId]));
  const positionName = new Map(positionList.map((position) => [position.id, position.name]));
  const { names: teamNames } = await teamsOf(subjects.map((subject) => subject.personId));

  // The filter choices come from everyone the reader may see, before filtering.
  const teams = [...new Set(subjects.flatMap((subject) => subject.teamIds))].map((id) => ({ id, name: teamNames.get(id) ?? "" })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const positions = [...new Set(subjects.flatMap((subject) => positionOf.get(subject.personId) ?? []))].map((id) => ({ id, name: positionName.get(id) ?? "" })).sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const chosen = subjects.filter((subject) => (!filters.teamId || subject.teamIds.includes(filters.teamId)) && (!filters.positionId || positionOf.get(subject.personId) === filters.positionId));
  const people: CapacityPerson[] = chosen.map((subject) => {
    const positionId = positionOf.get(subject.personId) ?? null;
    return { id: subject.personId, fullName: subject.fullName, entityId: subject.entityId, positionId, positionName: positionId ? (positionName.get(positionId) ?? null) : null, teamIds: [...subject.teamIds] };
  });
  const openPlaceholders = await listOpenPlaceholders(viewer, range);
  if (people.length === 0) return { weeks, teams, positions, rows: [], bookings: new Map(), openPlaceholders, daysOff: [] };
  const { rows, bookingRows, calendars } = await computeCapacity(people, weeks);

  const bookings = new Map<string, CellBooking[]>();
  // A private project named in a cell is read by a leader who is none of its people: recorded once
  // for the grid, however many cells it fills (Q25).
  const read = new Map<string, ReturnType<typeof projectFacts>>();
  for (const { booking, project, team } of bookingRows) {
    const facts = projectFacts(project, team);
    const readable = canViewProject(viewer, facts);
    if (readable) read.set(project.id, facts);
    const key = `${booking.personId}:${booking.weekStart}`;
    bookings.set(key, [...(bookings.get(key) ?? []), { projectId: readable ? project.id : null, projectName: readable ? project.name : null, weekStart: booking.weekStart, minutes: booking.minutes, status: booking.status as BookingStatus }]);
  }
  await notePrivateProjectReads(viewer, read.values());
  const free = filters.freeMinutes ?? null;
  const shown = free === null ? rows : rows.filter((row) => row.cells.some((cell) => cell.freeMinutes >= free));
  const named = new Map(calendars.flatMap(([, days]) => days.map((day) => [day.date, day.name] as const)));
  return { weeks, teams, positions, rows: shown, bookings, openPlaceholders, daysOff: [...named].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Placeholder bookings nobody fills yet, on projects the viewer may open: demand still to staff. */
async function listOpenPlaceholders(viewer: WorkViewer, range: { from: IsoDate; to: IsoDate }): Promise<OpenPlaceholder[]> {
  const rows = await db()
    .select({ booking: schema.projectBooking, project: schema.workProject, team: schema.workTeam })
    .from(schema.projectBooking)
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBooking.projectId))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
    .where(and(isNull(schema.projectBooking.personId), between(schema.projectBooking.weekStart, range.from, range.to)))
    .orderBy(asc(schema.workProject.name), asc(schema.projectBooking.placeholderRole), asc(schema.projectBooking.weekStart));
  const result = new Map<string, OpenPlaceholder>();
  const read = new Map<string, ReturnType<typeof projectFacts>>();
  for (const { booking, project, team } of rows) {
    const facts = projectFacts(project, team);
    if (!booking.placeholderRole || !canViewProject(viewer, facts)) continue;
    read.set(project.id, facts);
    const key = `${project.id}:${booking.placeholderRole}`;
    const entry = result.get(key) ?? { projectId: project.id, projectName: project.name, placeholderRole: booking.placeholderRole, weeks: [] };
    entry.weeks.push({ weekStart: booking.weekStart, minutes: booking.minutes, status: booking.status as BookingStatus });
    result.set(key, entry);
  }
  await notePrivateProjectReads(viewer, read.values());
  return [...result.values()];
}

/**
 * The capacity of the people booked on one project, for the project's Team tab — only of those
 * the viewer may see capacity of (a project lead who is not their team lead sees the bookings, not
 * the person's availability).
 */
export async function capacityOfBooked(user: Pick<CurrentUser, "person" | "principal">, personIds: readonly string[], weeks: readonly Week[]): Promise<Map<string, CapacityRow<{ id: string; entityId: string | null }>>> {
  const result = new Map<string, CapacityRow<{ id: string; entityId: string | null }>>();
  if (personIds.length === 0 || weeks.length === 0) return result;
  const { reader } = await loadCapacityReader(user);
  const [directory, { teamIdsOf }] = await Promise.all([loadDirectory(), teamsOf(personIds)]);
  const people = [...new Set(personIds)].flatMap((personId) => {
    const person = directory.get(personId);
    if (!person) return [];
    const subject: CapacitySubject = { personId, teamIds: teamIdsOf.get(personId) ?? [], chainAbove: person.chainAbove, entityId: person.entityId ?? null, unitPath: person.unitPath ?? null };
    return canSeeCapacityOf(reader, subject) ? [{ id: personId, entityId: subject.entityId }] : [];
  });
  if (people.length === 0) return result;
  const { rows } = await computeCapacity(people, weeks);
  for (const row of rows) result.set(row.person.id, row);
  return result;
}
