// Feedback about SuZu One (see ./schema.ts): send it, read one's own, work the inbox.
import "server-only";
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { TierReach } from "../platform/rbac/policy";
import { personInReachSql } from "../platform/rbac/reach-sql";
import { listPeopleHolding } from "../platform/rbac/service";
import { areaOfPath, type FeedbackCategory, type FeedbackPriority, type FeedbackStatus, FEEDBACK_SCREENSHOT_OWNER_TYPE, FEEDBACK_STATUSES } from "./enums";
import type { FeedbackTarget } from "./policy";

const { appFeedback, person, storedFile } = schema;
export type FeedbackRow = typeof schema.appFeedback.$inferSelect;

export const FEEDBACK_PAGE_SIZE = 50;

type Submitter = { personId: string; entityId: string | null; unitPath: readonly string[] };

export type FeedbackInput = { category: FeedbackCategory; message: string; blocking: boolean; pagePath: string | null; screenshotFileId: string | null };

/**
 * Records a piece of feedback and tells whoever triages feedback for this person. The notice
 * carries the category and the part of the app, never the text: it is read on lock screens.
 */
export async function submitFeedback(from: Submitter, input: FeedbackInput, userAgent: string | null): Promise<FeedbackRow> {
  if (input.screenshotFileId) {
    // Only a finished upload of the submitter's own, made for feedback.
    const [file] = await db()
      .select({ id: storedFile.id })
      .from(storedFile)
      .where(and(eq(storedFile.id, input.screenshotFileId), eq(storedFile.ownerType, FEEDBACK_SCREENSHOT_OWNER_TYPE), eq(storedFile.ownerId, from.personId), eq(storedFile.status, "ready"), isNull(storedFile.deletedAt)))
      .limit(1);
    if (!file) throw new ActionError("feedback_screenshot_invalid");
  }
  // An app path only: "//host" would be a link off the site on the triage page.
  const pagePath = input.pagePath && /^\/(?![/\\])/.test(input.pagePath) ? input.pagePath.slice(0, 300) : null;
  const target: FeedbackTarget = { personId: from.personId, entityId: from.entityId, unitPath: from.unitPath };
  const triagers = (await listPeopleHolding("feedback:manage", target)).filter((id) => id !== from.personId);
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(appFeedback)
      .values({ personId: from.personId, entityId: from.entityId, category: input.category, message: input.message, blocking: input.blocking, pagePath, area: areaOfPath(pagePath), userAgent: userAgent?.slice(0, 400) ?? null, screenshotFileId: input.screenshotFileId })
      .returning();
    await notify({ recipients: triagers, kind: "feedback.received", params: { feedbackCategory: row.category, area: row.area ? `/${row.area}` : "—" }, link: `/feedback/${row.id}` }, tx);
    return row;
  });
}

export type FeedbackListItem = Pick<FeedbackRow, "id" | "category" | "message" | "blocking" | "area" | "status" | "priority" | "reply" | "createdAt" | "updatedAt"> & { personId: string; personName: string };

const listColumns = {
  id: appFeedback.id,
  category: appFeedback.category,
  message: appFeedback.message,
  blocking: appFeedback.blocking,
  area: appFeedback.area,
  status: appFeedback.status,
  priority: appFeedback.priority,
  reply: appFeedback.reply,
  createdAt: appFeedback.createdAt,
  updatedAt: appFeedback.updatedAt,
  personId: appFeedback.personId,
  personName: person.fullName,
};

/** One's own feedback, newest first, with the reply. */
export async function listMyFeedback(personId: string, limit = 50): Promise<FeedbackListItem[]> {
  return db().select(listColumns).from(appFeedback).innerJoin(person, eq(person.id, appFeedback.personId)).where(eq(appFeedback.personId, personId)).orderBy(desc(appFeedback.createdAt)).limit(limit);
}

export type FeedbackFilters = { status?: FeedbackStatus | "open"; category?: FeedbackCategory; area?: string; blocking?: boolean; page?: number };

function filterClauses(reach: TierReach, filters: Omit<FeedbackFilters, "status" | "page">): (SQL | undefined)[] {
  return [
    personInReachSql(reach),
    filters.category ? eq(appFeedback.category, filters.category) : undefined,
    filters.area ? eq(appFeedback.area, filters.area) : undefined,
    filters.blocking ? eq(appFeedback.blocking, true) : undefined,
  ];
}

const statusClause = (status: FeedbackFilters["status"]): SQL | undefined =>
  status === "open" ? sql`${appFeedback.status} in ('new', 'in_progress')` : status ? eq(appFeedback.status, status) : undefined;

/**
 * The inbox: open items first by priority, then the newest. Blocking items lead within a priority,
 * since somebody is stuck behind each of them.
 */
