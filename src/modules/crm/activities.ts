// Activities and follow-ups (FR-CRM-06, 43). One table for both: an activity logged after the fact
// has `occurred_at` and is done; a follow-up has an owner and a `due_on` and waits until it is done,
// when it takes an outcome and, often, the next follow-up. Follow-ups are on the owner's Today page
// and in My work, and the owner is reminded on the morning one falls due.
//
// Everything is recorded against the account (the client, never a brand), and optionally a
// contact, a deal or a lead, so each of those pages reads its own slice of one feed.
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { cachedLive } from "@/lib/cache/live";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import type { ActivityKind } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type ActivityRow = typeof schema.crmActivity.$inferSelect;

export type ActivityView = ActivityRow & { ownerName: string | null; createdByName: string | null; accountName: string | null; contactName: string | null; dealTitle: string | null; dealCode: string | null; leadCompany: string | null };

export type ActivityTarget = { clientId?: string | null; contactId?: string | null; dealId?: string | null; leadId?: string | null };

async function listWhere(where: ReturnType<typeof and>, order: "recent" | "due", limit: number, executor: Executor = db()): Promise<ActivityView[]> {
  const owner = alias(schema.person, "activity_owner");
  const author = alias(schema.person, "activity_author");
  const rows = await executor
    .select({
      activity: schema.crmActivity,
      ownerName: owner.fullName,
      createdByName: author.fullName,
      accountName: schema.workClient.name,
      contactName: schema.crmContact.fullName,
      dealTitle: schema.crmDeal.title,
      dealCode: schema.crmDeal.code,
      leadCompany: schema.crmLead.companyName,
    })
    .from(schema.crmActivity)
    .leftJoin(owner, eq(owner.id, schema.crmActivity.ownerPersonId))
    .leftJoin(author, eq(author.id, schema.crmActivity.createdByPersonId))
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmActivity.clientId))
    .leftJoin(schema.crmContact, eq(schema.crmContact.id, schema.crmActivity.contactId))
    .leftJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmActivity.dealId))
    .leftJoin(schema.crmLead, eq(schema.crmLead.id, schema.crmActivity.leadId))
    .where(where)
    .orderBy(...(order === "due" ? [asc(schema.crmActivity.dueOn), asc(schema.crmActivity.createdAt)] : [desc(sql`coalesce(${schema.crmActivity.occurredAt}, ${schema.crmActivity.doneAt}, ${schema.crmActivity.createdAt})`)]))
    .limit(limit);
  return rows.map(({ activity, ...rest }) => ({ ...activity, ...rest }));
}

/** An account's (or a deal's, a lead's, a contact's) activities, newest first, with open follow-ups among them. */
export function listActivities(target: ActivityTarget, limit = 100): Promise<ActivityView[]> {
  const conditions = [
    target.clientId ? eq(schema.crmActivity.clientId, target.clientId) : undefined,
    target.contactId ? eq(schema.crmActivity.contactId, target.contactId) : undefined,
    target.dealId ? eq(schema.crmActivity.dealId, target.dealId) : undefined,
    target.leadId ? eq(schema.crmActivity.leadId, target.leadId) : undefined,
  ].filter(Boolean);
  if (conditions.length === 0) return Promise.resolve([]);
  return listWhere(and(...conditions), "recent", limit);
}

/** Open follow-ups of a target, soonest first. */
export function listOpenFollowUps(target: ActivityTarget): Promise<ActivityView[]> {
  const conditions = [
    isNull(schema.crmActivity.doneAt),
    isNotNull(schema.crmActivity.dueOn),
    target.clientId ? eq(schema.crmActivity.clientId, target.clientId) : undefined,
    target.dealId ? eq(schema.crmActivity.dealId, target.dealId) : undefined,
    target.leadId ? eq(schema.crmActivity.leadId, target.leadId) : undefined,
  ].filter(Boolean);
  return listWhere(and(...conditions), "due", 100);
}

/**
 * A person's open follow-ups due on or before `through` (Today, My work). From the live tier of the
 * shared cache when it is today's: dropped after every action of the person's and every
 * notification to them — which is how a follow-up handed to them arrives.
 */
export function listFollowUpsOf(personId: string, through: IsoDate = todayInVietnam()): Promise<ActivityView[]> {
  const load = () => listWhere(and(eq(schema.crmActivity.ownerPersonId, personId), isNull(schema.crmActivity.doneAt), isNotNull(schema.crmActivity.dueOn), lte(schema.crmActivity.dueOn, through)), "due", 100);
  return through === todayInVietnam() ? cachedLive(personId, "followups", load) : load();
}

