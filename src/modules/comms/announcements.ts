// Announcements (FR-COM-01): targeted, pinned, scheduled, with read tracking and an optional
// "I have read this". Both directions of the audience are SQL: which announcements name the
// viewer (`visibleSql`), and which people an announcement names (`audiencePeople`).
import "server-only";
import { and, arrayOverlaps, asc, desc, eq, inArray, isNull, lte, type SQL, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { currentBranchOf, findBranchEntity, listPeopleAtBranches } from "../core-hr/service";
import { notify } from "../platform/notifications/service";
import { unitChoices, unitPathsOf } from "../platform/org/service";
import type { Principal } from "../platform/rbac/policy";
import { type AnnouncementPhase, parseAudienceKey } from "./enums";
import { type AudienceTarget, canManageAnnouncement, canPostTo, canReadAnnouncement, type CommsViewer, commsViewerKeys, phaseOf } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
const { announcement, announcementAudience, announcementRead, entity, orgUnit, person } = schema;

export type AnnouncementRow = typeof schema.announcement.$inferSelect;

type ViewerSource = { person: { id: string; primaryEntityId: string | null; orgUnitId: string | null; orgUnitPath: readonly string[] }; principal: Principal };

/** The viewer with their audience keys. The branch comes from today's primary assignment. */
export async function commsViewerOf(user: ViewerSource, today: IsoDate = todayInVietnam()): Promise<CommsViewer> {
  const branchId = user.principal.workforceType === "collaborator" ? null : await currentBranchOf(user.person.id, today);
  return { principal: user.principal, personId: user.person.id, keys: commsViewerKeys(user.principal, { entityId: user.person.primaryEntityId, unitPath: user.person.orgUnitPath, unitId: user.person.orgUnitId, branchId }) };
}

// ── The audience ────────────────────────────────────────────────────────────────────────────

/** Where each audience key sits, for the posting rule. A key that names nothing gets `target: null` and is refused. */
export async function resolveAudienceTargets(keys: readonly string[], executor: Executor = db()): Promise<AudienceTarget[]> {
  const targets: AudienceTarget[] = [];
  for (const key of [...new Set(keys)]) {
    const subject = parseAudienceKey(key);
    if (!subject) targets.push({ key, target: null });
    else if (subject.type === "all") targets.push({ key, target: {} });
    else if (subject.type === "entity") {
      const [row] = await executor.select({ id: entity.id }).from(entity).where(eq(entity.id, subject.id!)).limit(1);
      targets.push({ key, target: row ? { entityId: row.id } : null });
    } else if (subject.type === "unit" || subject.type === "unit_only") {
      // Posting to a unit takes the permission over that unit — which a grant on any unit above it
      // carries, so the path is the target.
      const [row] = await executor.select({ id: orgUnit.id, entityId: orgUnit.entityId, path: orgUnit.path }).from(orgUnit).where(eq(orgUnit.id, subject.id!)).limit(1);
      targets.push({ key, target: row ? { unitPath: row.path, entityId: row.entityId } : null });
    } else if (subject.type === "branch") {
      const row = await findBranchEntity(subject.id!, executor);
      targets.push({ key, target: row ? { entityId: row.entityId } : null });
    } else {
      const [row] = await executor.select().from(person).where(eq(person.id, subject.id!)).limit(1);
      targets.push({ key, target: row ? { personId: row.id, entityId: row.primaryEntityId, unitPath: row.orgUnitPath, managerId: row.managerId } : null });
    }
  }
  return targets;
}

/** The one entity all targets sit in, else null — kept on the row for the audit log's entity filter. */
const commonEntity = (targets: readonly AudienceTarget[]): string | null => {
  const ids = new Set(targets.map(({ target }) => target?.entityId ?? null));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
};

// "unit:<id>" for any unit on the person's path: naming a unit reaches everyone below it (FR-PLT-16).
function unitKeysSql(keys: readonly string[]): SQL {
  const unitIds = keys.flatMap((key) => (key.startsWith("unit:") ? [key.slice("unit:".length)] : []));
  return unitIds.length ? arrayOverlaps(person.orgUnitPath, unitIds) : sql`false`;
}

/** `person` (un-aliased) is named by one of the keys. Branch membership arrives as a list of people: it lives in core-hr. */
function personInAudienceSql(keys: readonly string[], branchPeople: readonly string[]): SQL {
  const list = [...keys];
  if (list.length === 0) return sql`false`;
  return sql`(${inArray(sql`'person:' || ${person.id}::text`, list)} or (${person.workforceType} <> 'collaborator' and (
    ${list.includes("all") ? sql`true` : sql`false`}
    or ${inArray(sql`'entity:' || ${person.primaryEntityId}::text`, list)}
    or ${unitKeysSql(list)}
    or ${inArray(sql`'unit_only:' || ${person.orgUnitId}::text`, list)}
    or ${branchPeople.length ? inArray(person.id, [...branchPeople]) : sql`false`})))`;
}

export type AudiencePerson = { personId: string; fullName: string; departmentName: string | null };

/** The active people an audience names today. */
export async function audiencePeople(keys: readonly string[], executor: Executor = db(), today: IsoDate = todayInVietnam()): Promise<AudiencePerson[]> {
  const branchIds = keys.flatMap((key) => {
    const subject = parseAudienceKey(key);
    return subject?.type === "branch" && subject.id ? [subject.id] : [];
  });
  const branchPeople = await listPeopleAtBranches(branchIds, today, executor);
  return executor
    .select({ personId: person.id, fullName: person.fullName, departmentName: orgUnit.name })
    .from(person)
    .leftJoin(orgUnit, eq(orgUnit.id, person.departmentId))
    .where(and(eq(person.status, "active"), personInAudienceSql(keys, branchPeople)))
    .orderBy(asc(person.searchName));
}

const liveSql = (): SQL => sql`${announcement.status} = 'published' and ${announcement.publishAt} <= now() and (${announcement.expiresAt} is null or ${announcement.expiresAt} > now())`;

/** Announcements the viewer reads: live, and the audience names them. `announcement` un-aliased. */
export function visibleSql(viewer: CommsViewer): SQL {
  if (viewer.keys.length === 0) return sql`false`;
  return sql`${liveSql()} and exists (select 1 from ${announcementAudience} where ${announcementAudience.announcementId} = ${announcement.id} and ${inArray(announcementAudience.subjectKey, [...viewer.keys])})`;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type AnnouncementCard = { id: string; title: string; excerpt: string; pinned: boolean; mustAcknowledge: boolean; publishAt: Date; authorName: string; read: boolean; acknowledged: boolean };

const excerptOf = (body: string, max = 220) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

export async function listAnnouncementsFor(viewer: CommsViewer, options: { limit?: number; offset?: number; onlyPendingAck?: boolean } = {}): Promise<AnnouncementCard[]> {
  const rows = await db()
    .select({ row: announcement, authorName: person.fullName, readAt: announcementRead.readAt, acknowledgedAt: announcementRead.acknowledgedAt })
    .from(announcement)
    .innerJoin(person, eq(person.id, announcement.authorPersonId))
    .leftJoin(announcementRead, and(eq(announcementRead.announcementId, announcement.id), eq(announcementRead.personId, viewer.personId)))
    .where(and(visibleSql(viewer), options.onlyPendingAck ? and(eq(announcement.mustAcknowledge, true), isNull(announcementRead.acknowledgedAt)) : undefined))
    .orderBy(desc(announcement.pinned), desc(announcement.publishAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
  return rows.map(({ row, authorName, readAt, acknowledgedAt }) => ({ id: row.id, title: row.title, excerpt: excerptOf(row.body), pinned: row.pinned, mustAcknowledge: row.mustAcknowledge, publishAt: row.publishAt!, authorName, read: !!readAt, acknowledged: !!acknowledgedAt }));
}

export async function countUnreadAnnouncements(viewer: CommsViewer): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(announcement)
    .where(and(visibleSql(viewer), sql`not exists (select 1 from ${announcementRead} where ${announcementRead.announcementId} = ${announcement.id} and ${announcementRead.personId} = ${viewer.personId})`));
  return row?.n ?? 0;
}

export type LoadedAnnouncement = { row: AnnouncementRow; audience: string[]; targets: AudienceTarget[]; authorName: string };

export async function loadAnnouncement(id: string, executor: Executor = db()): Promise<LoadedAnnouncement | null> {
  const [found] = await executor.select({ row: announcement, authorName: person.fullName }).from(announcement).innerJoin(person, eq(person.id, announcement.authorPersonId)).where(eq(announcement.id, id)).limit(1);
  if (!found) return null;
  const audience = (await executor.select({ key: announcementAudience.subjectKey }).from(announcementAudience).where(eq(announcementAudience.announcementId, id)).orderBy(asc(announcementAudience.subjectKey))).map((row) => row.key);
  return { ...found, audience, targets: await resolveAudienceTargets(audience, executor) };
}

export const mayManage = (principal: Principal, loaded: LoadedAnnouncement): boolean => canManageAnnouncement(principal, loaded.row, loaded.targets);
export const mayRead = (viewer: CommsViewer, loaded: LoadedAnnouncement, now: Date = new Date()): boolean => canReadAnnouncement(viewer, loaded.row, loaded.audience, now);

export type AnnouncementView = LoadedAnnouncement & { phase: AnnouncementPhase; canManage: boolean; isReader: boolean; readAt: Date | null; acknowledgedAt: Date | null };

/** What the viewer may open: a live announcement aimed at them, or any they manage. null = not theirs to see. */
export async function getAnnouncementView(viewer: CommsViewer, id: string): Promise<AnnouncementView | null> {
  const loaded = await loadAnnouncement(id);
  if (!loaded) return null;
  const now = new Date();
  const canManage = mayManage(viewer.principal, loaded);
  const isReader = mayRead(viewer, loaded, now);
  if (!canManage && !isReader) return null;
  const [mark] = await db().select().from(announcementRead).where(and(eq(announcementRead.announcementId, id), eq(announcementRead.personId, viewer.personId))).limit(1);
  return { ...loaded, phase: phaseOf(loaded.row, now), canManage, isReader, readAt: mark?.readAt ?? null, acknowledgedAt: mark?.acknowledgedAt ?? null };
}

/** Opening it is reading it. Idempotent; only someone in the audience leaves a mark. */
export async function markAnnouncementRead(viewer: CommsViewer, id: string): Promise<boolean> {
  const loaded = await loadAnnouncement(id);
  if (!loaded || !mayRead(viewer, loaded)) return false;
  const fresh = await db().insert(announcementRead).values({ announcementId: id, personId: viewer.personId }).onConflictDoNothing().returning({ id: announcementRead.id });
  return fresh.length > 0;
}

export async function acknowledgeAnnouncement(viewer: CommsViewer, id: string): Promise<{ row: AnnouncementRow; first: boolean }> {
  const loaded = await loadAnnouncement(id);
  if (!loaded || !mayRead(viewer, loaded)) throw new ActionError("comms_announcement_not_found");
  if (!loaded.row.mustAcknowledge) throw new ActionError("comms_ack_not_asked");
  const now = new Date();
  await db().insert(announcementRead).values({ announcementId: id, personId: viewer.personId, readAt: now }).onConflictDoNothing();
  const changed = await db().update(announcementRead).set({ acknowledgedAt: now }).where(and(eq(announcementRead.announcementId, id), eq(announcementRead.personId, viewer.personId), isNull(announcementRead.acknowledgedAt))).returning({ id: announcementRead.id });
  return { row: loaded.row, first: changed.length > 0 };
}

// ── Managing ────────────────────────────────────────────────────────────────────────────────

export type ManagedRow = { id: string; title: string; phase: AnnouncementPhase; pinned: boolean; mustAcknowledge: boolean; publishAt: Date | null; expiresAt: Date | null; authorName: string; audience: string[]; updatedAt: Date };

/** Everything the viewer may manage. The rule needs each row's resolved targets, so the (short) list is checked row by row with the pure policy. */
export async function listManagedAnnouncements(principal: Principal, limit = 200): Promise<ManagedRow[]> {
  const rows = await db().select({ id: announcement.id }).from(announcement).orderBy(desc(announcement.updatedAt)).limit(limit);
  const now = new Date();
  const result: ManagedRow[] = [];
  for (const { id } of rows) {
    const loaded = await loadAnnouncement(id);
    if (!loaded || !mayManage(principal, loaded)) continue;
    const { row } = loaded;
    result.push({ id: row.id, title: row.title, phase: phaseOf(row, now), pinned: row.pinned, mustAcknowledge: row.mustAcknowledge, publishAt: row.publishAt, expiresAt: row.expiresAt, authorName: loaded.authorName, audience: loaded.audience, updatedAt: row.updatedAt });
  }
  return result;
}

export type AnnouncementInput = { title: string; body: string; kbPageId: string | null; pinned: boolean; mustAcknowledge: boolean; expiresAt: Date | null; audience: string[] };

/** May the principal address this audience? The action's authorization, before anything is written. */
export async function mayPostTo(principal: Principal, audience: readonly string[]): Promise<boolean> {
  return canPostTo(principal, await resolveAudienceTargets(audience));
}

async function writeAudience(tx: Tx, id: string, audience: readonly string[]) {
  await tx.delete(announcementAudience).where(eq(announcementAudience.announcementId, id));
  await tx.insert(announcementAudience).values([...new Set(audience)].map((subjectKey) => ({ announcementId: id, subjectKey })));
}

export async function createAnnouncement(input: AnnouncementInput, authorPersonId: string): Promise<AnnouncementRow> {
  if (input.audience.length === 0) throw new ActionError("comms_audience_required");
  return db().transaction(async (tx) => {
    const targets = await resolveAudienceTargets(input.audience, tx);
    const { audience, ...values } = input;
    const [row] = await tx.insert(announcement).values({ ...values, entityId: commonEntity(targets), authorPersonId }).returning();
    await writeAudience(tx, row.id, audience);
    return row;
  });
}

/** Text, options and audience. Changing the audience of something already announced does not notify anyone again. */
export async function updateAnnouncement(id: string, input: AnnouncementInput): Promise<{ before: AnnouncementRow; after: AnnouncementRow; audienceBefore: string[] }> {
  if (input.audience.length === 0) throw new ActionError("comms_audience_required");
  return db().transaction(async (tx) => {
    const loaded = await loadAnnouncement(id, tx);
    if (!loaded) throw new ActionError("comms_announcement_not_found");
    if (loaded.row.status === "archived") throw new ActionError("comms_announcement_archived");
    const targets = await resolveAudienceTargets(input.audience, tx);
    const { audience, ...values } = input;
    const [after] = await tx.update(announcement).set({ ...values, entityId: commonEntity(targets), updatedAt: new Date() }).where(eq(announcement.id, id)).returning();
    await writeAudience(tx, id, audience);
    return { before: loaded.row, after, audienceBefore: loaded.audience };
  });
}

async function notifyAudience(tx: Tx, row: AnnouncementRow): Promise<number> {
  const keys = (await tx.select({ key: announcementAudience.subjectKey }).from(announcementAudience).where(eq(announcementAudience.announcementId, row.id))).map((found) => found.key);
  const recipients = (await audiencePeople(keys, tx)).map((found) => found.personId).filter((personId) => personId !== row.authorPersonId);
  const [author] = await tx.select({ name: person.fullName }).from(person).where(eq(person.id, row.authorPersonId)).limit(1);
  if (recipients.length) await notify({ recipients, kind: "comms.announcement", params: { title: row.title, name: author?.name ?? "", must: row.mustAcknowledge ? "yes" : "no" }, link: `/announcements/${row.id}` }, tx);
  await tx.update(announcement).set({ notifiedAt: new Date() }).where(eq(announcement.id, row.id));
  return recipients.length;
}

/** Publish now (`publishAt` null or past) or schedule. The audience is told at once when it is live, by the job otherwise. */
export async function publishAnnouncement(id: string, publishAt: Date | null): Promise<{ before: AnnouncementRow; after: AnnouncementRow; notified: number }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(announcement).where(eq(announcement.id, id)).limit(1).for("update");
    if (!before) throw new ActionError("comms_announcement_not_found");
    if (before.status === "archived") throw new ActionError("comms_announcement_archived");
    const now = new Date();
    const at = publishAt && publishAt > now ? publishAt : now;
    // Already announced and already live: its date stays what people saw.
    const keepDate = before.status === "published" && before.publishAt && before.publishAt <= now;
    if (before.expiresAt && before.expiresAt <= at) throw new ActionError("comms_expires_before_publish");
    const [after] = await tx.update(announcement).set({ status: "published", publishAt: keepDate ? before.publishAt : at, updatedAt: now }).where(eq(announcement.id, id)).returning();
    const notified = !after.notifiedAt && after.publishAt! <= now ? await notifyAudience(tx, after) : 0;
    return { before, after, notified };
  });
}

