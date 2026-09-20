// Picker options for payroll forms. Codes and names are public_internal; still not a server
// action — pages call this after their own checks.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { EntityReach } from "./reach";

export type EntityOption = { id: string; code: string; shortName: string };

export async function listEntityOptions(reach: EntityReach = { all: true }): Promise<EntityOption[]> {
  const rows = await db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.isActive, true)).orderBy(schema.entity.code);
  return reach.all ? rows : rows.filter((row) => reach.entityIds.includes(row.id));
}
