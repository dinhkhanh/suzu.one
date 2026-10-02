// Where a piece of work goes (FR-AST-09): the pages, channels and accounts a task's output is for,
// and the ones a project produces for. The assets themselves — who owns each, who may get in —
// live in the asset register; work only points at them, and only at the ones everybody may name
// (`staff` assets: the register's cached directory).
//
// Kept apart from tasks.ts and publish.ts, which both call in here, so neither imports the other.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { type DigitalDirectoryEntry, listDigitalDirectory } from "@/modules/assets/service";
import { CHANNELS } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
type Activity = { type: string; from?: unknown; to?: unknown };

/** A task or a project names at most this many: more is a list of everything, which says nothing. */
export const MAX_LINKED_DIGITAL_ASSETS = 20;

export type LinkedDigitalAsset = Pick<DigitalDirectoryEntry, "id" | "name" | "platform" | "kind" | "handle" | "url" | "status">;

const asLinked = ({ id, name, platform, kind, handle, url, status }: DigitalDirectoryEntry): LinkedDigitalAsset => ({ id, name, platform, kind, handle, url, status });

/** The work channel a platform posts under: the same name where work has one, "other" where it has not. */
export const channelOfPlatform = (platform: string): (typeof CHANNELS)[number] => ((CHANNELS as readonly string[]).includes(platform) ? (platform as (typeof CHANNELS)[number]) : "other");

/** What a picker offers: every running asset anybody may name. */
export async function listLinkableDigitalAssets(): Promise<LinkedDigitalAsset[]> {
  return (await listDigitalDirectory()).map(asLinked);
}

/**
 * One asset work may point at, or a refusal. Retired assets and restricted ones cannot be named:
 * the first no longer exists, and naming the second would show it to everybody who reads the task.
 */
export async function linkableDigitalAsset(assetId: string, executor?: Executor): Promise<DigitalDirectoryEntry> {
  const entry = (await listDigitalDirectory({ executor })).find((row) => row.id === assetId);
  if (!entry) throw new ActionError("digital_asset_not_linkable");
  return entry;
}

/** The difference between what is linked and what is wanted, checked: only what is new has to be nameable. */
async function plan(tx: Executor, currentIds: readonly string[], wantedIds: readonly string[]) {
  const wanted = [...new Set(wantedIds)];
  if (wanted.length > MAX_LINKED_DIGITAL_ASSETS) throw new ActionError("digital_asset_too_many");
  const directory = new Map((await listDigitalDirectory({ includeRetired: true, executor: tx })).map((entry) => [entry.id, entry]));
  const added = wanted.filter((id) => !currentIds.includes(id));
  // An asset retired after it was linked stays on the work that was done for it; a new link needs a running one.
  if (added.some((id) => !directory.has(id) || directory.get(id)!.status === "retired")) throw new ActionError("digital_asset_not_linkable");
  const removed = currentIds.filter((id) => !wanted.includes(id));
  const named = (id: string) => ({ id, name: directory.get(id)?.name ?? "" });
  return { added, removed, named };
}

/**
 * Sets the assets a task is for, inside the caller's transaction, and returns the changes for the
 * task's activity — display-ready, like every other field's.
 */
export async function syncTaskDigitalAssets(tx: Executor, taskId: string, wantedIds: readonly string[]): Promise<Activity[]> {
  const current = (await tx.select({ id: schema.workTaskDigitalAsset.digitalAssetId }).from(schema.workTaskDigitalAsset).where(eq(schema.workTaskDigitalAsset.taskId, taskId))).map((row) => row.id);
  const { added, removed, named } = await plan(tx, current, wantedIds);
  if (added.length) await tx.insert(schema.workTaskDigitalAsset).values(added.map((digitalAssetId) => ({ taskId, digitalAssetId })));
  if (removed.length) await tx.delete(schema.workTaskDigitalAsset).where(and(eq(schema.workTaskDigitalAsset.taskId, taskId), inArray(schema.workTaskDigitalAsset.digitalAssetId, removed)));
  return [...added.map((id) => ({ type: "digital_asset_added", to: named(id) })), ...removed.map((id) => ({ type: "digital_asset_removed", from: named(id) }))];
}

/** Sets the assets a project produces for. */
export async function setProjectDigitalAssets(projectId: string, wantedIds: readonly string[]): Promise<{ before: string[]; after: string[] }> {
  return db().transaction(async (tx) => {
    const [project] = await tx.select({ id: schema.workProject.id }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1).for("update");
    if (!project) throw new ActionError("project_not_found");
    const current = (await tx.select({ id: schema.workProjectDigitalAsset.digitalAssetId }).from(schema.workProjectDigitalAsset).where(eq(schema.workProjectDigitalAsset.projectId, projectId))).map((row) => row.id);
    const { added, removed, named } = await plan(tx, current, wantedIds);
    if (added.length) await tx.insert(schema.workProjectDigitalAsset).values(added.map((digitalAssetId) => ({ projectId, digitalAssetId })));
    if (removed.length) await tx.delete(schema.workProjectDigitalAsset).where(and(eq(schema.workProjectDigitalAsset.projectId, projectId), inArray(schema.workProjectDigitalAsset.digitalAssetId, removed)));
    const after = [...current.filter((id) => !removed.includes(id)), ...added];
    return { before: current.map((id) => named(id).name), after: after.map((id) => named(id).name) };
  });
}

/** Groups link rows by their owner, each group in the directory's order (platform, then name), so the chips read the same on every screen. */
async function grouped(links: readonly { ownerId: string; digitalAssetId: string }[]): Promise<Map<string, LinkedDigitalAsset[]>> {
  const result = new Map<string, LinkedDigitalAsset[]>();
  if (links.length === 0) return result;
  const directory = await listDigitalDirectory({ includeRetired: true });
  const position = new Map(directory.map((entry, index) => [entry.id, index]));
  // An asset that has since been made restricted is left out: it no longer exists for the readers of the work.
  const known = links.filter((link) => position.has(link.digitalAssetId)).sort((left, right) => position.get(left.digitalAssetId)! - position.get(right.digitalAssetId)!);
  for (const link of known) result.set(link.ownerId, [...(result.get(link.ownerId) ?? []), asLinked(directory[position.get(link.digitalAssetId)!])]);
  return result;
}

/** The assets each of these tasks is for, one query for all of them. */
export async function digitalAssetsByTask(taskIds: readonly string[], executor: Executor = db()): Promise<Map<string, LinkedDigitalAsset[]>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return new Map();
  return grouped(await executor.select({ ownerId: schema.workTaskDigitalAsset.taskId, digitalAssetId: schema.workTaskDigitalAsset.digitalAssetId }).from(schema.workTaskDigitalAsset).where(inArray(schema.workTaskDigitalAsset.taskId, ids)));
}

/** The assets each of these projects produces for. */
export async function digitalAssetsByProject(projectIds: readonly string[], executor: Executor = db()): Promise<Map<string, LinkedDigitalAsset[]>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  return grouped(await executor.select({ ownerId: schema.workProjectDigitalAsset.projectId, digitalAssetId: schema.workProjectDigitalAsset.digitalAssetId }).from(schema.workProjectDigitalAsset).where(inArray(schema.workProjectDigitalAsset.projectId, ids)));
}
