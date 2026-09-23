// The publish log of content (FR-PJM-54) and the results of what went out (FR-PJM-57). A content task
// plans its posts — platform, page, planned time — and each is marked published with its URL, which
// is what lets the task enter a "Published" state (publish-gate.ts). The calendar shows planned
// against published and flags what is late or missing; the morning job reminds.
import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { cleanMetrics, isHttpsUrl, isPublishMissing, latestMetrics, type Metrics, publishFlag, type PublishFlag, type ResultMetric } from "./engine/delivery";
import { CHANNELS } from "./enums";
import { type LoadedTask, loadTask, logActivity, taskKey, visibleTaskCondition, WORK_KIND } from "./tasks";
import type { WorkViewer } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type PublishRow = typeof schema.workPublish.$inferSelect;
export type ResultRow = typeof schema.workPublishResult.$inferSelect;
type Actor = { personId: string; fullName: string };

const isChannel = (value: string) => (CHANNELS as readonly string[]).includes(value);

export async function findPublish(publishId: string, executor: Executor = db()): Promise<{ publish: PublishRow; loaded: LoadedTask } | undefined> {
  const [publish] = await executor.select().from(schema.workPublish).where(eq(schema.workPublish.id, publishId)).limit(1);
  const loaded = publish ? await loadTask(publish.taskId, executor) : undefined;
  return publish && loaded ? { publish, loaded } : undefined;
}

const touch = (tx: Executor, taskId: string) => tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));

export type PlanInput = { platform: string; page: string | null; plannedAt: Date | null };

/** A planned post. The platform is one of the channels (FR-WRK channels), the page the brand's account on it. */
export async function planPublish(taskId: string, input: PlanInput, actor: Actor): Promise<PublishRow> {
  if (!isChannel(input.platform)) throw new ActionError("publish_platform_invalid");
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (loaded.task.status === "cancelled") throw new ActionError("publish_task_closed");
    const [publish] = await tx.insert(schema.workPublish).values({ taskId, platform: input.platform, page: input.page, plannedAt: input.plannedAt, createdByPersonId: actor.personId }).returning();
    await logActivity(tx, taskId, actor.personId, [{ type: "publish_planned", to: { name: [input.platform, input.page].filter(Boolean).join(" · "), plannedAt: input.plannedAt?.toISOString() ?? null } }]);
    await touch(tx, taskId);
    return publish;
  });
}

/** Moving a planned post, or correcting its page. A published post keeps what it was published as. */
export async function updatePublishPlan(publishId: string, input: PlanInput, actor: Actor): Promise<{ before: PublishRow; after: PublishRow }> {
  if (!isChannel(input.platform)) throw new ActionError("publish_platform_invalid");
  return db().transaction(async (tx) => {
    const found = await findPublish(publishId, tx);
    if (!found) throw new ActionError("publish_not_found");
    if (found.publish.status !== "planned") throw new ActionError("publish_not_planned");
    const [after] = await tx.update(schema.workPublish).set({ platform: input.platform, page: input.page, plannedAt: input.plannedAt, updatedAt: new Date() }).where(eq(schema.workPublish.id, publishId)).returning();
    await logActivity(tx, found.publish.taskId, actor.personId, [{ type: "publish_rescheduled", from: { plannedAt: found.publish.plannedAt?.toISOString() ?? null }, to: { name: [input.platform, input.page].filter(Boolean).join(" · "), plannedAt: input.plannedAt?.toISOString() ?? null } }]);
    return { before: found.publish, after };
  });
}

export type PublishedInput = { url: string; publishedAt: Date; boosted: boolean; adAccount: string | null };

/** Out: the URL is required and must be https — it is the proof, and what the gate on "Published" asks for. */
export async function markPublished(publishId: string, input: PublishedInput, actor: Actor): Promise<{ before: PublishRow; after: PublishRow }> {
  if (!isHttpsUrl(input.url)) throw new ActionError("publish_url_required");
  if (input.boosted && !input.adAccount) throw new ActionError("publish_ad_account_required");
  return db().transaction(async (tx) => {
    const found = await findPublish(publishId, tx);
    if (!found) throw new ActionError("publish_not_found");
    if (found.publish.status === "cancelled") throw new ActionError("publish_not_planned");
    const [after] = await tx
      .update(schema.workPublish)
      .set({ status: "published", url: input.url, publishedAt: input.publishedAt, publishedByPersonId: found.publish.status === "published" ? found.publish.publishedByPersonId : actor.personId, boosted: input.boosted, adAccount: input.boosted ? input.adAccount : null, updatedAt: new Date() })
      .where(eq(schema.workPublish.id, publishId))
      .returning();
    await logActivity(tx, found.publish.taskId, actor.personId, [{ type: "publish_published", to: { name: input.url, platform: found.publish.platform, boosted: input.boosted } }]);
    await touch(tx, found.publish.taskId);
    return { before: found.publish, after };
  });
}

