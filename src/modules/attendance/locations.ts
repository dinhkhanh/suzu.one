// Work locations (FR-ATT-04): where an entity's people may check in, and what happens when a
// check-in is somewhere else.
import "server-only";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import { listEntities } from "@/modules/platform/org/service";
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

// A few rows per entity, read by every check-in: the whole table sits in the shared cache and
// `saveLocation` drops it. Callers filter by entity and `isActive` themselves.
const LOCATION_CACHE = "attendance:work-locations";
const LOCATION_TTL = 60 * 60;

/** For writers outside this file (seeds): the locations changed. */
export const invalidateLocationCache = () => invalidate(LOCATION_CACHE);

/** Every work location, active or not. */
export async function listAllLocations(): Promise<WorkLocationRow[]> {
  return cached(LOCATION_CACHE, LOCATION_TTL, () => db().select().from(schema.workLocation));
}

export async function listLocations(): Promise<(WorkLocationRow & { entityName: string })[]> {
  const [locations, entities] = await Promise.all([listAllLocations(), listEntities()]);
  const nameOf = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  return locations
    .flatMap((location) => (nameOf.has(location.entityId) ? [{ ...location, entityName: nameOf.get(location.entityId)! }] : []))
    .sort((a, b) => a.entityName.localeCompare(b.entityName) || a.name.localeCompare(b.name));
}

export async function saveLocation(input: LocationInput): Promise<{ before: WorkLocationRow | null; after: WorkLocationRow }> {
  const ipAllowlist = [...new Set(input.ipAllowlist.map((cidr) => cidr.trim()).filter(Boolean))];
  const [problem] = locationProblems({ ...input, ipAllowlist });
  if (problem) throw new ActionError(problem);
  const values = { name: input.name, address: input.address, latitude: input.latitude, longitude: input.longitude, radiusM: input.radiusM, accuracyLimitM: input.accuracyLimitM, ipAllowlist, rule: input.rule, mode: input.mode, isActive: input.isActive };

  if (!input.id) {
    const [after] = await db().insert(schema.workLocation).values({ entityId: input.entityId, ...values }).returning();
    await invalidate(LOCATION_CACHE);
    return { before: null, after };
  }
  const before = await getLocation(input.id);
  if (!before) throw new ActionError("location_not_found");
  // A location stays with its entity: punches already point at it.
  if (before.entityId !== input.entityId) throw new ActionError("location_entity_fixed");
  const [after] = await db().update(schema.workLocation).set({ ...values, updatedAt: new Date() }).where(eq(schema.workLocation.id, input.id)).returning();
  await invalidate(LOCATION_CACHE);
  return { before, after };
}
