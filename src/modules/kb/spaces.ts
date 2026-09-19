// Spaces (FR-KB-01) and who they are open to (FR-KB-03).
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { ROLES } from "../platform/rbac/roles";
import { spaceVisibleSql } from "./access-sql";
import { type AccessLevel, parseSubjectKey, SPACE_KEY, type SpaceKind } from "./enums";
import { type AccessRow, type KbLevel, type KbViewer, type SpaceFacts, spaceLevel } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type SpaceRow = typeof schema.kbSpace.$inferSelect;
export type LoadedSpace = { space: SpaceRow; access: AccessRow[]; facts: SpaceFacts };

export const spaceFacts = (space: Pick<SpaceRow, "entityId" | "kind" | "archivedAt">, access: readonly AccessRow[]): SpaceFacts => ({ entityId: space.entityId, kind: space.kind, archived: !!space.archivedAt, access });

async function spaceAccessRows(executor: Executor, spaceIds: readonly string[]): Promise<Map<string, AccessRow[]>> {
  const rows = spaceIds.length
    ? await executor
        .select({ spaceId: schema.kbAccess.spaceId, subjectKey: schema.kbAccess.subjectKey, level: schema.kbAccess.level })
        .from(schema.kbAccess)
        .where(and(inArray(schema.kbAccess.spaceId, [...spaceIds]), isNull(schema.kbAccess.pageId)))
        .orderBy(asc(schema.kbAccess.createdAt))
    : [];
  const bySpace = new Map<string, AccessRow[]>(spaceIds.map((id) => [id, []]));
  for (const row of rows) bySpace.get(row.spaceId)!.push({ subjectKey: row.subjectKey, level: row.level });
  return bySpace;
}

export async function loadSpace(where: { id: string } | { key: string }, executor: Executor = db()): Promise<LoadedSpace | null> {
  const [space] = await executor.select().from(schema.kbSpace).where("id" in where ? eq(schema.kbSpace.id, where.id) : eq(schema.kbSpace.key, where.key)).limit(1);
  if (!space) return null;
  const access = (await spaceAccessRows(executor, [space.id])).get(space.id)!;
  return { space, access, facts: spaceFacts(space, access) };
}

export type SpaceListRow = SpaceRow & { level: KbLevel; entityName: string | null; pageCount: number };

/** The spaces the viewer may open, filtered in SQL, each with what they may do there. */
export async function listSpaces(viewer: KbViewer): Promise<SpaceListRow[]> {
  const rows = await db()
    .select({
      space: schema.kbSpace,
      entityName: schema.entity.shortName,
      pageCount: sql<number>`(select count(*)::int from ${schema.kbPage} where ${schema.kbPage.spaceId} = ${schema.kbSpace.id} and ${schema.kbPage.deletedAt} is null and ${schema.kbPage.publishedVersionId} is not null and ${schema.kbPage.status} <> 'archived')`,
    })
    .from(schema.kbSpace)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.kbSpace.entityId))
    .where(spaceVisibleSql(viewer))
    .orderBy(asc(schema.kbSpace.sortOrder), asc(schema.kbSpace.name));
  const access = await spaceAccessRows(db(), rows.map((row) => row.space.id));
  return rows.flatMap(({ space, entityName, pageCount }) => {
    const level = spaceLevel(viewer, spaceFacts(space, access.get(space.id) ?? []));
    return level ? [{ ...space, level, entityName, pageCount }] : [];
  });
}

export type SpaceInput = { key: string; name: string; description: string | null; icon: string | null; entityId: string | null; kind: SpaceKind; sortOrder: number };

export async function createSpace(input: SpaceInput, actorPersonId: string, access: readonly AccessRow[] = []): Promise<SpaceRow> {
  if (!SPACE_KEY.test(input.key)) throw new ActionError("kb_space_key_invalid");
  return db().transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.kbSpace.id }).from(schema.kbSpace).where(eq(schema.kbSpace.key, input.key)).limit(1);
    if (taken) throw new ActionError("kb_space_key_taken");
    if (input.entityId) {
      const [entity] = await tx.select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
      if (!entity) throw new ActionError("kb_subject_unknown");
    }
    const [space] = await tx.insert(schema.kbSpace).values({ ...input, createdByPersonId: actorPersonId }).returning();
    if (access.length) await replaceAccess(tx, space.id, null, access);
    return space;
  });
}

/** The key and the entity stay: the key is in every link, and the entity decides who manages the space. */
export async function updateSpace(spaceId: string, values: Pick<SpaceInput, "name" | "description" | "icon" | "kind" | "sortOrder">): Promise<{ before: SpaceRow; after: SpaceRow }> {
  const [before] = await db().select().from(schema.kbSpace).where(eq(schema.kbSpace.id, spaceId)).limit(1);
  if (!before) throw new ActionError("kb_space_not_found");
  const [after] = await db().update(schema.kbSpace).set({ ...values, updatedAt: new Date() }).where(eq(schema.kbSpace.id, spaceId)).returning();
  return { before, after };
}