/** Called off. A published post cannot be — it is out; its record stays. */
export async function cancelPublish(publishId: string, actor: Actor): Promise<PublishRow> {
  return db().transaction(async (tx) => {
    const found = await findPublish(publishId, tx);
    if (!found) throw new ActionError("publish_not_found");
    if (found.publish.status !== "planned") throw new ActionError("publish_not_planned");
    const [after] = await tx.update(schema.workPublish).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.workPublish.id, publishId)).returning();
    await logActivity(tx, found.publish.taskId, actor.personId, [{ type: "publish_cancelled", from: { name: [found.publish.platform, found.publish.page].filter(Boolean).join(" · ") } }]);
    return after;
  });
}

export type PublishView = PublishRow & { publishedByName: string | null; results: (ResultRow & { metrics: Metrics })[]; latest: Metrics };

/**
 * The publish log of these tasks, planned time first, each with its results. No authorization
 * inside: the caller holds task ids it may already read (the task page, the client report).
 */
export async function listPublishesByTask(taskIds: readonly string[]): Promise<PublishView[]> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return [];
  const rows = await db()
    .select({ publish: schema.workPublish, publishedByName: schema.person.fullName })
    .from(schema.workPublish)
    .leftJoin(schema.person, eq(schema.person.id, schema.workPublish.publishedByPersonId))
    .where(inArray(schema.workPublish.taskId, ids))
    .orderBy(asc(schema.workPublish.plannedAt), asc(schema.workPublish.createdAt));
  const results = await listResultsOf(rows.map((row) => row.publish.id));
  const byPublish = Map.groupBy(results, (row) => row.publishId);
  return rows.map(({ publish, publishedByName }) => {
    const own = byPublish.get(publish.id) ?? [];
    return { ...publish, publishedByName, results: own, latest: latestMetrics(own) };
  });
}

async function listResultsOf(publishIds: readonly string[]): Promise<ResultRow[]> {
  if (publishIds.length === 0) return [];
  return db().select().from(schema.workPublishResult).where(inArray(schema.workPublishResult.publishId, [...publishIds])).orderBy(asc(schema.workPublishResult.recordedOn), asc(schema.workPublishResult.createdAt));
}

export type ResultView = ResultRow & { taskId: string; platform: string; url: string | null };

/**
 * Every result reading of these tasks' posts, oldest first — the client report's figures. No
 * authorization inside (as `listPublishesByTask`). Money (`spendVnd`) is integer VND.
 */
export async function listResultsByTask(taskIds: readonly string[]): Promise<ResultView[]> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return [];
  const rows = await db()
    .select({ result: schema.workPublishResult, taskId: schema.workPublish.taskId, platform: schema.workPublish.platform, url: schema.workPublish.url })
    .from(schema.workPublishResult)
    .innerJoin(schema.workPublish, eq(schema.workPublish.id, schema.workPublishResult.publishId))
    .where(inArray(schema.workPublish.taskId, ids))
    .orderBy(asc(schema.workPublishResult.recordedOn), asc(schema.workPublishResult.createdAt));
  return rows.map(({ result, ...rest }) => ({ ...result, ...rest }));
}

export type ResultInput = { recordedOn: IsoDate } & Partial<Record<ResultMetric, number | null>>;

/**
 * One reading of a post's figures as of a date. A second reading for the same date replaces the
 * first (a corrected figure, or a file imported again), so a date never counts twice.
 */
export async function saveResult(executor: Executor, publishId: string, input: ResultInput, source: "manual" | "csv", actorPersonId: string): Promise<{ result: ResultRow; replaced: boolean }> {
  const metrics = cleanMetrics(input);
  if (!metrics) throw new ActionError("result_metrics_required");
  const [existing] = await executor.select().from(schema.workPublishResult).where(and(eq(schema.workPublishResult.publishId, publishId), eq(schema.workPublishResult.recordedOn, input.recordedOn))).limit(1);
  if (existing) {
    const [result] = await executor.update(schema.workPublishResult).set({ metrics, source, createdByPersonId: actorPersonId }).where(eq(schema.workPublishResult.id, existing.id)).returning();
    return { result, replaced: true };
  }
  const [result] = await executor.insert(schema.workPublishResult).values({ publishId, recordedOn: input.recordedOn, metrics, source, createdByPersonId: actorPersonId }).returning();
  return { result, replaced: false };
}