export async function setAnnouncementState(id: string, change: { archive?: boolean; pinned?: boolean }): Promise<{ before: AnnouncementRow; after: AnnouncementRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(announcement).where(eq(announcement.id, id)).limit(1).for("update");
    if (!before) throw new ActionError("comms_announcement_not_found");
    const [after] = await tx
      .update(announcement)
      .set({ ...(change.archive ? { status: "archived" as const, pinned: false } : {}), ...(change.pinned === undefined || change.archive ? {} : { pinned: change.pinned }), updatedAt: new Date() })
      .where(eq(announcement.id, id))
      .returning();
    return { before, after };
  });
}

/** The job: scheduled announcements whose hour has come and whose audience has not been told. Each is told once. */
export async function notifyDueAnnouncements(): Promise<{ announcements: number; notified: number }> {
  const due = await db().select({ id: announcement.id }).from(announcement).where(and(eq(announcement.status, "published"), isNull(announcement.notifiedAt), lte(announcement.publishAt, new Date())));
  let notified = 0;
  let announcements = 0;
  for (const { id } of due) {
    await db().transaction(async (tx) => {
      const [row] = await tx.select().from(announcement).where(and(eq(announcement.id, id), isNull(announcement.notifiedAt))).limit(1).for("update");
      if (!row) return;
      // Expired before anyone was told: nothing to say, but never look at it again.
      if (row.expiresAt && row.expiresAt <= new Date()) await tx.update(announcement).set({ notifiedAt: new Date() }).where(eq(announcement.id, id));
      else notified += await notifyAudience(tx, row);
      announcements++;
    });
  }
  return { announcements, notified };
}

