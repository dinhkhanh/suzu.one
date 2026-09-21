// Policy acknowledgement (FR-KB-05). A page marked "must read" names an audience; everyone in it
// confirms the version in `kb_page.ack_version_id`. That version moves forward only when a MAJOR
// revision is published — then everybody confirms again; a minor revision asks nothing of those
// who already confirmed.
//
// The audience is matched in SQL against the people table as it is today, so someone who joins
// later owes the confirmation without anybody doing anything. Due date: `ack_due_days` after the
// requirement took effect (`ack_since`), or after the person came onto the books if that is later.
// Collaborators are in an audience only when named in person.
import "server-only";
import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { loadGrants } from "../platform/rbac/service";
import { pagePublishedVisibleSql } from "./access-sql";
import { parseSubjectKey } from "./enums";
import { loadPage, type PageRow } from "./pages";
import { canViewPage, type KbViewer, viewerKeys } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
const { kbAckAudience, kbAckReminder, kbAcknowledgement, kbPage, kbPageVersion, kbSpace, person } = schema;

export const ACK_REMINDER_EVERY_DAYS = 3;
export const ACK_AUDIENCE_TYPES = ["all", "entity", "department", "team", "person"] as const;

/** `person` is in the audience of `kb_page` (both un-aliased in the query). */
const inAudienceSql = (): SQL => sql`exists (select 1 from ${kbAckAudience} where ${kbAckAudience.pageId} = ${kbPage.id} and (
  ${kbAckAudience.subjectKey} = 'person:' || ${person.id}::text
  or (${person.workforceType} <> 'collaborator' and (
    ${kbAckAudience.subjectKey} = 'all'
    or ${kbAckAudience.subjectKey} = 'entity:' || ${person.primaryEntityId}::text
    or ${kbAckAudience.subjectKey} = 'department:' || ${person.departmentId}::text
    or ${kbAckAudience.subjectKey} = 'team:' || ${person.teamId}::text))))`;

const confirmedSql = (): SQL => sql`exists (select 1 from ${kbAcknowledgement} where ${kbAcknowledgement.pageId} = ${kbPage.id} and ${kbAcknowledgement.versionId} = ${kbPage.ackVersionId} and ${kbAcknowledgement.personId} = ${person.id})`;

/** A page whose confirmation is being collected: switched on, published, not archived or deleted. */
const collectingSql = (): SQL => sql`${kbPage.ackRequired} and ${kbPage.ackVersionId} is not null and ${kbPage.deletedAt} is null and ${kbPage.status} <> 'archived' and ${kbPage.publishedVersionId} is not null`;

const vnDate = (value: Date): IsoDate => todayInVietnam(value);
export const ackDueOn = (page: { ackSince: Date | null; ackDueDays: number }, personCreatedAt: Date): IsoDate => addDays(vnDate(page.ackSince && page.ackSince > personCreatedAt ? page.ackSince : personCreatedAt), page.ackDueDays);

// ── Setting the requirement ─────────────────────────────────────────────────────────────────

export type AckSettings = { required: boolean; dueDays: number; audience: string[] };

export async function getAckSettings(pageId: string, executor: Executor = db()): Promise<string[]> {
  const rows = await executor.select({ subjectKey: kbAckAudience.subjectKey }).from(kbAckAudience).where(eq(kbAckAudience.pageId, pageId)).orderBy(asc(kbAckAudience.createdAt));
  return rows.map((row) => row.subjectKey);
}

export async function setAckRequirement(pageId: string, input: AckSettings): Promise<{ before: PageRow; after: PageRow; audienceBefore: string[]; audience: string[]; notified: number }> {
  const audience = [...new Set(input.audience)];
  for (const key of audience) {
    const subject = parseSubjectKey(key);
    if (!subject || !(ACK_AUDIENCE_TYPES as readonly string[]).includes(subject.type)) throw new ActionError("kb_subject_unknown");
  }
  if (input.required && audience.length === 0) throw new ActionError("kb_ack_audience_required");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(kbPage).where(and(eq(kbPage.id, pageId), isNull(kbPage.deletedAt))).limit(1).for("update");
    if (!before) throw new ActionError("kb_page_not_found");
    const audienceBefore = await getAckSettings(pageId, tx);
    await tx.delete(kbAckAudience).where(eq(kbAckAudience.pageId, pageId));
    if (audience.length) await tx.insert(kbAckAudience).values(audience.map((subjectKey) => ({ pageId, subjectKey })));
    // Switched on for a page that is already published: what is published now is what people confirm.
    const starts = input.required && !before.ackVersionId && !!before.publishedVersionId;
    const [after] = await tx
      .update(kbPage)
      .set({ ackRequired: input.required, ackDueDays: input.dueDays, ...(starts ? { ackVersionId: before.publishedVersionId, ackSince: new Date() } : {}), updatedAt: new Date() })
      .where(eq(kbPage.id, pageId))
      .returning();
    const notified = after.ackRequired ? await askNewlyOwing(tx, after, todayInVietnam()) : 0;
    return { before, after, audienceBefore, audience, notified };
  });
}

