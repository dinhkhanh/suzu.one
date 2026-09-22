// Check-in and check-out from the app (FR-ATT-03, 04), the review of flagged check-ins, and
// "who's in today" (FR-ATT-15). The time of a punch is the server's clock, always.
import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getLeaveOnDays } from "@/modules/leave/service";
import { matchesReach, permissionReach, type Principal, tierReach } from "@/modules/platform/rbac/policy";
import type { DayPlan } from "./engine/calendar";
import { evaluatePunch, type Position, type PunchFlag, type WorkLocationRule } from "./engine/geofence";
import { listAllLocations } from "./locations";
import { anyReachSql } from "./people-sql";
import { canSeePunchDetailOf } from "./policy";
import { requestTimesheetRecompute } from "./recompute";
import { declaredOffSiteLocations } from "./request-inputs";
import { getDayPlans } from "./schedules";

type Executor = Tx | ReturnType<typeof db>;
export type PunchRow = typeof schema.punch.$inferSelect;
export type Direction = "in" | "out";

/** A second tap within this many seconds is the same punch, not a new one. */
const DOUBLE_TAP_SECONDS = 120;
/** How far back an open check-in still counts as "in" (an overnight shift, a forgotten check-out). */
const OPEN_PUNCH_HOURS = 20;

/** Vietnam has no daylight saving: a business date starts at 00:00 +07:00. */
export const startOfVietnamDay = (date: IsoDate): Date => new Date(`${date}T00:00:00+07:00`);

const asRule = (row: typeof schema.workLocation.$inferSelect): WorkLocationRule => ({ id: row.id, latitude: row.latitude, longitude: row.longitude, radiusM: row.radiusM, accuracyLimitM: row.accuracyLimitM, ipAllowlist: row.ipAllowlist, rule: row.rule, mode: row.mode });

const offSiteLocationsFor = declaredOffSiteLocations;

// A rejected punch does not count, anywhere.
const counted = ne(schema.punch.reviewStatus, "rejected");

async function lastOpenPunch(executor: Executor, personId: string, now: Date): Promise<PunchRow | null> {
  const since = new Date(now.getTime() - OPEN_PUNCH_HOURS * 3_600_000);
  const [row] = await executor.select().from(schema.punch).where(and(eq(schema.punch.personId, personId), gte(schema.punch.at, since), counted)).orderBy(desc(schema.punch.at)).limit(1);
  return row ?? null;
}

export type AppPunchInput = {
  person: { id: string; primaryEntityId: string | null; status: string };
  direction: Direction;
  position: Position | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: Record<string, string | number | boolean> | null;
  note: string | null;
};

export type AppPunchResult = { punch: PunchRow; outcome: "accepted" | "flagged"; flags: PunchFlag[]; locationName: string | null; /** The same tap arrived twice: nothing new was written. */ duplicate: boolean };

/**
 * One check-in or check-out. Out-of-policy punches are kept and flagged for the line manager or HR
 * — unless every location the person could be at says "block" (FR-ATT-04). Short by design: three
 * statements in one transaction, so the morning peak stays fast.
 */
