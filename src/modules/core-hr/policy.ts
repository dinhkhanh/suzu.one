// Authorization rules for Core HR, built on the central policy layer. Pure.
import { can, canReadTier, type Principal, type Target, tierReach } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";

/** The people list. Collaborators have no directory access (FR-PLT-07) unless a role gives it. */
export function canBrowsePeople(principal: Principal): boolean {
  return principal.workforceType !== "collaborator" || can(principal, "person:read");
}

/** Filters and columns for personal-tier facts (workforce type, status): only for roles that read that tier. */
export function canFilterByPersonalFacts(principal: Principal): boolean {
  const reach = tierReach({ ...principal, personId: null }, "personal");
  return reach.all || reach.entityIds.length + reach.departmentIds.length + reach.teamIds.length > 0;
}

export function canHireInto(principal: Principal, placement: Target): boolean {
  return can(principal, "person:manage", placement);
}

/** Moving someone needs authority over where they are and over where they are going. */
export function canReassign(principal: Principal, from: Target, to: Target): boolean {
  return can(principal, "person:manage", from) && can(principal, "person:manage", to);
}

/**
 * The work email is the sign-in identity. Re-pointing the email of someone who holds role grants
 * would hand those grants to whoever owns the new address, so it takes `rbac:manage` as well.
 */
export function canEditPerson(principal: Principal, target: Target, change: { changesWorkEmail: boolean; targetHoldsRoles: boolean }): boolean {
  if (!can(principal, "person:manage", target)) return false;
  return !(change.changesWorkEmail && change.targetHoldsRoles) || can(principal, "rbac:manage", target);
}

type PersonTarget = Target & { personId: string };

/** Records above the directory tier — contracts, dependents, vault documents, restricted fields — are read by tier alone. */
export function canReadRecords(principal: Principal, person: PersonTarget | null, tier: Tier): boolean {
  return !!person && canReadTier(principal, person, tier);
}

/**
 * Writing takes HR authority over the person *and* the right to read what is being written: entity
 * HR staff keep the restricted records, but cannot attach a signed contract or salary terms
 * (compensation). Being the person is not enough — employees change their data through change requests.
 */
export function canManageRecords(principal: Principal, person: PersonTarget | null, tier: Tier): boolean {
  return !!person && can(principal, "person:manage", person) && canReadTier(principal, person, tier);
}

/**
 * Answering an employee's change request: HR authority over the person, and — when the request
 * carries restricted values — the right to read that tier. A line manager has neither.
 */
export function canDecideProfileChange(principal: Principal, person: PersonTarget | null, request: { hasRestricted: boolean }): boolean {
  return !!person && principal.personId !== person.personId && can(principal, "person:manage", person) && (!request.hasRestricted || canReadTier(principal, person, "restricted"));
}
