import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ActionError } from "@/lib/action";

export type EntityRow = typeof schema.entity.$inferSelect;
export type DepartmentRow = typeof schema.department.$inferSelect;

export async function listEntities(): Promise<EntityRow[]> {
  return db().select().from(schema.entity).orderBy(asc(schema.entity.code));
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