export async function recordResult(publishId: string, input: ResultInput, actor: Actor): Promise<ResultRow> {
  return db().transaction(async (tx) => {
    const found = await findPublish(publishId, tx);
    if (!found) throw new ActionError("publish_not_found");
    if (found.publish.status !== "published") throw new ActionError("result_not_published");
    const { result } = await saveResult(tx, publishId, input, "manual", actor.personId);
    await logActivity(tx, found.publish.taskId, actor.personId, [{ type: "result_recorded", to: { name: input.recordedOn.split("-").reverse().join("/") } }]);
    return result;
  });
}

export async function findResult(resultId: string): Promise<{ result: ResultRow; publish: PublishRow; loaded: LoadedTask } | undefined> {
  const [result] = await db().select().from(schema.workPublishResult).where(eq(schema.workPublishResult.id, resultId)).limit(1);
  const found = result ? await findPublish(result.publishId) : undefined;
  return result && found ? { result, ...found } : undefined;
}

export async function removeResult(resultId: string): Promise<ResultRow> {
  const [result] = await db().delete(schema.workPublishResult).where(eq(schema.workPublishResult.id, resultId)).returning();
  if (!result) throw new ActionError("result_not_found");
  return result;
}

// ── The content calendar (FR-PJM-54) ────────────────────────────────────────────────────────

export type CalendarPublish = { id: string; taskId: string; key: string; title: string; platform: string; page: string | null; status: string; plannedAt: Date | null; publishedAt: Date | null; url: string | null; teamId: string; projectId: string | null; channel: string | null };

/**
 * Posts planned or published in a range, of tasks the viewer may see (the same clause as every
 * work screen), optionally of one project. Dates are Vietnam days.
 */
export async function listCalendarPublishes(viewer: WorkViewer, range: { from: IsoDate; to: IsoDate; projectId?: string }): Promise<CalendarPublish[]> {
  const start = new Date(`${range.from}T00:00:00+07:00`);
  const end = new Date(`${addDays(range.to, 1)}T00:00:00+07:00`);
  const inRange = (column: typeof schema.workPublish.plannedAt | typeof schema.workPublish.publishedAt) => and(gte(column, start), lt(column, end));
  const rows = await db()
    .select({ publish: schema.workPublish, title: schema.task.title, number: schema.workTask.number, teamKey: schema.workTeam.key, teamId: schema.workTask.teamId, projectId: schema.workTask.projectId, channel: schema.workTask.channel })
    .from(schema.workPublish)
    .innerJoin(schema.task, eq(schema.task.id, schema.workPublish.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt), or(inRange(schema.workPublish.plannedAt), inRange(schema.workPublish.publishedAt)), range.projectId ? eq(schema.workTask.projectId, range.projectId) : undefined, await visibleTaskCondition(viewer)))
    .orderBy(asc(schema.workPublish.plannedAt));
  return rows.map(({ publish, title, number, teamKey, teamId, projectId, channel }) => ({ id: publish.id, taskId: publish.taskId, key: taskKey(teamKey, number), title, platform: publish.platform, page: publish.page, status: publish.status, plannedAt: publish.plannedAt, publishedAt: publish.publishedAt, url: publish.url, teamId, projectId, channel }));
}

/** How many publish rows (any status but cancelled) each task has — the calendar's "missing" flag. */
export async function publishCountsByTask(taskIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return new Map();
  const rows = await db()
    .select({ taskId: schema.workPublish.taskId, value: sql<number>`count(*)::int` })
    .from(schema.workPublish)
    .where(and(inArray(schema.workPublish.taskId, ids), inArray(schema.workPublish.status, ["planned", "published"])))
    .groupBy(schema.workPublish.taskId);
  return new Map(rows.map((row) => [row.taskId, Number(row.value)]));
}

// ── Reminders (FR-PJM-54) ───────────────────────────────────────────────────────────────────