/** Called by `publishPage`, inside its transaction: a major revision (or the first publication) restarts the confirmation. */
export async function ackOnPublish(tx: Tx, page: PageRow, version: { id: string; isMajor: boolean }): Promise<PageRow> {
  if (!page.ackRequired || (page.ackVersionId && !version.isMajor)) return page;
  const [after] = await tx.update(kbPage).set({ ackVersionId: version.id, ackSince: new Date() }).where(eq(kbPage.id, page.id)).returning();
  await askNewlyOwing(tx, after, todayInVietnam());
  return after;
}

// ── Who owes what ───────────────────────────────────────────────────────────────────────────

type Owing = { personId: string; createdAt: Date };

async function pendingPeople(executor: Executor, pageId: string): Promise<Owing[]> {
  return executor
    .select({ personId: person.id, createdAt: person.createdAt })
    .from(person)
    .innerJoin(kbPage, eq(kbPage.id, pageId))
    .where(and(eq(person.status, "active"), collectingSql(), inAudienceSql(), sql`not ${confirmedSql()}`));
}

/** A viewer for someone who is not signed in (the reminder job): can they open the page at all? */
async function viewerFor(executor: Executor, personId: string): Promise<KbViewer | null> {
  const [row] = await executor.select().from(person).where(eq(person.id, personId)).limit(1);
  if (!row) return null;
  const principal = { personId: row.id, workforceType: row.workforceType, grants: await loadGrants(row.id, todayInVietnam(), executor) };
  return { principal, personId: row.id, keys: viewerKeys(principal, { entityId: row.primaryEntityId, unitId: row.orgUnitId, unitPath: row.orgUnitPath }) };
}

const dueText = (date: IsoDate) => date.split("-").reverse().join("/");

/** Sends at most one notice per person, version and day; returns how many went out. Nobody is asked to confirm a page they cannot open. */
async function sendNotices(tx: Tx, page: PageRow, people: readonly Owing[], today: IsoDate, kind: "requested" | "reminder"): Promise<number> {
  if (!page.ackVersionId || people.length === 0) return 0;
  const loaded = await loadPage(page.id, tx);
  if (!loaded) return 0;
  let sent = 0;
  for (const owing of people) {
    const viewer = await viewerFor(tx, owing.personId);
    if (!viewer || !canViewPage(viewer, loaded.facts, loaded.pageFacts)) continue;
    const dueOn = ackDueOn(page, owing.createdAt);
    const overdue = dueOn < today;
    const [fresh] = await tx
      .insert(kbAckReminder)
      .values({ pageId: page.id, versionId: page.ackVersionId, personId: owing.personId, sentOn: today, kind: kind === "requested" ? "requested" : overdue ? "overdue" : "reminder" })
      .onConflictDoNothing()
      .returning({ id: kbAckReminder.id });
    if (!fresh) continue;
    await notify({ recipients: [owing.personId], kind: kind === "requested" ? "kb.ack_requested" : "kb.ack_reminder", params: { title: page.publishedTitle ?? page.title, dueDate: dueText(dueOn), overdue: overdue ? "yes" : "no" }, link: `/kb/pages/${page.id}` }, tx);
    sent++;
  }
  return sent;
}

/** The first notice, to everyone pending who has had none for this version (new requirement, new major version, new joiner, wider audience). */
async function askNewlyOwing(tx: Tx, page: PageRow, today: IsoDate): Promise<number> {
  if (!page.ackVersionId) return 0;
  const pending = await pendingPeople(tx, page.id);
  const told = new Set((await tx.select({ personId: kbAckReminder.personId }).from(kbAckReminder).where(and(eq(kbAckReminder.pageId, page.id), eq(kbAckReminder.versionId, page.ackVersionId)))).map((row) => row.personId));
  return sendNotices(tx, page, pending.filter((owing) => !told.has(owing.personId)), today, "requested");
}