// ── Read tracking ───────────────────────────────────────────────────────────────────────────

export type ReadReport = {
  total: number;
  read: number;
  acknowledged: number;
  byDepartment: { departmentName: string | null; total: number; read: number; acknowledged: number }[];
  people: { personId: string; fullName: string; departmentName: string | null; readAt: Date | null; acknowledgedAt: Date | null }[];
};

export async function getReadReport(id: string): Promise<ReadReport | null> {
  const loaded = await loadAnnouncement(id);
  if (!loaded) return null;
  const audience = await audiencePeople(loaded.audience);
  const marks = new Map((await db().select().from(announcementRead).where(eq(announcementRead.announcementId, id))).map((mark) => [mark.personId, mark]));
  const people = audience.map((member) => ({ ...member, readAt: marks.get(member.personId)?.readAt ?? null, acknowledgedAt: marks.get(member.personId)?.acknowledgedAt ?? null }));
  const byDepartment = [...Map.groupBy(people, (member) => member.departmentName)].map(([departmentName, members]) => ({ departmentName, total: members.length, read: members.filter((member) => member.readAt).length, acknowledged: members.filter((member) => member.acknowledgedAt).length }));
  return { total: people.length, read: people.filter((member) => member.readAt).length, acknowledged: people.filter((member) => member.acknowledgedAt).length, byDepartment, people };
}