/** A post missed longer ago than this has been reported already; the job does not go back further. */
const MISSED_LOOKBACK_DAYS = 7;
const timeInVietnam = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The morning job (there is no hourly slot): posts planned for today → `tasks.publish_due` to the
 * task's assignee (else whoever planned the post), with the time; posts whose planned day has
 * passed and that are still not out → `tasks.publish_missed` to the same people and the project's
 * lead. `work_reminder_sent` keeps each once: "due" per task and day, "missed" per task and planned
 * day — so a second run, or tomorrow's, tells nobody twice.
 */
export async function sendPublishReminders(now: Date = new Date()): Promise<{ due: number; missed: number }> {
  const today = todayInVietnam(now);
  const dayStart = new Date(`${today}T00:00:00+07:00`);
  const dayEnd = new Date(`${addDays(today, 1)}T00:00:00+07:00`);
  const rows = await db()
    .select({ publish: schema.workPublish, title: schema.task.title, assigneeId: schema.task.assigneePersonId, number: schema.workTask.number, teamKey: schema.workTeam.key, projectLeadId: schema.workProject.leadPersonId })
    .from(schema.workPublish)
    .innerJoin(schema.task, eq(schema.task.id, schema.workPublish.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(and(eq(schema.workPublish.status, "planned"), isNotNull(schema.workPublish.plannedAt), lt(schema.workPublish.plannedAt, dayEnd), gte(schema.workPublish.plannedAt, new Date(dayStart.getTime() - MISSED_LOOKBACK_DAYS * 86_400_000)), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress", "done"])))
    .orderBy(asc(schema.workPublish.plannedAt));

  let due = 0;
  let missed = 0;
  for (const row of rows) {
    const plannedAt = row.publish.plannedAt!;
    const isDue = plannedAt >= dayStart;
    const kind = isDue ? "publish_due" : "publish_missed";
    const owner = row.assigneeId ?? row.publish.createdByPersonId;
    const recipients = [...new Set([owner, isDue ? null : row.projectLeadId].filter((id): id is string => !!id))];
    if (recipients.length === 0) continue;
    const sentOn = isDue ? today : todayInVietnam(plannedAt);
    const label = `${taskKey(row.teamKey, row.number)} ${row.title}`;
    await db().transaction(async (tx) => {
      const fresh = await tx.insert(schema.workReminderSent).values(recipients.map((personId) => ({ taskId: row.publish.taskId, personId, kind, sentOn }))).onConflictDoNothing().returning({ personId: schema.workReminderSent.personId });
      if (fresh.length === 0) return;
      await notify({ recipients: fresh.map((mark) => mark.personId), kind: isDue ? "tasks.publish_due" : "tasks.publish_missed", params: isDue ? { task: label, time: timeInVietnam.format(plannedAt) } : { task: label }, link: `/work/tasks/${row.publish.taskId}` }, tx);
      if (isDue) due += 1;
      else missed += 1;
    });
  }
  return { due, missed };
}

export type ContentCalendar = { posts: { id: string; taskId: string; key: string; title: string; teamId: string; platform: string; date: IsoDate; flag: PublishFlag; time: string | null }[]; missingTaskIds: string[] };

/**
 * The content calendar's second layer (FR-PJM-54): each post on its Vietnam day — the day it went
 * out, else the day it is planned for — flagged published, planned or late; and the content tasks
 * on the calendar that are due without any post planned ("missing").
 */
export async function contentCalendar(viewer: WorkViewer, range: { from: IsoDate; to: IsoDate; projectId?: string }, tasks: readonly { id: string; channel: string | null; dueDate: string | null; status: string }[], now: Date = new Date()): Promise<ContentCalendar> {
  const [rows, counts] = await Promise.all([listCalendarPublishes(viewer, range), publishCountsByTask(tasks.filter((task) => task.channel).map((task) => task.id))]);
  const today = todayInVietnam(now);
  const posts = rows
    .filter((row) => row.status !== "cancelled")
    .map((row) => {
      const at = row.publishedAt ?? row.plannedAt;
      return { id: row.id, taskId: row.taskId, key: row.key, title: row.title, teamId: row.teamId, platform: row.platform, date: at ? todayInVietnam(at) : range.from, flag: publishFlag(row, now), time: at ? timeInVietnam.format(at) : null };
    });
  const missingTaskIds = tasks.filter((task) => isPublishMissing(task, counts.get(task.id) ?? 0, today)).map((task) => task.id);
  return { posts, missingTaskIds };
}
