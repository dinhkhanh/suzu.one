// Picker options for payroll forms. Codes and names are public_internal; still not a server
// action — pages call this after their own checks.
import "server-only";
import { listEntities } from "@/modules/platform/org/service";
import type { EntityReach } from "./reach";

export type EntityOption = { id: string; code: string; shortName: string };

export async function listEntityOptions(reach: EntityReach = { all: true }): Promise<EntityOption[]> {
  // From the shared cache of entities (ordered by code).
  const rows = (await listEntities()).filter((row) => row.isActive && (reach.all || reach.entityIds.includes(row.id)));
  return rows.map((row) => ({ id: row.id, code: row.code, shortName: row.shortName }));
}