/** Every open follow-up of a person, whatever its date (My work, the exit handover). */
export const listAllFollowUpsOf = (personId: string): Promise<ActivityView[]> => listWhere(and(eq(schema.crmActivity.ownerPersonId, personId), isNull(schema.crmActivity.doneAt), isNotNull(schema.crmActivity.dueOn)), "due", 500);

/** Activities a person logged or completed on a day (the end-of-day report's prefill, FR-CRM-43). */
export function listDoneBy(personIds: readonly string[], date: IsoDate, executor: Executor = db()): Promise<ActivityView[]> {
  if (personIds.length === 0) return Promise.resolve([]);
  const onDay = sql`(coalesce(${schema.crmActivity.doneAt}, ${schema.crmActivity.occurredAt}) at time zone 'Asia/Ho_Chi_Minh')::date = ${date}::date`;
  return listWhere(and(inArray(schema.crmActivity.ownerPersonId, [...personIds]), isNotNull(schema.crmActivity.doneAt), onDay), "recent", 200, executor);
}

export const findActivity = async (activityId: string, executor: Executor = db()): Promise<ActivityRow | undefined> => (await executor.select().from(schema.crmActivity).where(eq(schema.crmActivity.id, activityId)).limit(1))[0];

export type ActivityInput = {
  kind: ActivityKind;
  subject: string;
  body: string | null;
  /** The account — always the client, never a brand; resolved by the caller. */
  clientId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  /** Logged: it happened (now, or at this time). */
  occurredAt: Date | null;
  outcome: string | null;
  /** A follow-up to do: its owner and day, and — when an activity is logged with it — the next step's own wording. */
  followUp: { ownerPersonId: string; dueOn: IsoDate; subject?: string | null } | null;
};

/**
 * The records an activity names belong together, or it is refused: a contact and a deal are the
 * account's own, and a lead named beside an account is that account's enquiry — the one it came
 * from, or the one it was converted into. Without this a right over one record (a lead) would
 * write onto another (somebody else's account).
 */
async function checkTargets(executor: Executor, input: Pick<ActivityInput, "clientId" | "contactId" | "dealId" | "leadId">): Promise<void> {
  if (!input.clientId && !input.leadId) throw new ActionError("activity_target_required");
  if (input.contactId) {
    const [contact] = await executor.select({ clientId: schema.crmContact.clientId, erasedAt: schema.crmContact.erasedAt }).from(schema.crmContact).where(eq(schema.crmContact.id, input.contactId)).limit(1);
    if (!contact || contact.clientId !== input.clientId || contact.erasedAt) throw new ActionError("contact_not_found");
  }
  if (input.dealId) {
    const [deal] = await executor.select({ clientId: schema.crmDeal.clientId }).from(schema.crmDeal).where(eq(schema.crmDeal.id, input.dealId)).limit(1);
    if (!deal || deal.clientId !== input.clientId) throw new ActionError("deal_not_found");
  }
  if (input.leadId) {
    // The lead's account, a brand resolved to its client as everywhere else in the CRM.
    const [lead] = await executor
      .select({ accountId: sql<string | null>`coalesce(${schema.workClient.parentId}, ${schema.workClient.id})`, convertedDealId: schema.crmLead.convertedDealId })
      .from(schema.crmLead)
      .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmLead.clientId))
      .where(eq(schema.crmLead.id, input.leadId))
      .limit(1);
    if (!lead || (input.clientId && lead.accountId !== input.clientId) || (input.dealId && lead.convertedDealId !== input.dealId)) throw new ActionError("lead_not_found");
  }
}

async function activeOwner(executor: Executor, personId: string): Promise<{ fullName: string }> {
  const [row] = await executor.select({ status: schema.person.status, fullName: schema.person.fullName, workforceType: schema.person.workforceType }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || row.status === "offboarded" || row.workforceType === "collaborator") throw new ActionError("followup_owner_invalid");
  return row;
}

/**
 * Logs an activity, schedules a follow-up, or both at once — "called, they want a proposal by
 * Friday" is one activity done now and one follow-up for Friday. A follow-up for someone else tells
 * them.
 */