// ── The audience picker ─────────────────────────────────────────────────────────────────────

type Option = { id: string; name: string };
export type AudienceOptions = { all: boolean; entities: Option[]; units: Option[]; branches: Option[]; people: Option[] };

/** Only what the principal may address: a department head's picker holds their unit, the units below it and their people, nothing else. */
export async function audienceOptionsFor(principal: Principal): Promise<AudienceOptions> {
  const [entities, units, branches, people] = await Promise.all([
    db().select().from(entity).orderBy(asc(entity.shortName)),
    unitChoices(),
    db().select().from(schema.branch).orderBy(asc(schema.branch.name)),
    db().select().from(person).where(eq(person.status, "active")).orderBy(asc(person.searchName)),
  ]);
  const unitPaths = await unitPathsOf(units.map((unit) => unit.id));
  const may = (target: AudienceTarget["target"]) => canPostTo(principal, [{ key: "", target }]);
  return {
    all: may({}),
    entities: entities.filter((row) => may({ entityId: row.id })).map((row) => ({ id: row.id, name: row.shortName })),
    units: units.filter((row) => may({ unitPath: unitPaths.get(row.id) ?? [] })),
    branches: branches.filter((row) => may({ entityId: row.entityId })).map((row) => ({ id: row.id, name: row.name })),
    people: people.filter((row) => may({ personId: row.id, entityId: row.primaryEntityId, unitPath: row.orgUnitPath })).map((row) => ({ id: row.id, name: row.fullName })),
  };
}

/** Names for audience keys ("entity:<id>" → "Media"); "all" and the type are put into words by the screen. */
export async function audienceNames(keys: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const tables = { entity: [entity, entity.shortName], unit: [orgUnit, orgUnit.name], unit_only: [orgUnit, orgUnit.name], branch: [schema.branch, schema.branch.name], person: [person, person.fullName] } as const;
  for (const type of ["entity", "unit", "unit_only", "branch", "person"] as const) {
    const wanted = keys.flatMap((key) => (key.startsWith(`${type}:`) ? [key.slice(type.length + 1)] : []));
    if (wanted.length === 0) continue;
    const [table, column] = tables[type];
    const rows = await db().select({ id: table.id, name: column }).from(table).where(inArray(table.id, wanted));
    for (const row of rows) names.set(`${type}:${row.id}`, row.name);
  }
  return names;
}