/** HR's "remind now": everyone still pending, whatever the rhythm — but never twice on one day. */
export async function remindPendingNow(pageId: string, today: IsoDate = todayInVietnam()): Promise<{ page: PageRow; reminded: number; pending: number }> {
  return db().transaction(async (tx) => {
    const [page] = await tx.select().from(kbPage).where(and(eq(kbPage.id, pageId), isNull(kbPage.deletedAt))).limit(1);
    if (!page) throw new ActionError("kb_page_not_found");
    if (!page.ackRequired || !page.ackVersionId) throw new ActionError("kb_ack_not_required");
    const pending = await pendingPeople(tx, pageId);
    return { page, reminded: await sendNotices(tx, page, pending, today, "reminder"), pending: pending.length };
  });
}

/**
 * The daily job: a first notice to whoever has had none (new joiners), then a reminder every
 * `ACK_REMINDER_EVERY_DAYS` days while the confirmation is pending — worded as overdue once it is.
 */
export async function sendAckReminders(today: IsoDate = todayInVietnam()): Promise<{ pages: number; requested: number; reminded: number }> {
  const pages = await db().select().from(kbPage).where(collectingSql());
  const result = { pages: pages.length, requested: 0, reminded: 0 };
  for (const page of pages) {
    await db().transaction(async (tx) => {
      result.requested += await askNewlyOwing(tx, page, today);
      const pending = await pendingPeople(tx, page.id);
      const last = await tx
        .select({ personId: kbAckReminder.personId, sentOn: sql<IsoDate>`max(${kbAckReminder.sentOn})` })
        .from(kbAckReminder)
        .where(and(eq(kbAckReminder.pageId, page.id), eq(kbAckReminder.versionId, page.ackVersionId!)))
        .groupBy(kbAckReminder.personId);
      const lastBy = new Map(last.map((row) => [row.personId, row.sentOn]));
      const due = pending.filter((owing) => {
        const sentOn = lastBy.get(owing.personId);
        return !!sentOn && addDays(sentOn, ACK_REMINDER_EVERY_DAYS) <= today;
      });
      result.reminded += await sendNotices(tx, page, due, today, "reminder");
    });
  }
  return result;
}

// ── The reader ──────────────────────────────────────────────────────────────────────────────

export type AckStatus = { required: boolean; inAudience: boolean; versionNo: number | null; acknowledgedAt: Date | null; dueOn: IsoDate | null; overdue: boolean };

/** What the reading view shows this person about the page's confirmation. */
export async function getAckStatus(page: PageRow, personId: string, today: IsoDate = todayInVietnam()): Promise<AckStatus> {
  const none: AckStatus = { required: false, inAudience: false, versionNo: null, acknowledgedAt: null, dueOn: null, overdue: false };
  if (!page.ackRequired || !page.ackVersionId) return none;
  const [row] = await db()
    .select({ createdAt: person.createdAt, versionNo: kbPageVersion.versionNo, acknowledgedAt: kbAcknowledgement.acknowledgedAt })
    .from(person)
    .innerJoin(kbPage, eq(kbPage.id, page.id))
    .innerJoin(kbPageVersion, eq(kbPageVersion.id, kbPage.ackVersionId))
    .leftJoin(kbAcknowledgement, and(eq(kbAcknowledgement.pageId, kbPage.id), eq(kbAcknowledgement.versionId, kbPage.ackVersionId), eq(kbAcknowledgement.personId, person.id)))
    .where(and(eq(person.id, personId), eq(person.status, "active"), inAudienceSql()))
    .limit(1);
  if (!row) return { ...none, required: true };
  const dueOn = ackDueOn(page, row.createdAt);
  return { required: true, inAudience: true, versionNo: row.versionNo, acknowledgedAt: row.acknowledgedAt, dueOn, overdue: !row.acknowledgedAt && dueOn < today };
}

