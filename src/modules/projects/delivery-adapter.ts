// What the project layer reads from the work module's delivery records — delivery links, the
// publish log and its results, revision rounds, returned hand-offs — for the acceptance snapshot
// (FR-PJM-55), the client report (FR-PJM-58) and the close-out report (FR-PJM-59). One small file,
// so the shape the work service answers in is turned into what these screens need in one place.
// Every read is the work service's own (`listDeliveriesByTask`, `listPublishesByTask`,
// `revisionRoundsByTask`, `handoffReturnsByTask`); this file only finds the tasks to ask about.
// Sums and lists, no authorization inside: callers pass projects and lines the viewer may read.
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { handoffReturnsByTask, listDeliveriesByTask, listPublishesByTask, revisionRoundsByTask } from "../work/service";
import type { ReportPublish } from "./engine/client-report";

/** The live tasks of a project. */
async function projectTaskIds(projectId: string): Promise<string[]> {
  const rows = await db()
    .select({ taskId: schema.workTask.taskId })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .where(and(eq(schema.workTask.projectId, projectId), isNull(schema.task.deletedAt)));
  return rows.map((row) => row.taskId);
}

/** The links that show a line's units: what was delivered to the client and where it was published. */
export async function adapterLineLinks(lineIds: readonly string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (lineIds.length === 0) return result;
  const links = await db().select({ taskId: schema.projectTaskLink.taskId, lineId: schema.projectTaskLink.deliverableId }).from(schema.projectTaskLink).where(inArray(schema.projectTaskLink.deliverableId, [...lineIds]));
  const lineOf = new Map(links.map((row) => [row.taskId, row.lineId]));
  const taskIds = [...lineOf.keys()];
  const [deliveries, publishes] = await Promise.all([listDeliveriesByTask(taskIds), listPublishesByTask(taskIds)]);
  const add = (taskId: string, link: string | null) => {
    const lineId = lineOf.get(taskId);
    if (!lineId || !link) return;
    const own = result.get(lineId) ?? [];
    if (!own.includes(link)) own.push(link);
    result.set(lineId, own);
  };
  for (const delivery of deliveries) for (const link of delivery.links) add(delivery.taskId, link);
  for (const publish of publishes) if (publish.status === "published") add(publish.taskId, publish.url);
  return result;
}

/** What was published on the project's tasks in a period, each with its latest recorded results. */
export async function adapterPublishes(projectId: string, period: { from: IsoDate; to: IsoDate }): Promise<ReportPublish[]> {
  const taskIds = await projectTaskIds(projectId);
  const publishes = (await listPublishesByTask(taskIds)).filter((row) => row.status === "published" && row.publishedAt);
  if (publishes.length === 0) return [];
  const titles = new Map((await db().select({ id: schema.task.id, title: schema.task.title }).from(schema.task).where(inArray(schema.task.id, [...new Set(publishes.map((row) => row.taskId))]))).map((row) => [row.id, row.title]));
  // Results carry the client's ad spend too; the report shows reach and response, not money.
  return publishes
    .map((row) => ({ platform: row.platform, url: row.url, publishedOn: todayInVietnam(row.publishedAt!), title: titles.get(row.taskId) ?? "", metrics: { reach: row.latest.reach, views: row.latest.views, engagement: row.latest.engagement, clicks: row.latest.clicks } }))
    .filter((row) => row.publishedOn >= period.from && row.publishedOn <= period.to);
}

/** Rounds of changes on the project's tasks: inside the team and by the client. */
export async function adapterRevisionRounds(projectId: string): Promise<{ internal: number; client: number }> {
  const rounds = await revisionRoundsByTask(await projectTaskIds(projectId));
  let internal = 0;
  let client = 0;
  for (const row of rounds.values()) {
    internal += row.internal;
    client += row.client;
  }
  return { internal, client };
}

/** Hand-offs on the project's tasks that the receiver sent back. */
export async function adapterReturnedHandoffs(projectId: string): Promise<number> {
  const returns = await handoffReturnsByTask(await projectTaskIds(projectId));
  return [...returns.values()].reduce((sum, count) => sum + count, 0);
}