export async function recordAppPunch(input: AppPunchInput, now: Date = new Date()): Promise<AppPunchResult> {
  const { person } = input;
  if (person.status !== "active" || !person.primaryEntityId) throw new ActionError("punch_not_employed");
  const entityId = person.primaryEntityId;
  const today = todayInVietnam(now);

  return db().transaction(async (tx) => {
    // One punch at a time per person: two tabs tapping at once must not both pass the checks below.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`punch:${person.id}`}))`);
    const [locations, last, declared] = await Promise.all([
      tx.select().from(schema.workLocation).where(and(eq(schema.workLocation.entityId, entityId), eq(schema.workLocation.isActive, true))),
      lastOpenPunch(tx, person.id, now),
      offSiteLocationsFor(tx, person.id, today),
    ]);
    const nameOf = (locationId: string | null) => locations.find((row) => row.id === locationId)?.name ?? null;

    if (last && last.direction === input.direction && last.source === "app") {
      if (now.getTime() - last.at.getTime() < DOUBLE_TAP_SECONDS * 1000) return { punch: last, outcome: last.flags.length ? "flagged" : "accepted", flags: last.flags, locationName: nameOf(last.locationId), duplicate: true };
    }
    if (last && last.direction === "in" && input.direction === "in" && todayInVietnam(last.at) === today) throw new ActionError("punch_already_in");

    const verdict = evaluatePunch({ locations: [...locations.map(asRule), ...declared], position: input.position, ip: input.ipAddress });
    if (verdict.outcome === "blocked") throw new ActionError("punch_blocked", { flags: verdict.flags, distanceM: verdict.distanceM });

    // Only the entity's own locations are rows; a declared off-site place is not.
    const locationId = locations.some((row) => row.id === verdict.locationId) ? verdict.locationId : null;
    const needsReview = verdict.flags.some((flag) => flag !== "off_site_declared");
    const [punch] = await tx
      .insert(schema.punch)
      .values({
        personId: person.id,
        entityId,
        at: now,
        direction: input.direction,
        source: "app",
        latitude: input.position?.latitude ?? null,
        longitude: input.position?.longitude ?? null,
        accuracyM: input.position ? Math.round(input.position.accuracyM) : null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        deviceInfo: input.deviceInfo,
        locationId,
        distanceM: verdict.distanceM,
        flags: verdict.flags,
        reviewStatus: needsReview ? "pending" : "none",
        note: input.note,
      })
      .returning();
    // A punch is an input of the day's timesheet (FR-ATT-09) — and of yesterday's, when it closes an overnight shift.
    await requestTimesheetRecompute([person.id], addDays(today, -1), today, tx);
    return { punch, outcome: needsReview ? "flagged" : "accepted", flags: verdict.flags, locationName: nameOf(locationId), duplicate: false };
  });
}

// ── The check-in screen ─────────────────────────────────────────────────────────────────────

export type CheckInState = {
  today: IsoDate;
  plan: DayPlan | null;
  /** What the big button does next. */
  nextDirection: Direction;
  punches: { id: string; at: Date; direction: Direction; flags: PunchFlag[]; reviewStatus: PunchRow["reviewStatus"]; locationName: string | null }[];
  /** Approved leave today: a warning, never a block (plans change). */
  leaveToday: { portion: string }[];
  hasLocations: boolean;
};

export async function getCheckInState(person: { id: string; primaryEntityId: string | null }, now: Date = new Date()): Promise<CheckInState> {
  const today = todayInVietnam(now);
  const [plans, rows, last, leave, allLocations] = await Promise.all([
    getDayPlans([person.id], today, today),
    db()
      .select({ punch: schema.punch, locationName: schema.workLocation.name })
      .from(schema.punch)
      .leftJoin(schema.workLocation, eq(schema.workLocation.id, schema.punch.locationId))
      .where(and(eq(schema.punch.personId, person.id), gte(schema.punch.at, startOfVietnamDay(today))))
      .orderBy(asc(schema.punch.at)),
    lastOpenPunch(db(), person.id, now),
    getLeaveOnDays([person.id], today, today),
    person.primaryEntityId ? listAllLocations() : [],
  ]);
  const locations = allLocations.filter((row) => row.entityId === person.primaryEntityId && row.isActive).length;
  return {
    today,
    plan: plans.get(person.id)?.days[0] ?? null,
    nextDirection: last?.direction === "in" ? "out" : "in",
    punches: rows.map(({ punch, locationName }) => ({ id: punch.id, at: punch.at, direction: punch.direction, flags: punch.flags, reviewStatus: punch.reviewStatus, locationName })),
    leaveToday: leave.map((day) => ({ portion: day.portion })),
    hasLocations: locations > 0,
  };
}

// ── Review of flagged punches ───────────────────────────────────────────────────────────────

export type FlaggedPunch = {
  id: string;
  personId: string;
  personName: string;
  at: Date;
  direction: Direction;
  flags: PunchFlag[];
  distanceM: number | null;
  accuracyM: number | null;
  latitude: number | null;
  longitude: number | null;
  ipAddress: string | null;
  note: string | null;
  reviewStatus: PunchRow["reviewStatus"];
  reviewNote: string | null;
  reviewerName: string | null;
  nearestLocationName: string | null;
};

const personTarget = (person: { id: string; primaryEntityId: string | null; orgUnitPath: string[]; managerId: string | null }) => ({ personId: person.id, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId });

/** Flagged punches of the people the viewer reviews (reports; HR's scope) — never the viewer's own. Waiting ones first. */
export async function listFlaggedPunches(viewer: { personId: string; principal: Principal }, options: { sinceDays?: number; now?: Date } = {}): Promise<FlaggedPunch[]> {
  const since = startOfVietnamDay(addDays(todayInVietnam(options.now), -(options.sinceDays ?? 31)));
  const reach = permissionReach(viewer.principal, "attendance:manage");
  const rows = await db()
    .select({ punch: schema.punch, person: schema.person })
    .from(schema.punch)
    .innerJoin(schema.person, eq(schema.person.id, schema.punch.personId))
    .where(and(ne(schema.punch.reviewStatus, "none"), gte(schema.punch.at, since), ne(schema.person.id, viewer.personId), anyReachSql([reach], eq(schema.person.managerId, viewer.personId))))
    .orderBy(sql`${schema.punch.reviewStatus} = 'pending' desc`, desc(schema.punch.at))
    .limit(300);
  const mine = rows.filter(({ person }) => person.id !== viewer.personId && (person.managerId === viewer.personId || matchesReach(reach, personTarget(person))));
  if (mine.length === 0) return [];

  const reviewerIds = [...new Set(mine.flatMap(({ punch }) => (punch.reviewedByPersonId ? [punch.reviewedByPersonId] : [])))];
  const [reviewers, locations] = await Promise.all([
    reviewerIds.length ? db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, reviewerIds)) : [],
    listAllLocations().then((rows) => rows.filter((row) => row.isActive)),
  ]);
  return mine.map(({ punch, person }) => {
    const entityLocations = locations.filter((row) => row.entityId === punch.entityId);
    return {
      id: punch.id,
      personId: person.id,
      personName: person.fullName,
      at: punch.at,
      direction: punch.direction,
      flags: punch.flags,
      distanceM: punch.distanceM,
      accuracyM: punch.accuracyM,
      latitude: punch.latitude,
      longitude: punch.longitude,
      ipAddress: punch.ipAddress,
      note: punch.note,
      reviewStatus: punch.reviewStatus,
      reviewNote: punch.reviewNote,
      reviewerName: reviewers.find((row) => row.id === punch.reviewedByPersonId)?.fullName ?? null,
      // With one office the distance speaks for itself; with several, the name would be a guess.
      nearestLocationName: entityLocations.length === 1 ? entityLocations[0].name : null,
    };
  });
}

/** How many flagged punches wait for the viewer — the same people as `listFlaggedPunches`, counted in the database. */
export async function countPunchesToReview(viewer: { personId: string; principal: Principal }, options: { now?: Date } = {}): Promise<number> {
  const since = startOfVietnamDay(addDays(todayInVietnam(options.now), -31));
  const reach = permissionReach(viewer.principal, "attendance:manage");
  const [{ value }] = await db()
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.punch)
    .innerJoin(schema.person, eq(schema.person.id, schema.punch.personId))
    .where(and(eq(schema.punch.reviewStatus, "pending"), gte(schema.punch.at, since), ne(schema.person.id, viewer.personId), anyReachSql([reach], eq(schema.person.managerId, viewer.personId))));
  return value;
}

export async function getPunch(id: string, executor: Executor = db()): Promise<PunchRow | null> {
  const [row] = await executor.select().from(schema.punch).where(eq(schema.punch.id, id)).limit(1);
  return row ?? null;
}

/** The reviewer's answer to a flagged punch. Rejecting needs a reason; a rejected punch no longer counts. */
export async function reviewPunch(punchId: string, reviewerPersonId: string, input: { decision: "accept" | "reject"; note: string | null }): Promise<{ before: PunchRow; after: PunchRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.punch).where(eq(schema.punch.id, punchId)).limit(1).for("update");
    if (!before) throw new ActionError("punch_not_found");
    if (before.reviewStatus !== "pending") throw new ActionError("punch_not_pending");
    if (before.personId === reviewerPersonId) throw new ActionError("punch_own");
    if (input.decision === "reject" && !input.note?.trim()) throw new ActionError("punch_review_note_required");
    const [after] = await tx
      .update(schema.punch)
      .set({ reviewStatus: input.decision === "accept" ? "accepted" : "rejected", reviewedByPersonId: reviewerPersonId, reviewedAt: new Date(), reviewNote: input.note?.trim() || null })
      .where(eq(schema.punch.id, punchId))
      .returning();
    // Rejecting takes the punch out of the day; accepting changes nothing the timesheet counts, but costs nothing to re-run.
    const day = todayInVietnam(after.at);
    await requestTimesheetRecompute([after.personId], addDays(day, -1), day, tx);
    return { before, after };
  });
}