/** "I have read and understood." Only for someone in the audience; twice is once. The caller has checked that they can open the page. */
export async function acknowledgePage(pageId: string, personId: string): Promise<{ page: PageRow; versionId: string; acknowledgedAt: Date; already: boolean }> {
  return db().transaction(async (tx) => {
    const [page] = await tx.select().from(kbPage).where(and(eq(kbPage.id, pageId), isNull(kbPage.deletedAt))).limit(1);
    if (!page) throw new ActionError("kb_page_not_found");
    if (!page.ackRequired || !page.ackVersionId || !page.publishedVersionId || page.status === "archived") throw new ActionError("kb_ack_not_required");
    const [member] = await tx.select({ id: person.id }).from(person).innerJoin(kbPage, eq(kbPage.id, pageId)).where(and(eq(person.id, personId), eq(person.status, "active"), inAudienceSql())).limit(1);
    if (!member) throw new ActionError("kb_ack_not_in_audience");
    const [fresh] = await tx.insert(kbAcknowledgement).values({ pageId, versionId: page.ackVersionId, personId }).onConflictDoNothing().returning();
    if (fresh) return { page, versionId: page.ackVersionId, acknowledgedAt: fresh.acknowledgedAt, already: false };
    const [existing] = await tx.select().from(kbAcknowledgement).where(and(eq(kbAcknowledgement.pageId, pageId), eq(kbAcknowledgement.versionId, page.ackVersionId), eq(kbAcknowledgement.personId, personId))).limit(1);
    return { page, versionId: page.ackVersionId, acknowledgedAt: existing.acknowledgedAt, already: true };
  });
}

export type PendingAck = { pageId: string; title: string; spaceName: string; spaceKey: string; versionNo: number; dueOn: IsoDate; overdue: boolean };

/** What the viewer still has to confirm — only pages they can open (filtered in SQL). For "my acknowledgements" and the home feed. */
export async function listMyPendingAcks(viewer: KbViewer, today: IsoDate = todayInVietnam()): Promise<PendingAck[]> {
  const rows = await db()
    .select({ pageId: kbPage.id, title: kbPage.publishedTitle, fallbackTitle: kbPage.title, spaceName: kbSpace.name, spaceKey: kbSpace.key, versionNo: kbPageVersion.versionNo, ackSince: kbPage.ackSince, ackDueDays: kbPage.ackDueDays, createdAt: person.createdAt })
    .from(kbPage)
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .innerJoin(kbPageVersion, eq(kbPageVersion.id, kbPage.ackVersionId))
    .innerJoin(person, eq(person.id, viewer.personId))
    .where(and(collectingSql(), pagePublishedVisibleSql(viewer), eq(person.status, "active"), inAudienceSql(), sql`not ${confirmedSql()}`));
  return rows
    .map((row) => {
      const dueOn = ackDueOn(row, row.createdAt);
      return { pageId: row.pageId, title: row.title ?? row.fallbackTitle, spaceName: row.spaceName, spaceKey: row.spaceKey, versionNo: row.versionNo, dueOn, overdue: dueOn < today };
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title, "vi"));
}

export const countMyPendingAcks = async (viewer: KbViewer): Promise<number> => (await listMyPendingAcks(viewer)).length;

export type DoneAck = { pageId: string; title: string; versionNo: number; acknowledgedAt: Date; current: boolean };

/** What the person has confirmed, newest first; `current` = it is still the version that counts. */
export async function listMyAcknowledgements(personId: string, limit = 100): Promise<DoneAck[]> {
  const rows = await db()
    .select({ pageId: kbPage.id, title: kbPageVersion.title, versionNo: kbPageVersion.versionNo, acknowledgedAt: kbAcknowledgement.acknowledgedAt, versionId: kbAcknowledgement.versionId, ackVersionId: kbPage.ackVersionId, ackRequired: kbPage.ackRequired })
    .from(kbAcknowledgement)
    .innerJoin(kbPage, eq(kbPage.id, kbAcknowledgement.pageId))
    .innerJoin(kbPageVersion, eq(kbPageVersion.id, kbAcknowledgement.versionId))
    .where(and(eq(kbAcknowledgement.personId, personId), isNull(kbPage.deletedAt)))
    .orderBy(desc(kbAcknowledgement.acknowledgedAt))
    .limit(limit);
  return rows.map((row) => ({ pageId: row.pageId, title: row.title, versionNo: row.versionNo, acknowledgedAt: row.acknowledgedAt, current: row.ackRequired && row.versionId === row.ackVersionId }));
}

// ── The managers' report ────────────────────────────────────────────────────────────────────

export type AckReportRow = { personId: string; fullName: string; entityName: string | null; departmentName: string | null; acknowledgedAt: Date | null; dueOn: IsoDate; overdue: boolean; lastNoticeOn: IsoDate | null; notices: number };
export type AckGroup = { name: string; total: number; done: number };
export type AckReport = { versionNo: number | null; since: Date | null; dueDays: number; total: number; done: number; overdue: number; rows: AckReportRow[]; byEntity: AckGroup[]; byDepartment: AckGroup[] };