export async function recordActivity(input: ActivityInput, actorPersonId: string): Promise<{ logged: ActivityRow | null; followUp: ActivityRow | null }> {
  return db().transaction(async (tx) => {
    await checkTargets(tx, input);
    const base = { subject: input.subject, clientId: input.clientId, contactId: input.contactId, dealId: input.dealId, leadId: input.leadId, createdByPersonId: actorPersonId };
    let logged: ActivityRow | null = null;
    if (input.occurredAt || !input.followUp) {
      const at = input.occurredAt ?? new Date();
      [logged] = await tx.insert(schema.crmActivity).values({ ...base, kind: input.kind, body: input.body, outcome: input.outcome, ownerPersonId: actorPersonId, occurredAt: at, doneAt: at }).returning();
    }
    let followUp: ActivityRow | null = null;
    if (input.followUp) {
      await activeOwner(tx, input.followUp.ownerPersonId);
      [followUp] = await tx
        .insert(schema.crmActivity)
        // "Called — send the proposal Friday": the follow-up reads as the next step, not the call.
        .values({ ...base, subject: (logged && input.followUp.subject) || input.subject, kind: logged ? "task" : input.kind, body: logged ? null : input.body, ownerPersonId: input.followUp.ownerPersonId, dueOn: input.followUp.dueOn })
        .returning();
      if (input.followUp.ownerPersonId !== actorPersonId) await notifyAssigned(tx, followUp, actorPersonId);
    }
    return { logged, followUp };
  });
}

async function notifyAssigned(tx: Tx, activity: ActivityRow, actorPersonId: string): Promise<void> {
  const [facts] = await tx
    .select({ account: schema.workClient.name, lead: schema.crmLead.companyName, by: schema.person.fullName })
    .from(schema.crmActivity)
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmActivity.clientId))
    .leftJoin(schema.crmLead, eq(schema.crmLead.id, schema.crmActivity.leadId))
    .innerJoin(schema.person, eq(schema.person.id, sql`${actorPersonId}::uuid`))
    .where(eq(schema.crmActivity.id, activity.id))
    .limit(1);
  await notify({ recipients: [activity.ownerPersonId], kind: "crm.followup_assigned", params: { subject: activity.subject, account: facts?.account ?? facts?.lead ?? "—", by: facts?.by ?? "" }, link: activityLink(activity) }, tx);
}

/** Where an activity is read: its deal, its lead, else its account. */
export const activityLink = (activity: Pick<ActivityRow, "clientId" | "dealId" | "leadId">): string =>
  activity.dealId ? `/crm/deals/${activity.dealId}` : activity.leadId ? `/crm/leads/${activity.leadId}` : `/crm/accounts/${activity.clientId}`;

/**
 * Done: the follow-up takes its outcome and becomes a logged activity of the kind it turned out to
 * be. `next` schedules the one after it in the same step.
 */
export async function completeFollowUp(activityId: string, input: { outcome: string | null; kind: ActivityKind | null; next: { subject: string; dueOn: IsoDate; ownerPersonId: string } | null }, actorPersonId: string): Promise<{ before: ActivityRow; after: ActivityRow; next: ActivityRow | null }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmActivity).where(eq(schema.crmActivity.id, activityId)).limit(1).for("update");
    if (!before) throw new ActionError("activity_not_found");
    if (before.doneAt) throw new ActionError("activity_done");
    const now = new Date();
    const [after] = await tx
      .update(schema.crmActivity)
      .set({ doneAt: now, occurredAt: now, outcome: input.outcome, ...(input.kind ? { kind: input.kind } : {}), updatedAt: now })
      .where(eq(schema.crmActivity.id, activityId))
      .returning();
    let next: ActivityRow | null = null;
    if (input.next) {
      await activeOwner(tx, input.next.ownerPersonId);
      [next] = await tx
        .insert(schema.crmActivity)
        .values({ kind: "task", subject: input.next.subject, clientId: before.clientId, contactId: before.contactId, dealId: before.dealId, leadId: before.leadId, ownerPersonId: input.next.ownerPersonId, dueOn: input.next.dueOn, createdByPersonId: actorPersonId })
        .returning();
      if (input.next.ownerPersonId !== actorPersonId) await notifyAssigned(tx, next, actorPersonId);
    }
    return { before, after, next };
  });
}

/** A new day, or a new owner. The new owner is told. */
export async function rescheduleFollowUp(activityId: string, input: { dueOn: IsoDate; ownerPersonId: string; subject: string }, actorPersonId: string): Promise<{ before: ActivityRow; after: ActivityRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmActivity).where(eq(schema.crmActivity.id, activityId)).limit(1).for("update");
    if (!before) throw new ActionError("activity_not_found");
    if (before.doneAt) throw new ActionError("activity_done");
    if (input.ownerPersonId !== before.ownerPersonId) await activeOwner(tx, input.ownerPersonId);
    const [after] = await tx
      .update(schema.crmActivity)
      .set({ dueOn: input.dueOn, ownerPersonId: input.ownerPersonId, subject: input.subject, remindedOn: input.dueOn === before.dueOn ? before.remindedOn : null, updatedAt: new Date() })
      .where(eq(schema.crmActivity.id, activityId))
      .returning();
    if (after.ownerPersonId !== before.ownerPersonId && after.ownerPersonId !== actorPersonId) await notifyAssigned(tx, after, actorPersonId);
    return { before, after };
  });
}

