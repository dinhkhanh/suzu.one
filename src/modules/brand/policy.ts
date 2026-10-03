// Who keeps which brand kit (FR-BRD-01). Pure. What the *public* may see is not a permission —
// it is the kit's visibility and each file's public switch, read by `public.ts`.
import { can, type Principal } from "../platform/rbac/policy";

/**
 * May the principal keep this kit — edit it, add and remove its files, publish it? `brand:manage`
 * over the kit's entity; a kit of the whole group (no entity) needs a group grant.
 */
export const canManageBrandKit = (principal: Principal, kit: { entityId: string | null }): boolean => can(principal, "brand:manage", { entityId: kit.entityId });

/** Whether the principal keeps any kit at all (the admin entry and the list page). */
export const canManageAnyBrandKit = (principal: Principal): boolean => can(principal, "brand:manage");