export async function listFeedbackInbox(reach: TierReach, filters: FeedbackFilters): Promise<{ rows: FeedbackListItem[]; total: number }> {
  const page = Math.max(1, Math.min(filters.page ?? 1, 1000));
  const where = and(...filterClauses(reach, filters), statusClause(filters.status));
  const [rows, [totals]] = await Promise.all([
    db()
      .select(listColumns)
      .from(appFeedback)
      .innerJoin(person, eq(person.id, appFeedback.personId))
      .where(where)
      .orderBy(
        sql`case when ${appFeedback.status} in ('new', 'in_progress') then 0 else 1 end`,
        sql`array_position(array['urgent','high','normal','low']::feedback_priority[], ${appFeedback.priority})`,
        desc(appFeedback.blocking),
        desc(appFeedback.createdAt),
      )
      .limit(FEEDBACK_PAGE_SIZE)
      .offset((page - 1) * FEEDBACK_PAGE_SIZE),
    db().select({ total: count() }).from(appFeedback).innerJoin(person, eq(person.id, appFeedback.personId)).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

export type FeedbackCounts = Record<FeedbackStatus, number> & { blockingOpen: number };

/** The inbox's tabs: how many items in each status under the other filters, in one aggregate. */
export async function countFeedbackByStatus(reach: TierReach, filters: Omit<FeedbackFilters, "status" | "page">): Promise<FeedbackCounts> {
  const [row] = await db()
    .select({
      new: sql<number>`count(*) filter (where ${appFeedback.status} = 'new')`.mapWith(Number),
      in_progress: sql<number>`count(*) filter (where ${appFeedback.status} = 'in_progress')`.mapWith(Number),
      resolved: sql<number>`count(*) filter (where ${appFeedback.status} = 'resolved')`.mapWith(Number),
      declined: sql<number>`count(*) filter (where ${appFeedback.status} = 'declined')`.mapWith(Number),
      blockingOpen: sql<number>`count(*) filter (where ${appFeedback.blocking} and ${appFeedback.status} in ('new', 'in_progress'))`.mapWith(Number),
    })
    .from(appFeedback)
    .innerJoin(person, eq(person.id, appFeedback.personId))
    .where(and(...filterClauses(reach, filters)));
  return { new: row?.new ?? 0, in_progress: row?.in_progress ?? 0, resolved: row?.resolved ?? 0, declined: row?.declined ?? 0, blockingOpen: row?.blockingOpen ?? 0 };
}

/** The parts of the app feedback has been sent about in the reader's reach, busiest first, for the filter. */
export async function listFeedbackAreas(reach: TierReach): Promise<{ area: string; count: number }[]> {
  return db()
    .select({ area: sql<string>`${appFeedback.area}`, count: count() })
    .from(appFeedback)
    .innerJoin(person, eq(person.id, appFeedback.personId))
    .where(and(personInReachSql(reach), sql`${appFeedback.area} is not null`))
    .groupBy(appFeedback.area)
    .orderBy(desc(count()), appFeedback.area);
}

export type FeedbackView = { row: FeedbackRow; target: FeedbackTarget; personName: string; personEmail: string | null; handlerName: string | null; screenshotName: string | null };

export async function getFeedback(id: string): Promise<FeedbackView | null> {
  const handler = alias(person, "handler");
  const [found] = await db()
    .select({ row: appFeedback, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId, personName: person.fullName, personEmail: person.workEmail, handlerName: handler.fullName, screenshotName: storedFile.fileName })
    .from(appFeedback)
    .innerJoin(person, eq(person.id, appFeedback.personId))
    .leftJoin(handler, eq(handler.id, appFeedback.handledByPersonId))
    .leftJoin(storedFile, and(eq(storedFile.id, appFeedback.screenshotFileId), isNull(storedFile.deletedAt)))
    .where(eq(appFeedback.id, id))
    .limit(1);
  if (!found) return null;
  return {
    row: found.row,
    target: { personId: found.row.personId, entityId: found.entityId, unitPath: found.unitPath, managerId: found.managerId },
    personName: found.personName,
    personEmail: found.personEmail,
    handlerName: found.handlerName,
    screenshotName: found.screenshotName,
  };
}

export type TriageInput = { status: FeedbackStatus; priority: FeedbackPriority; reply: string | null; internalNote: string | null };

const CLOSED: readonly FeedbackStatus[] = ["resolved", "declined"];

/**
 * Status, priority, reply and note in one save. The submitter hears about it when there is
 * something for them: a new or changed reply, or the item being closed or reopened.
 */
export async function triageFeedback(id: string, actorPersonId: string, input: TriageInput): Promise<{ before: FeedbackRow; after: FeedbackRow }> {
  if (!(FEEDBACK_STATUSES as readonly string[]).includes(input.status)) throw new ActionError("feedback_status_invalid");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(appFeedback).where(eq(appFeedback.id, id)).for("update").limit(1);
    if (!before) throw new ActionError("feedback_not_found");
    const now = new Date();
    const replyChanged = (input.reply ?? null) !== (before.reply ?? null);
    const wasClosed = CLOSED.includes(before.status);
    const isClosed = CLOSED.includes(input.status);
    const [after] = await tx
      .update(appFeedback)
      .set({
        status: input.status,
        priority: input.priority,
        reply: input.reply,
        repliedAt: replyChanged ? (input.reply ? now : null) : before.repliedAt,
        internalNote: input.internalNote,
        handledByPersonId: actorPersonId,
        closedAt: isClosed ? (wasClosed ? before.closedAt : now) : null,
        updatedAt: now,
      })
      .where(eq(appFeedback.id, id))
      .returning();
    const statusChanged = before.status !== after.status;
    if ((replyChanged && !!after.reply) || (statusChanged && (isClosed || wasClosed || after.status === "in_progress"))) {
      if (after.personId !== actorPersonId) {
        await notify({ recipients: [after.personId], kind: "feedback.answered", params: { feedbackStatus: after.status }, link: `/feedback/${after.id}` }, tx);
      }
    }
    return { before, after };
  });
}
