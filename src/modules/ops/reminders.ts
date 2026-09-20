// Reminders and escalation (FR-OPS-08): the daily job. The engine decides which notices an open
// instance is due; this file turns audiences into people and sends — once, through
// `obligation_notice_sent` — one notice per person and kind per run, however many items it covers.
import "server-only";
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { listOwnerPersonIds, listPeopleHolding, listPeopleWithRole } from "../platform/rbac/service";
import { escalationLevel, type Notice, type NoticeKind, noticesDue, supersededLeadKeys } from "./engine/escalation";
import { DEFAULT_ESCALATION, DEFAULT_REMINDER_LEAD_DAYS, OBLIGATION_KIND } from "./enums";

type Executor = Tx | ReturnType<typeof db>;

const KIND: Record<NoticeKind, "ops.reminder" | "ops.overdue" | "ops.escalated"> = { reminder: "ops.reminder", overdue: "ops.overdue", escalated: "ops.escalated" };
const LONGEST_LEAD_DAYS = 60;
const display = (date: IsoDate) => date.split("-").reverse().join("/");

export type ReminderResult = { reminders: number; overdue: number; escalated: number; people: number };

export async function sendOpsReminders(today: IsoDate, executor?: Executor): Promise<ReminderResult> {
  return executor ? sendIn(executor, today) : db().transaction((tx) => sendIn(tx, today));
}

