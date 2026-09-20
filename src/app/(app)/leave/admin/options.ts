import "server-only";
import { canManageLeaveConfig } from "@/modules/leave/policy";
import { listEntities } from "@/modules/platform/org/service";
import type { Principal } from "@/modules/platform/rbac/policy";

/** The entities the viewer configures leave for, and whether they may touch the group's rows. */
export async function leaveConfigOptions(principal: Principal) {
  const entities = (await listEntities()).filter((entity) => canManageLeaveConfig(principal, entity.id)).map((entity) => ({ id: entity.id, name: entity.shortName }));
  return { entities, canGroup: canManageLeaveConfig(principal, null) };
}
