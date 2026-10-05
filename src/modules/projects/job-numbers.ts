// Job numbers by project (FR-PJM-02), for the screens that show the work rather than the plan: a
// task's page, a task row's project chip, the lists of older modules. Work cannot import projects,
// and its cached directory holds only its own tables — so the number does not travel inside the
// work module's rows: the **route** asks here for the projects on its screen and hands the numbers
// to the view beside the names, the way Today composes its modules.
//
// Reference data: one entry in the shared cache for the whole small table (project → job number,
// in a stable order), filtered per caller. A job number is written once — when the plan row is
// made, in whatever transaction makes it — and never changes afterwards (D25), so the entry can
// only ever be *short* of a project, never wrong about one. That is checked on every read: a
// project asked for and not in the entry is looked up in Postgres, and when it has a number the
// entry is dropped so the next reader stores the fuller table. A writer that one day changes a
// number that was already issued calls `invalidateJobNumbers()`.
import "server-only";
import { asc, inArray, isNotNull } from "drizzle-orm";
import { cache } from "react";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;
type Entry = [projectId: string, jobNumber: string];

const JOB_NUMBERS_KEY = "projects:job-numbers";

async function readJobNumbers(executor: Executor, projectIds?: readonly string[]): Promise<Entry[]> {
  const rows = await executor
    .select({ projectId: schema.projectPlan.projectId, jobNumber: schema.projectPlan.jobNumber })
    .from(schema.projectPlan)
    .where(projectIds ? inArray(schema.projectPlan.projectId, [...projectIds]) : isNotNull(schema.projectPlan.jobNumber))
    .orderBy(asc(schema.projectPlan.projectId));
  return rows.flatMap((row) => (row.jobNumber ? [[row.projectId, row.jobNumber] as Entry] : []));
}

// Once per request as well: a page and the components it mounts ask for the same table.
const cachedJobNumbers = cache(async (): Promise<Map<string, string>> => new Map(await cached(JOB_NUMBERS_KEY, TTL.reference, () => readJobNumbers(db()))));

/** Call after a job number that was already issued is changed. Making a plan needs no call (see above). */
export const invalidateJobNumbers = () => invalidate(JOB_NUMBERS_KEY);

/**
 * The job numbers of these projects — every project on a screen in one call, never one call per
 * row. A project without a plan yet has no number and no entry. No authorization: the caller
 * passes projects whose names it is already showing the reader, and a job number says no more
 * than the name beside it. Inside a transaction pass it, and the rows are read there.
 */
export async function jobNumbersOf(projectIds: readonly (string | null | undefined)[], executor?: Executor): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  if (executor) return new Map(await readJobNumbers(executor, ids));
  const all = await cachedJobNumbers();
  const result = new Map(ids.flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as Entry] : [])));
  const missing = ids.filter((id) => !all.has(id));
  if (missing.length === 0) return result;
  // Newer than the entry (a project made since it was stored), or simply without a plan yet.
  const found = await readJobNumbers(db(), missing);
  if (found.length > 0) await invalidateJobNumbers();
  for (const [projectId, jobNumber] of found) result.set(projectId, jobNumber);
  return result;
}
