// Work locations (FR-ATT-04): where an entity's people may check in, and what happens when a
// check-in is somewhere else.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { locationProblems, type LocationMode, type LocationRule } from "./engine/geofence";

export type WorkLocationRow = typeof schema.workLocation.$inferSelect;

export type LocationInput = {
  id: string | null;
  entityId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
  accuracyLimitM: number;
  ipAllowlist: string[];
  rule: LocationRule;
  mode: LocationMode;
  isActive: boolean;
};

export async function getLocation(id: string): Promise<WorkLocationRow | null> {
  const [row] = await db().select().from(schema.workLocation).where(eq(schema.workLocation.id, id)).limit(1);
  return row ?? null;
}

export async function listLocations(): Promise<(WorkLocationRow & { entityName: string })[]> {
  const rows = await db()
    .select({ location: schema.workLocation, entityName: schema.entity.shortName })
    .from(schema.workLocation)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.workLocation.entityId))
    .orderBy(asc(schema.entity.shortName), asc(schema.workLocation.name));
  return rows.map((row) => ({ ...row.location, entityName: row.entityName }));
}

export async function saveLocation(input: LocationInput): Promise<{ before: WorkLocationRow | null; after: WorkLocationRow }> {
  const ipAllowlist = [...new Set(input.ipAllowlist.map((cidr) => cidr.trim()).filter(Boolean))];
  const [problem] = locationProblems({ ...input, ipAllowlist });
  if (problem) throw new ActionError(problem);
  const values = { name: input.name, address: input.address, latitude: input.latitude, longitude: input.longitude, radiusM: input.radiusM, accuracyLimitM: input.accuracyLimitM, ipAllowlist, rule: input.rule, mode: input.mode, isActive: input.isActive };

  if (!input.id) {
    const [after] = await db().insert(schema.workLocation).values({ entityId: input.entityId, ...values }).returning();
    return { before: null, after };
  }
  const before = await getLocation(input.id);
  if (!before) throw new ActionError("location_not_found");
  // A location stays with its entity: punches already point at it.
  if (before.entityId !== input.entityId) throw new ActionError("location_entity_fixed");
  const [after] = await db().update(schema.workLocation).set({ ...values, updatedAt: new Date() }).where(eq(schema.workLocation.id, input.id)).returning();
  return { before, after };
}