// ── Who's in today (FR-ATT-15) ──────────────────────────────────────────────────────────────

export type PresenceStatus = "in" | "out" | "not_yet" | "on_leave" | "off_site" | "untracked" | "rest" | "holiday" | "unscheduled";
export type PresenceRow = {
  personId: string;
  fullName: string;
  departmentName: string | null;
  isSelf: boolean;
  status: PresenceStatus;
  /** Half-day leave on a day the person is otherwise expected. */
  partLeave: boolean;
  /** Times are for whoever may see the person's punches (self, line manager, HR); null for colleagues. */
  firstInAt: Date | null;
  lastOutAt: Date | null;
  flagged: boolean | null;
};
export type Presence = { date: IsoDate; rows: PresenceRow[]; departments: { id: string; name: string }[]; counts: Record<PresenceStatus, number> };

/**
 * Everyone the viewer may see, with where they stand today: their own group (team, or department
 * within the entity), their reports, and for HR and department heads their scope. Status only —
 * no position, no address, and for colleagues no times and no reason for an absence.
 */
export async function getWhoIsIn(viewer: { personId: string; principal: Principal }, options: { departmentId?: string | null } = {}, now: Date = new Date()): Promise<Presence> {
  const today = todayInVietnam(now);
  const hrReach = permissionReach(viewer.principal, "attendance:manage");
  const personalReach = tierReach(viewer.principal, "personal");
  const collaborator = viewer.principal.workforceType === "collaborator";
  // The viewer's own group, asked of the viewer's row in the same query: their team, or without one their department within the entity.
  const viewerRow = alias(schema.person, "me");
  const inMyGroup = sql`exists (select 1 from ${schema.person} as ${sql.identifier("me")} where ${viewerRow.id} = ${viewer.personId} and ${viewerRow.status} = 'active' and (case when ${viewerRow.teamId} is not null then ${schema.person.teamId} = ${viewerRow.teamId} else ${viewerRow.departmentId} is not null and ${schema.person.departmentId} = ${viewerRow.departmentId} and ${schema.person.primaryEntityId} is not distinct from ${viewerRow.primaryEntityId} end))`;
  const everyone = await db()
    .select({
      person: { id: schema.person.id, fullName: schema.person.fullName, primaryEntityId: schema.person.primaryEntityId, departmentId: schema.person.departmentId, teamId: schema.person.teamId, orgUnitPath: schema.person.orgUnitPath, managerId: schema.person.managerId },
      departmentName: schema.orgUnit.name,
    })
    .from(schema.person)
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId))
    .where(and(eq(schema.person.status, "active"), anyReachSql([hrReach, personalReach], eq(schema.person.id, viewer.personId), eq(schema.person.managerId, viewer.personId), collaborator ? undefined : inMyGroup)));
  const me = everyone.find((row) => row.person.id === viewer.personId)?.person;
  // Collaborators have no directory: they see themselves only.
  const sameGroup = (person: (typeof everyone)[number]["person"]) =>
    !!me && !collaborator && (me.teamId ? person.teamId === me.teamId : !!me.departmentId && person.departmentId === me.departmentId && person.primaryEntityId === me.primaryEntityId);
  const visible = everyone.filter(({ person }) => person.id === viewer.personId || sameGroup(person) || person.managerId === viewer.personId || matchesReach(hrReach, personTarget(person)) || matchesReach(personalReach, personTarget(person)));
  const departments = [...new Map(visible.flatMap((row) => (row.person.departmentId && row.departmentName ? [[row.person.departmentId, { id: row.person.departmentId, name: row.departmentName }] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const shown = visible.filter((row) => !options.departmentId || row.person.departmentId === options.departmentId);
  const ids = shown.map((row) => row.person.id);

  const dayStart = startOfVietnamDay(today);
  const [plans, leave, punches] = await Promise.all([
    getDayPlans(ids, today, today),
    getLeaveOnDays(ids, today, today),
    ids.length
      ? db()
          .select({ personId: schema.punch.personId, at: schema.punch.at, direction: schema.punch.direction, flags: schema.punch.flags, reviewStatus: schema.punch.reviewStatus })
          .from(schema.punch)
          .where(and(inArray(schema.punch.personId, ids), gte(schema.punch.at, new Date(dayStart.getTime() - OPEN_PUNCH_HOURS * 3_600_000)), lt(schema.punch.at, startOfVietnamDay(addDays(today, 1))), counted))
          .orderBy(asc(schema.punch.at))
      : [],
  ]);

  const punchesOf = new Map<string, typeof punches>();
  for (const row of punches) punchesOf.set(row.personId, [...(punchesOf.get(row.personId) ?? []), row]);
  const leaveOf = new Map<string, typeof leave>();
  for (const day of leave) leaveOf.set(day.personId, [...(leaveOf.get(day.personId) ?? []), day]);
  const counts = { in: 0, out: 0, not_yet: 0, on_leave: 0, off_site: 0, untracked: 0, rest: 0, holiday: 0, unscheduled: 0 } satisfies Record<PresenceStatus, number>;
  const rows = shown
    .map(({ person, departmentName }): PresenceRow => {
      const plan = plans.get(person.id)?.days[0];
      const own = punchesOf.get(person.id) ?? [];
      const todays = own.filter((row) => row.at >= dayStart);
      const last = own.at(-1);
      const away = leaveOf.get(person.id) ?? [];
      const fullDayLeave = away.some((day) => day.portion === "full");

      let status: PresenceStatus;
      // Someone who came in anyway is in, whatever the plan said; an open check-in from last night's shift counts too.
      if (last?.direction === "in") status = last.flags.includes("off_site_declared") ? "off_site" : "in";
      else if (todays.length > 0) status = "out";
      else if (fullDayLeave) status = "on_leave";
      else if (!plan || plan.kind === "unscheduled") status = "unscheduled";
      else if (plan.kind === "working") status = "not_yet";
      else if (plan.kind === "untracked") status = "untracked";
      else if (plan.kind === "rest") status = "rest";
      else status = "holiday";
      // A half day's leave: expected for the other half, so "not yet" until they arrive.
      const partLeave = !fullDayLeave && away.length > 0;
      counts[status]++;

      const detailed = canSeePunchDetailOf(viewer.principal, personTarget(person));
      return {
        personId: person.id,
        fullName: person.fullName,
        departmentName,
        isSelf: person.id === viewer.personId,
        status,
        partLeave,
        firstInAt: detailed ? (todays.find((row) => row.direction === "in")?.at ?? null) : null,
        lastOutAt: detailed ? (todays.findLast((row) => row.direction === "out")?.at ?? null) : null,
        flagged: detailed ? todays.some((row) => row.reviewStatus === "pending") : null,
      };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.fullName.localeCompare(b.fullName, "vi"));
  return { date: today, rows, departments, counts };
}

// ── For the timesheet (week 4) and other modules ────────────────────────────────────────────

export type PunchFact = { id: string; personId: string; at: Date; direction: Direction; source: PunchRow["source"]; flags: PunchFlag[]; reviewStatus: PunchRow["reviewStatus"] };

/** Every punch that counts (rejected ones left out) in [from 00:00, to + 1 day 00:00) Vietnam time, oldest first. */
export async function listPunches(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<PunchFact[]> {
  if (personIds.length === 0 || to < from) return [];
  return executor
    .select({ id: schema.punch.id, personId: schema.punch.personId, at: schema.punch.at, direction: schema.punch.direction, source: schema.punch.source, flags: schema.punch.flags, reviewStatus: schema.punch.reviewStatus })
    .from(schema.punch)
    .where(and(inArray(schema.punch.personId, [...new Set(personIds)]), gte(schema.punch.at, startOfVietnamDay(from)), lt(schema.punch.at, startOfVietnamDay(addDays(to, 1))), counted))
    .orderBy(asc(schema.punch.at));
}
