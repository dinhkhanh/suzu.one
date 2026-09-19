import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ActionError } from "@/lib/action";

export type EntityRow = typeof schema.entity.$inferSelect;
export type DepartmentRow = typeof schema.department.$inferSelect;

export async function listEntities(): Promise<EntityRow[]> {
  return db().select().from(schema.entity).orderBy(asc(schema.entity.code));
}

export type TeamRow = typeof schema.team.$inferSelect;
export type BranchRow = typeof schema.branch.$inferSelect;

export async function listTeams(): Promise<TeamRow[]> {
  return db().select().from(schema.team).orderBy(asc(schema.team.name));
}

export async function listBranches(): Promise<BranchRow[]> {
  return db().select().from(schema.branch).orderBy(asc(schema.branch.name));
}

export async function listDepartments(): Promise<DepartmentRow[]> {
  return db().select().from(schema.department).orderBy(asc(schema.department.name));
}

export type EntityInput = {
  code: string;
  legalName: string;
  shortName: string;
  taxCode?: string;
  wageRegion?: number;
};

export type EntityDetails = Pick<EntityRow, "legalName" | "shortName" | "taxCode" | "insuranceUnitCode" | "wageRegion" | "address" | "legalRepresentative" | "isActive">;

export async function createEntity(input: EntityInput): Promise<EntityRow> {
  const code = input.code.trim().toUpperCase();
  const [existing] = await db().select({ id: schema.entity.id }).from(schema.entity).where(eq(schema.entity.code, code)).limit(1);
  if (existing) throw new ActionError("entity_code_taken");

  const [created] = await db()
    .insert(schema.entity)
    .values({
      code,
      legalName: input.legalName.trim(),
      shortName: input.shortName.trim(),
      taxCode: input.taxCode?.trim() || null,
      wageRegion: input.wageRegion ?? null,
    })
    .returning();
  return created;
}

export async function findEntity(id: string): Promise<EntityRow | undefined> {
  const [row] = await db().select().from(schema.entity).where(eq(schema.entity.id, id)).limit(1);
  return row;
}

export async function findBranch(id: string): Promise<BranchRow | undefined> {
  const [row] = await db().select().from(schema.branch).where(eq(schema.branch.id, id)).limit(1);
  return row;
}

export async function findDepartment(id: string): Promise<DepartmentRow | undefined> {
  const [row] = await db().select().from(schema.department).where(eq(schema.department.id, id)).limit(1);
  return row;
}

export async function findTeam(id: string): Promise<TeamRow | undefined> {
  const [row] = await db().select().from(schema.team).where(eq(schema.team.id, id)).limit(1);
  return row;
}

// Switching something off while people still sit in it would leave them pointing at a dead unit.
async function hasCurrentPeople(column: typeof schema.person.primaryEntityId | typeof schema.person.departmentId | typeof schema.person.teamId, id: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.person.id })
    .from(schema.person)
    .where(and(eq(column, id), ne(schema.person.status, "offboarded")))
    .limit(1);
  return !!row;
}

type Change<Row> = { before: Row; after: Row };

export async function updateEntity(id: string, details: EntityDetails): Promise<Change<EntityRow>> {
  const before = await findEntity(id);
  if (!before) throw new ActionError("not_found");
  if (before.isActive && !details.isActive && (await hasCurrentPeople(schema.person.primaryEntityId, id))) throw new ActionError("entity_in_use");
  const [after] = await db().update(schema.entity).set({ ...details, updatedAt: new Date() }).where(eq(schema.entity.id, id)).returning();
  return { before, after };
}

export async function createBranch(input: { entityId: string; name: string; address: string | null }): Promise<BranchRow> {
  if (!(await findEntity(input.entityId))) throw new ActionError("not_found");
  const [created] = await db().insert(schema.branch).values(input).returning();
  return created;
}

export async function updateBranch(id: string, details: Pick<BranchRow, "name" | "address" | "isActive">): Promise<Change<BranchRow>> {
  const before = await findBranch(id);
  if (!before) throw new ActionError("not_found");
  const [after] = await db().update(schema.branch).set({ ...details, updatedAt: new Date() }).where(eq(schema.branch.id, id)).returning();
  return { before, after };
}

export type DepartmentDetails = Pick<DepartmentRow, "name" | "parentId" | "isActive">;

// A department may not sit under itself, directly or through its own sub-departments.
async function assertParentAllowed(departmentId: string | null, parentId: string | null): Promise<void> {
  let cursor = parentId;
  for (let depth = 0; cursor && depth < 20; depth++) {
    if (cursor === departmentId) throw new ActionError("department_parent_loop");
    const parent = await findDepartment(cursor);
    if (!parent) throw new ActionError("department_parent_not_found");
    cursor = parent.parentId;
  }
}

export async function createDepartment(input: { code: string; name: string; parentId: string | null; entityId: string | null }): Promise<DepartmentRow> {
  const code = input.code.trim().toUpperCase();
  const [existing] = await db().select({ id: schema.department.id }).from(schema.department).where(eq(schema.department.code, code)).limit(1);
  if (existing) throw new ActionError("department_code_taken");
  await assertParentAllowed(null, input.parentId);
  const [created] = await db().insert(schema.department).values({ ...input, code }).returning();
  return created;
}

export async function updateDepartment(id: string, details: DepartmentDetails): Promise<Change<DepartmentRow>> {
  const before = await findDepartment(id);
  if (!before) throw new ActionError("not_found");
  await assertParentAllowed(id, details.parentId);
  if (before.isActive && !details.isActive && (await hasCurrentPeople(schema.person.departmentId, id))) throw new ActionError("department_in_use");
  const [after] = await db().update(schema.department).set({ ...details, updatedAt: new Date() }).where(eq(schema.department.id, id)).returning();
  return { before, after };
}

export async function createTeam(input: { departmentId: string; name: string }): Promise<TeamRow> {
  if (!(await findDepartment(input.departmentId))) throw new ActionError("not_found");
  const [created] = await db().insert(schema.team).values(input).returning();
  return created;
}

export async function updateTeam(id: string, details: Pick<TeamRow, "name" | "isActive">): Promise<Change<TeamRow>> {
  const before = await findTeam(id);
  if (!before) throw new ActionError("not_found");
  if (before.isActive && !details.isActive && (await hasCurrentPeople(schema.person.teamId, id))) throw new ActionError("team_in_use");
  const [after] = await db().update(schema.team).set({ ...details, updatedAt: new Date() }).where(eq(schema.team.id, id)).returning();
  return { before, after };
}