/** A follow-up that no longer applies is removed; a logged activity stays — it is the record. */
export async function cancelFollowUp(activityId: string): Promise<ActivityRow> {
  const [row] = await db()
    .delete(schema.crmActivity)
    .where(and(eq(schema.crmActivity.id, activityId), isNull(schema.crmActivity.doneAt)))
    .returning();
  if (!row) throw new ActionError("activity_not_found");
  return row;
}

/**
 * Moves open follow-ups to another person (an account or exit handover, leave cover). Inside the
 * caller's transaction. Returns how many moved.
 */
export async function moveFollowUps(tx: Tx, where: { ownerPersonId: string; clientIds?: readonly string[]; dealIds?: readonly string[]; activityIds?: readonly string[] }, toPersonId: string): Promise<number> {
  const scope = [
    where.clientIds?.length ? inArray(schema.crmActivity.clientId, [...where.clientIds]) : undefined,
    where.dealIds?.length ? inArray(schema.crmActivity.dealId, [...where.dealIds]) : undefined,
    where.activityIds?.length ? inArray(schema.crmActivity.id, [...where.activityIds]) : undefined,
  ].filter(Boolean);
  if (where.clientIds?.length === 0 && where.dealIds?.length === 0 && where.activityIds?.length === 0) return 0;
  const rows = await tx
    .update(schema.crmActivity)
    .set({ ownerPersonId: toPersonId, remindedOn: null, updatedAt: new Date() })
    .where(and(eq(schema.crmActivity.ownerPersonId, where.ownerPersonId), isNull(schema.crmActivity.doneAt), isNotNull(schema.crmActivity.dueOn), scope.length ? or(...scope) : undefined))
    .returning({ id: schema.crmActivity.id });
  return rows.length;
}

/**
 * The morning reminder (FR-CRM-06): one notification per follow-up due today and not yet
 * reminded today. Running twice the same morning sends nothing the second time.
 */
export async function sendFollowUpReminders(today: IsoDate = todayInVietnam()): Promise<{ followUpsReminded: number }> {
  const due = await db()
    .select({ id: schema.crmActivity.id, ownerPersonId: schema.crmActivity.ownerPersonId, subject: schema.crmActivity.subject, clientId: schema.crmActivity.clientId, dealId: schema.crmActivity.dealId, leadId: schema.crmActivity.leadId, account: schema.workClient.name, lead: schema.crmLead.companyName })
    .from(schema.crmActivity)
    .leftJoin(schema.workClient, eq(schema.workClient.id, schema.crmActivity.clientId))
    .leftJoin(schema.crmLead, eq(schema.crmLead.id, schema.crmActivity.leadId))
    .innerJoin(schema.person, eq(schema.person.id, schema.crmActivity.ownerPersonId))
    .where(and(isNull(schema.crmActivity.doneAt), eq(schema.crmActivity.dueOn, today), or(isNull(schema.crmActivity.remindedOn), sql`${schema.crmActivity.remindedOn} < ${today}::date`), sql`${schema.person.status} <> 'offboarded'`));
  if (due.length === 0) return { followUpsReminded: 0 };
  await db().transaction(async (tx) => {
    const claimed = await tx
      .update(schema.crmActivity)
      .set({ remindedOn: today })
      .where(and(inArray(schema.crmActivity.id, due.map((row) => row.id)), or(isNull(schema.crmActivity.remindedOn), sql`${schema.crmActivity.remindedOn} < ${today}::date`)))
      .returning({ id: schema.crmActivity.id });
    const mine = new Set(claimed.map((row) => row.id));
    for (const row of due.filter((item) => mine.has(item.id))) {
      await notify({ recipients: [row.ownerPersonId], kind: "crm.followup_due", params: { subject: row.subject, account: row.account ?? row.lead ?? "—" }, link: activityLink(row) }, tx);
    }
  });
  return { followUpsReminded: due.length };
}

/** Open follow-ups per person (the leave cover and exit handover counts). */
export async function countOpenFollowUps(personIds: readonly string[]): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const rows = await db()
    .select({ personId: schema.crmActivity.ownerPersonId, count: sql<number>`count(*)` })
    .from(schema.crmActivity)
    .where(and(inArray(schema.crmActivity.ownerPersonId, [...personIds]), isNull(schema.crmActivity.doneAt), isNotNull(schema.crmActivity.dueOn)))
    .groupBy(schema.crmActivity.ownerPersonId);
  return new Map(rows.map((row) => [row.personId, Number(row.count)]));
}
