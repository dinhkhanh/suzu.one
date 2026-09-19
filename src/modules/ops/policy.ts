// Who may see and do what in the ops tracker. Pure. Reading = `ops:read` or `ops:manage` over the
// instance's entity; the owner (assignee) and the reviewer always see their own instance, and the
// owner works and closes it; everything else — reassign, cancel, reopen, on someone's behalf — is
// `ops:manage`. The library belongs to the group: changing a template takes `ops:manage` there.
import { can, entityReach, type Principal } from "../platform/rbac/policy";

export type InstanceParties = { entityId: string; assigneePersonId: string | null; reviewerPersonId: string | null };

const over = (entityId: string | null | undefined) => (entityId ? { entityId } : {});

/** Without an entity: "anywhere at all" — navigation only, never data. */
export const canReadOps = (principal: Principal, entityId?: string): boolean =>
  entityId === undefined ? can(principal, "ops:read") || can(principal, "ops:manage") : can(principal, "ops:read", over(entityId)) || can(principal, "ops:manage", over(entityId));

export const canManageOps = (principal: Principal, entityId?: string): boolean => (entityId === undefined ? can(principal, "ops:manage") : can(principal, "ops:manage", over(entityId)));

/** The obligation library is shared by every entity: only a group-wide grant changes or reviews it. */
export const canManageLibrary = (principal: Principal): boolean => can(principal, "ops:manage", {});

const isParty = (principal: Principal, instance: InstanceParties) => !!principal.personId && (instance.assigneePersonId === principal.personId || instance.reviewerPersonId === principal.personId);

export const canViewInstance = (principal: Principal, instance: InstanceParties): boolean => canReadOps(principal, instance.entityId) || isParty(principal, instance);

/** Tick the checklist, record evidence, start and complete. */
export const canWorkInstance = (principal: Principal, instance: InstanceParties): boolean => (!!principal.personId && instance.assigneePersonId === principal.personId) || canManageOps(principal, instance.entityId);

/** Reassign, cancel, reopen. */
export const canManageInstance = (principal: Principal, instance: InstanceParties): boolean => canManageOps(principal, instance.entityId);

/** The list form of `canReadOps`: which entities' instances the principal reads (their own come on top). */
export function opsReach(principal: Principal): { all: true } | { all: false; entityIds: string[] } {
  const read = entityReach(principal, "ops:read");
  const manage = entityReach(principal, "ops:manage");
  if (read.all || manage.all) return { all: true };
  return { all: false, entityIds: [...new Set([...read.entityIds, ...manage.entityIds])] };
}
