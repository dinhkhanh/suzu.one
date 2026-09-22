// Results of published posts in bulk (FR-PJM-57, FR-PLT-36): the figures a social team exports from
// the platforms' dashboards, one line per post and date. A line names its post by the URL it went
// out on, or by the task number when the task has one published post. Only posts of tasks the
// importer may change are found; any other looks exactly like one that does not exist.
import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema, type Tx } from "@/lib/db";
import { type Column, day, integer, type ParsedRow, type Problem, templateCsv } from "../platform/import/engine/table";
import { defineImport } from "../platform/import/service";
import type { ResultMetric } from "./engine/delivery";
import { canManagePublish } from "./policy";
import { saveResult } from "./publish";
import { loadTasks, resolveTaskKey } from "./tasks";
import { loadViewerWith, type ViewerSource } from "./viewer";

const url = (cell: string) => (/^https:\/\/\S+$/i.test(cell) && cell.length <= 1000 ? { ok: true as const, value: cell } : { ok: false as const, code: "bad_url" });
const taskNumber = (cell: string) => (/^[a-z][a-z0-9]{1,7}-\d{1,7}$/i.test(cell.trim()) ? { ok: true as const, value: cell.trim().toUpperCase() } : { ok: false as const, code: "bad_task_number" });
const count = (cell: string) => {
  const parsed = integer(cell);
  return parsed.ok && (parsed.value as number) < 0 ? { ok: false as const, code: "amount_negative" } : parsed;
};

export const resultColumns = {
  url: { headers: ["Link bài đăng", "Post URL", "URL"], parse: url, example: "https://www.facebook.com/vinamilk/posts/123" } as Column<string>,
  taskNumber: { headers: ["Mã công việc", "Task number", "Task"], parse: taskNumber, example: "SOC-12" } as Column<string>,
  recordedOn: { headers: ["Ngày", "Date"], required: true, parse: day, example: "20/10/2026" } as Column<string>,
  reach: { headers: ["Tiếp cận", "Reach"], parse: count, example: "12.500" } as Column<number>,
  views: { headers: ["Lượt xem", "Views"], parse: count, example: "8.200" } as Column<number>,
  engagement: { headers: ["Tương tác", "Engagement"], parse: count, example: "640" } as Column<number>,
  clicks: { headers: ["Lượt nhấp", "Clicks"], parse: count, example: "95" } as Column<number>,
  spendVnd: { headers: ["Chi phí (VND)", "Spend (VND)", "Spend"], parse: count, example: "1.500.000" } as Column<number>,
};

export const resultTemplate = () => templateCsv(resultColumns);

type Row = ParsedRow<typeof resultColumns>;
type Resolved = { row: Row; publishId: string };
type Importer = ViewerSource & { person: { id: string } };

const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
const METRICS: ResultMetric[] = ["reach", "views", "engagement", "clicks", "spendVnd"];

/** Each line's post, and every problem. Exported for the tests; the import itself goes through `resultImport`. */
export async function resolveResultRows(rows: Row[], user: Importer, executor: Tx | ReturnType<typeof db> = db()): Promise<{ problems: Problem[]; resolved: Resolved[] }> {
  const problems: Problem[] = [];
  const resolved: Resolved[] = [];
  const headers = { url: resultColumns.url.headers[0], task: resultColumns.taskNumber.headers[0], date: resultColumns.recordedOn.headers[0] };
  const viewer = await loadViewerWith(executor, user);

  const keys = [...new Set(rows.flatMap((row) => (row.values.taskNumber ? [row.values.taskNumber] : [])))];
  const taskByKey = new Map<string, string>();
  for (const key of keys) {
    const id = await resolveTaskKey(key, executor);
    if (id) taskByKey.set(key, id);
  }
  const urls = rows.flatMap((row) => (row.values.url ? [normalize(row.values.url)] : []));
  const taskIds = [...taskByKey.values()];
  const byUrl = urls.length ? sql`lower(rtrim(trim(${schema.workPublish.url}), '/')) IN (${sql.join(
    urls.map((value) => sql`${value}`),
    sql`, `,
  )})` : undefined;
  const byTask = taskIds.length ? inArray(schema.workPublish.taskId, taskIds) : undefined;
  const candidates = byUrl || byTask ? await executor.select({ id: schema.workPublish.id, taskId: schema.workPublish.taskId, url: schema.workPublish.url }).from(schema.workPublish).where(and(eq(schema.workPublish.status, "published"), or(byUrl, byTask))) : [];
  const tasks = await loadTasks([...new Set(candidates.map((publish) => publish.taskId))], executor);
  const mine = candidates.filter((publish) => {
    const task = tasks.get(publish.taskId);
    return !!task && canManagePublish(viewer, task.facts);
  });

  const seen = new Set<string>();
  for (const row of rows) {
    const { url: link, taskNumber: key, recordedOn } = row.values;
    if (!recordedOn) continue;
    if (!link && !key) {
      problems.push({ row: row.row, column: headers.url, code: "post_reference_required" });
      continue;
    }
    let matches = mine;
    if (link) matches = matches.filter((publish) => publish.url && normalize(publish.url) === normalize(link));
    if (key) matches = matches.filter((publish) => publish.taskId === taskByKey.get(key));
    if (matches.length === 0) {
      problems.push({ row: row.row, column: link ? headers.url : headers.task, code: "post_not_found", detail: link ?? key ?? undefined });
      continue;
    }
    if (matches.length > 1) {
      problems.push({ row: row.row, column: headers.url, code: "post_ambiguous", detail: key ?? undefined });
      continue;
    }
    if (METRICS.every((metric) => row.values[metric] === null)) {
      problems.push({ row: row.row, column: resultColumns.reach.headers[0], code: "metrics_required" });
      continue;
    }
    const seenKey = `${matches[0].id}:${recordedOn}`;
    if (seen.has(seenKey)) problems.push({ row: row.row, column: headers.date, code: "duplicate_in_file" });
    seen.add(seenKey);
    resolved.push({ row, publishId: matches[0].id });
  }
  return { problems, resolved };
}

export async function commitResultRows(rows: Row[], tx: Tx, user: Importer): Promise<{ saved: number; updated: number }> {
  const { resolved } = await resolveResultRows(rows, user, tx);
  let saved = 0;
  let updated = 0;
  for (const { row, publishId } of resolved) {
    const { replaced } = await saveResult(tx, publishId, { recordedOn: row.values.recordedOn!, reach: row.values.reach, views: row.values.views, engagement: row.values.engagement, clicks: row.values.clicks, spendVnd: row.values.spendVnd }, "csv", user.person.id);
    if (replaced) updated += 1;
    else saved += 1;
  }
  return { saved, updated };
}

/** Every signed-in employee may try: each line is checked against the tasks the importer may change. */
export const resultImport = defineImport({
  kind: "publish_results",
  columns: resultColumns,
  authorize: (user) => user.principal.workforceType !== "collaborator",
  validate: async (rows, user) => (await resolveResultRows(rows, user)).problems,
  commit: (rows, tx, user) => commitResultRows(rows, tx, user),
  onCommitted: () => revalidatePath("/work", "layout"),
});