async function sendIn(tx: Executor, today: IsoDate): Promise<ReminderResult> {
  const rows = await tx
    .select({ instance: schema.obligationInstance, task: schema.task, template: schema.obligationTemplate })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .where(and(eq(schema.task.kind, OBLIGATION_KIND), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress"]), isNotNull(schema.task.dueDate), lte(schema.task.dueDate, addDays(today, LONGEST_LEAD_DAYS))))
    .orderBy(schema.task.dueDate, schema.task.title);
  if (rows.length === 0) return { reminders: 0, overdue: 0, escalated: 0, people: 0 };

  const sentRows = await tx.select({ instanceId: schema.obligationNoticeSent.instanceId, key: schema.obligationNoticeSent.key }).from(schema.obligationNoticeSent).where(inArray(schema.obligationNoticeSent.instanceId, rows.map((row) => row.instance.id)));
  const sentBy = new Map<string, Set<string>>();
  for (const row of sentRows) sentBy.set(row.instanceId, (sentBy.get(row.instanceId) ?? new Set()).add(row.key));

  const owners = await listOwnerPersonIds(tx);
  const cache = new Map<string, Promise<string[]>>();
  const once = (key: string, load: () => Promise<string[]>) => cache.get(key) ?? cache.set(key, load()).get(key)!;

  /** The owner's department head, else their line manager — whoever is one step up from the person who is late. */
  const managersOf = (ownerId: string) =>
    once(`manager:${ownerId}`, async () => {
      const [owner] = await tx.select({ departmentId: schema.person.departmentId, entityId: schema.person.primaryEntityId, managerId: schema.person.managerId }).from(schema.person).where(eq(schema.person.id, ownerId)).limit(1);
      if (!owner) return [];
      const heads = owner.departmentId ? (await listPeopleWithRole("department_head", { departmentId: owner.departmentId, entityId: owner.entityId }, tx)).filter((id) => id !== ownerId) : [];
      return heads.length > 0 ? heads : owner.managerId ? [owner.managerId] : [];
    });
  const executivesOf = (entityId: string) => once(`executive:${entityId}`, async () => [...new Set([...(await listPeopleWithRole("finance", { entityId }, tx)), ...(await listPeopleWithRole("c_level", { entityId }, tx)), ...owners])]);
  /** Nobody owns it: the people who run the tracker for the entity hear about it instead. */
  const keepersOf = (entityId: string) => once(`keeper:${entityId}`, () => listPeopleHolding("ops:manage", { entityId }, { includeWildcard: false, executor: tx, today }));

  type Outgoing = { recipient: string; kind: NoticeKind; taskId: string; title: string; dueDate: IsoDate; days: number; ownerName: string | null };
  const outgoing: Outgoing[] = [];
  const marks: { instanceId: string; key: string }[] = [];
  const ownerIds = [...new Set(rows.flatMap((row) => (row.task.assigneePersonId ? [row.task.assigneePersonId] : [])))];
  const ownerNames = new Map(ownerIds.length === 0 ? [] : (await tx.select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, ownerIds))).map((row) => [row.id, row.name] as const));

  for (const { instance, task, template } of rows) {
    const sent = sentBy.get(instance.id) ?? new Set<string>();
    const facts = { status: task.status, dueDate: task.dueDate, reminderLeadDays: template.reminderLeadDays ?? DEFAULT_REMINDER_LEAD_DAYS, escalation: template.escalation ?? DEFAULT_ESCALATION, sent };
    const ownerId = task.assigneePersonId;
    for (const notice of noticesDue(facts, today)) {
      const recipients = await recipientsOf(notice, { ownerId, reviewerId: instance.reviewerPersonId, entityId: instance.entityId });
      marks.push({ instanceId: instance.id, key: notice.key });
      if (notice.kind === "reminder") for (const key of supersededLeadKeys(facts, Number(notice.key.split(":")[1]))) marks.push({ instanceId: instance.id, key });
      // Catching up after days without a run, a manager who is also an executive would hear twice about one item: once is enough.
      for (const recipient of recipients.filter((id) => !outgoing.some((item) => item.recipient === id && item.kind === notice.kind && item.taskId === task.id))) outgoing.push({ recipient, kind: notice.kind, taskId: task.id, title: task.title, dueDate: task.dueDate!, days: notice.days, ownerName: ownerId ? (ownerNames.get(ownerId) ?? null) : null });
    }
  }

  async function recipientsOf(notice: Notice, parties: { ownerId: string | null; reviewerId: string | null; entityId: string }): Promise<string[]> {
    const fallback = async () => (parties.ownerId ? [parties.ownerId] : keepersOf(parties.entityId));
    if (notice.audience === "owner") return fallback();
    if (notice.audience === "owner_and_reviewer") return [...new Set([...(await fallback()), ...(parties.reviewerId ? [parties.reviewerId] : [])])];
    if (notice.audience === "manager") {
      const managers = parties.ownerId ? await managersOf(parties.ownerId) : [];
      // Nobody above the owner (or no owner): the step is not lost, the executives hear one level early.
      return managers.length > 0 ? managers : (await executivesOf(parties.entityId)).filter((id) => id !== parties.ownerId);
    }
    return (await executivesOf(parties.entityId)).filter((id) => id !== parties.ownerId);
  }

  if (marks.length > 0) await tx.insert(schema.obligationNoticeSent).values(marks).onConflictDoNothing();

  const counts = { reminder: 0, overdue: 0, escalated: 0 };
  const people = new Set<string>();
  for (const [groupKey, own] of Map.groupBy(outgoing, (item) => `${item.recipient}|${item.kind}`)) {
    const [recipient, kind] = groupKey.split("|") as [string, NoticeKind];
    // The most pressing item names the notice: the longest overdue, or the one due first.
    const [first] = [...own].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    await notify({ recipients: [recipient], kind: KIND[kind], params: { count: own.length, title: first.title, dueDate: display(first.dueDate), days: first.days, owner: first.ownerName ?? "—" }, link: own.length === 1 ? `/ops/obligations/${first.taskId}` : "/ops/list" }, tx);
    counts[kind] += own.length;
    people.add(recipient);
  }
  return { reminders: counts.reminder, overdue: counts.overdue, escalated: counts.escalated, people: people.size };
}

/** instance id → the keys already sent; the screens turn them into an escalation level. */
export async function sentKeysOf(instanceIds: readonly string[], executor: Executor = db()): Promise<Map<string, string[]>> {
  const byInstance = new Map<string, string[]>();
  if (instanceIds.length === 0) return byInstance;
  const rows = await executor.select({ instanceId: schema.obligationNoticeSent.instanceId, key: schema.obligationNoticeSent.key }).from(schema.obligationNoticeSent).where(and(inArray(schema.obligationNoticeSent.instanceId, [...instanceIds]), inArray(schema.obligationNoticeSent.key, ["escalate:manager", "escalate:executive"])));
  for (const row of rows) byInstance.set(row.instanceId, [...(byInstance.get(row.instanceId) ?? []), row.key]);
  return byInstance;
}

export async function escalationLevelOf(instanceId: string): Promise<0 | 1 | 2> {
  return escalationLevel((await sentKeysOf([instanceId])).get(instanceId) ?? []);
}
