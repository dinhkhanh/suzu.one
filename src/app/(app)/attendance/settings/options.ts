import "server-only";
import { canManageAttendanceConfig } from "@/modules/attendance/policy";
import { listEntities } from "@/modules/platform/org/service";
import type { Principal } from "@/modules/platform/rbac/policy";

/** The entities the viewer configures attendance for, and whether they may touch the group's rows. */
export async function configOptions(principal: Principal) {
  const entities = (await listEntities()).filter((entity) => canManageAttendanceConfig(principal, entity.id)).map((entity) => ({ id: entity.id, name: entity.shortName }));
  return { entities, canGroup: canManageAttendanceConfig(principal, null) };
}