/** Everyone in the audience today with their confirmation of the version that counts. No authorization here: the caller checks `manage`. */
export async function getAckReport(page: PageRow, today: IsoDate = todayInVietnam()): Promise<AckReport> {
  const empty: AckReport = { versionNo: null, since: page.ackSince, dueDays: page.ackDueDays, total: 0, done: 0, overdue: 0, rows: [], byEntity: [], byDepartment: [] };
  if (!page.ackRequired || !page.ackVersionId) return empty;
  const [version] = await db().select({ versionNo: kbPageVersion.versionNo }).from(kbPageVersion).where(eq(kbPageVersion.id, page.ackVersionId)).limit(1);
  const people = await db()
    .select({
      personId: person.id,
      fullName: person.fullName,
      createdAt: person.createdAt,
      entityName: schema.entity.shortName,
      departmentName: schema.orgUnit.name,
      acknowledgedAt: kbAcknowledgement.acknowledgedAt,
      lastNoticeOn: sql<IsoDate | null>`(select max(${kbAckReminder.sentOn}) from ${kbAckReminder} where ${kbAckReminder.pageId} = ${kbPage.id} and ${kbAckReminder.versionId} = ${kbPage.ackVersionId} and ${kbAckReminder.personId} = ${person.id})`,
      notices: sql<number>`(select count(*)::int from ${kbAckReminder} where ${kbAckReminder.pageId} = ${kbPage.id} and ${kbAckReminder.versionId} = ${kbPage.ackVersionId} and ${kbAckReminder.personId} = ${person.id})`,
    })
    .from(person)
    .innerJoin(kbPage, eq(kbPage.id, page.id))
    .leftJoin(schema.entity, eq(schema.entity.id, person.primaryEntityId))
    .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, person.departmentId))
    .leftJoin(kbAcknowledgement, and(eq(kbAcknowledgement.pageId, kbPage.id), eq(kbAcknowledgement.versionId, kbPage.ackVersionId), eq(kbAcknowledgement.personId, person.id)))
    .where(and(eq(person.status, "active"), inAudienceSql()))
    .orderBy(asc(person.searchName));
  const rows: AckReportRow[] = people.map((row) => {
    const dueOn = ackDueOn(page, row.createdAt);
    return { personId: row.personId, fullName: row.fullName, entityName: row.entityName, departmentName: row.departmentName, acknowledgedAt: row.acknowledgedAt, dueOn, overdue: !row.acknowledgedAt && dueOn < today, lastNoticeOn: row.lastNoticeOn, notices: row.notices };
  });
  const group = (key: (row: AckReportRow) => string | null): AckGroup[] =>
    [...Map.groupBy(rows, (row) => key(row) ?? "—")].map(([name, own]) => ({ name, total: own.length, done: own.filter((row) => row.acknowledgedAt).length })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return { versionNo: version?.versionNo ?? null, since: page.ackSince, dueDays: page.ackDueDays, total: rows.length, done: rows.filter((row) => row.acknowledgedAt).length, overdue: rows.filter((row) => row.overdue).length, rows, byEntity: group((row) => row.entityName), byDepartment: group((row) => row.departmentName) };
}

// ── Review-by dates (FR-KB-07) ──────────────────────────────────────────────────────────────

/** Tells a page's owner, once, that its review date has passed. A new date asks again (`setPageMeta` clears the mark). */
export async function sendReviewDueNotices(today: IsoDate = todayInVietnam()): Promise<{ notified: number }> {
  const pages = await db()
    .select({ id: kbPage.id, title: kbPage.title, publishedTitle: kbPage.publishedTitle, ownerPersonId: kbPage.ownerPersonId, reviewBy: kbPage.reviewBy })
    .from(kbPage)
    .innerJoin(person, eq(person.id, kbPage.ownerPersonId))
    .where(and(isNull(kbPage.deletedAt), sql`${kbPage.status} <> 'archived'`, sql`${kbPage.reviewBy} <= ${today}`, isNull(kbPage.reviewRemindedOn), eq(person.status, "active")));
  let notified = 0;
  for (const page of pages) {
    await db().transaction(async (tx) => {
      const [marked] = await tx.update(kbPage).set({ reviewRemindedOn: today }).where(and(eq(kbPage.id, page.id), isNull(kbPage.reviewRemindedOn))).returning({ id: kbPage.id });
      if (!marked) return;
      await notify({ recipients: [page.ownerPersonId!], kind: "kb.review_due", params: { title: page.publishedTitle ?? page.title, date: dueText(page.reviewBy!) }, link: `/kb/pages/${page.id}` }, tx);
      notified++;
    });
  }
  return { notified };
}