export async function setSpaceArchived(spaceId: string, archived: boolean): Promise<{ before: SpaceRow; after: SpaceRow }> {
  const [before] = await db().select().from(schema.kbSpace).where(eq(schema.kbSpace.id, spaceId)).limit(1);
  if (!before) throw new ActionError("kb_space_not_found");
  const [after] = await db().update(schema.kbSpace).set({ archivedAt: archived ? (before.archivedAt ?? new Date()) : null, updatedAt: new Date() }).where(eq(schema.kbSpace.id, spaceId)).returning();
  return { before, after };
}

// ── Access rows ─────────────────────────────────────────────────────────────────────────────

/** Every key names something that exists; the same subject is listed once (the higher level wins). */
async function checkedRows(executor: Executor, rows: readonly AccessRow[]): Promise<AccessRow[]> {
  const byKey = new Map<string, AccessLevel>();
  const ids: Record<"entity" | "department" | "team" | "person", string[]> = { entity: [], department: [], team: [], person: [] };
  for (const row of rows) {
    const parsed = parseSubjectKey(row.subjectKey);
    if (!parsed) throw new ActionError("kb_subject_unknown");
    const key = parsed.type === "all" ? "all" : `${parsed.type}:${parsed.id}`;
    if (parsed.type === "role") {
      if (!(ROLES as readonly string[]).includes(parsed.id!)) throw new ActionError("kb_subject_unknown");
    } else if (parsed.type !== "all") ids[parsed.type].push(parsed.id!);
    byKey.set(key, byKey.get(key) === "edit" ? "edit" : row.level);
  }
  const tables = { entity: schema.entity, department: schema.department, team: schema.team, person: schema.person } as const;
  for (const type of ["entity", "department", "team", "person"] as const) {
    const wanted = [...new Set(ids[type])];
    if (wanted.length === 0) continue;
    const found = await executor.select({ id: tables[type].id }).from(tables[type]).where(inArray(tables[type].id, wanted));
    if (found.length !== wanted.length) throw new ActionError("kb_subject_unknown");
  }
  return [...byKey].map(([subjectKey, level]) => ({ subjectKey, level }));
}

export async function replaceAccess(tx: Tx, spaceId: string, pageId: string | null, rows: readonly AccessRow[]): Promise<AccessRow[]> {
  if (rows.length > 100) throw new ActionError("kb_access_too_many");
  const checked = await checkedRows(tx, rows);
  await tx.delete(schema.kbAccess).where(and(eq(schema.kbAccess.spaceId, spaceId), pageId ? eq(schema.kbAccess.pageId, pageId) : isNull(schema.kbAccess.pageId)));
  if (checked.length) await tx.insert(schema.kbAccess).values(checked.map((row) => ({ spaceId, pageId, ...row })));
  return checked;
}

export async function setSpaceAccess(spaceId: string, rows: readonly AccessRow[]): Promise<{ before: AccessRow[]; after: AccessRow[] }> {
  return db().transaction(async (tx) => {
    const loaded = await loadSpace({ id: spaceId }, tx);
    if (!loaded) throw new ActionError("kb_space_not_found");
    return { before: loaded.access, after: await replaceAccess(tx, spaceId, null, rows) };
  });
}

// ── What the access form offers, and how rows read ──────────────────────────────────────────

export type SubjectOptions = { entities: { id: string; name: string }[]; departments: { id: string; name: string }[]; teams: { id: string; name: string }[]; people: { id: string; name: string }[]; roles: readonly string[] };

export async function subjectOptions(): Promise<SubjectOptions> {
  const [entities, departments, teams, people] = await Promise.all([
    db().select({ id: schema.entity.id, name: schema.entity.shortName }).from(schema.entity).orderBy(asc(schema.entity.shortName)),
    db().select({ id: schema.department.id, name: schema.department.name }).from(schema.department).orderBy(asc(schema.department.name)),
    db().select({ id: schema.team.id, name: schema.team.name }).from(schema.team).orderBy(asc(schema.team.name)),
    db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.status, ["active", "preboarding"])).orderBy(asc(schema.person.searchName)),
  ]);
  return { entities, departments, teams, people, roles: ROLES };
}

/** Names for subject keys ("entity:<id>" → "Media"); roles and "all" are put into words by the screen. */
export async function subjectNames(keys: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const tables = { entity: [schema.entity, schema.entity.shortName], department: [schema.department, schema.department.name], team: [schema.team, schema.team.name], person: [schema.person, schema.person.fullName] } as const;
  for (const type of ["entity", "department", "team", "person"] as const) {
    const ids = keys.flatMap((key) => (key.startsWith(`${type}:`) ? [key.slice(type.length + 1)] : []));
    if (ids.length === 0) continue;
    const [table, column] = tables[type];
    const rows = await db().select({ id: table.id, name: column }).from(table).where(inArray(table.id, ids));
    for (const row of rows) names.set(`${type}:${row.id}`, row.name);
  }
  return names;
}
