// Pure authorization rules: role × scope × sensitivity tier (SRS §2.2). No I/O.
import { ROLE_DEFINITIONS, type Permission, type Role, type Tier, tierRank } from "./roles";

export type Scope =
  | { type: "group" }
  | { type: "entity"; id: string }
  // One unit of the org tree — and, with it, every unit below (FR-PLT-16): a grant on Marketing
  // covers Marketing › Social › Video Editing without naming them. `covers` is that subtree, read
  // from the tree when the grant is loaded (`loadGrants`); without it the grant reaches the one
  // unit alone, which is what a hand-built grant in a test means.
  | { type: "unit"; id: string; covers?: readonly string[] };

/** Every unit a unit grant reaches. */
export const unitsCovered = (scope: Extract<Scope, { type: "unit" }>): readonly string[] => scope.covers ?? [scope.id];

export type Grant = { role: Role; scope: Scope };

export type Principal = {
  personId: string | null;
  workforceType: "employee" | "probation" | "intern" | "part_time" | "collaborator" | "advisor" | null;
  grants: readonly Grant[];
};

// Where the thing being accessed sits in the organisation. Omit fields that do not apply.
export type Target = {
  entityId?: string | null;
  /**
   * The unit the thing sits in and every unit above it, root first — `person.org_unit_path`, or
   * `unitPathOf(...)` for a record that names a unit. A grant matches when any of these units is
   * one the grant covers. Passing the unit alone (`[unitId]`) is enough where the chain is not at
   * hand: a loaded grant knows its own subtree.
   */
  unitPath?: readonly string[] | null;
  // For person-shaped resources.
  personId?: string | null;
  managerId?: string | null;
};

export function scopeCovers(scope: Scope, target: Target): boolean {
  switch (scope.type) {
    case "group":
      return true;
    case "entity":
      return target.entityId === scope.id;
    case "unit": {
      // Either side may carry the tree: the target's chain of ancestors, or the grant's subtree.
      const covered = unitsCovered(scope);
      return !!target.unitPath?.some((unitId) => covered.includes(unitId));
    }
  }
}

function grantsCovering(principal: Principal, target: Target | undefined): Grant[] {
  return principal.grants.filter((grant) => (target ? scopeCovers(grant.scope, target) : true));
}

/**
 * Does the principal hold `permission` over `target`?
 * Without a target the question is "anywhere at all" — used to show or hide navigation,
 * never to guard data.
 */
export function can(principal: Principal, permission: Exclude<Permission, "*">, target?: Target): boolean {
  return grantsCovering(principal, target).some((grant) => {
    const permissions = ROLE_DEFINITIONS[grant.role].permissions;
    return permissions.includes("*") || permissions.includes(permission);
  });
}

/**
 * The list form of `can`, for records that only know their entity (the audit log): which entities
 * does the principal hold `permission` over? A unit grant covers no whole entity.
 */
export function entityReach(principal: Principal, permission: Exclude<Permission, "*">): { all: true } | { all: false; entityIds: string[] } {
  const entityIds: string[] = [];
  for (const grant of principal.grants) {
    const permissions = ROLE_DEFINITIONS[grant.role].permissions;
    if (!permissions.includes("*") && !permissions.includes(permission)) continue;
    if (grant.scope.type === "group") return { all: true };
    if (grant.scope.type === "entity") entityIds.push(grant.scope.id);
  }
  return { all: false, entityIds };
}

/**
 * Highest sensitivity tier of a person's data the principal may read.
 * - yourself: everything, including your own compensation
 * - your direct reports: personal data, never compensation (FR-ACL, SRS §2.2)
 * - role grants whose scope covers the person: the role's maxTier
 * - everyone else: the internal directory tier — except collaborators, who get no directory access
 */
export function readableTier(principal: Principal, person: Target & { personId: string }): Tier | null {
  if (principal.personId && principal.personId === person.personId) return "compensation";

  let best: Tier | null = principal.workforceType === "collaborator" ? null : "public_internal";
  const consider = (tier: Tier) => {
    if (best === null || tierRank(tier) > tierRank(best)) best = tier;
  };

  if (principal.personId && person.managerId === principal.personId) consider("personal");
  for (const grant of grantsCovering(principal, person)) {
    const definition = ROLE_DEFINITIONS[grant.role];
    if (definition.permissions.includes("*") || definition.permissions.includes("person:read")) {
      consider(definition.maxTier);
    }
  }
  return best;
}

export function canReadTier(principal: Principal, person: Target & { personId: string }, tier: Tier): boolean {
  const readable = readableTier(principal, person);
  return readable !== null && tierRank(readable) >= tierRank(tier);
}

// The set form of `readableTier`, for list queries: which people can the principal read at `tier`
// or above, other than themselves? Services turn this into a WHERE clause; `matchesReach` is the
// reference semantics and a test keeps both in step with `canReadTier`.
export type TierReach =
  | { all: true }
  | { all: false; entityIds: string[]; unitIds: string[]; managerOf: string | null };

export function tierReach(principal: Principal, tier: Tier): TierReach {
  if (tier === "public_internal" && principal.workforceType !== "collaborator") return { all: true };

  const reach = { all: false as const, entityIds: [] as string[], unitIds: [] as string[], managerOf: null as string | null };
  if (tierRank(tier) <= tierRank("personal")) reach.managerOf = principal.personId;

  for (const grant of principal.grants) {
    const definition = ROLE_DEFINITIONS[grant.role];
    const readsPeople = definition.permissions.includes("*") || definition.permissions.includes("person:read");
    if (!readsPeople || tierRank(definition.maxTier) < tierRank(tier)) continue;
    if (grant.scope.type === "group") return { all: true };
    if (grant.scope.type === "entity") reach.entityIds.push(grant.scope.id);
    if (grant.scope.type === "unit") reach.unitIds.push(...unitsCovered(grant.scope));
  }
  return reach;
}

/**
 * The list form of `can`, for reports and other queries over many people: where does the principal
 * hold `permission`? Same shape as a tier reach (and matched by `matchesReach`), minus the
 * line-manager clause: a permission comes from grants only. A test keeps it in step with `can`.
 */
export function permissionReach(principal: Principal, permission: Exclude<Permission, "*">): TierReach {
  const reach = { all: false as const, entityIds: [] as string[], unitIds: [] as string[], managerOf: null };
  for (const grant of principal.grants) {
    const permissions = ROLE_DEFINITIONS[grant.role].permissions;
    if (!permissions.includes("*") && !permissions.includes(permission)) continue;
    if (grant.scope.type === "group") return { all: true };
    if (grant.scope.type === "entity") reach.entityIds.push(grant.scope.id);
    if (grant.scope.type === "unit") reach.unitIds.push(...unitsCovered(grant.scope));
  }
  return reach;
}

export const reachesNothing = (reach: TierReach): boolean => !reach.all && reach.entityIds.length + reach.unitIds.length === 0 && !reach.managerOf;

export function matchesReach(reach: TierReach, person: Target): boolean {
  if (reach.all) return true;
  return (
    (!!person.entityId && reach.entityIds.includes(person.entityId)) ||
    !!person.unitPath?.some((unitId) => reach.unitIds.includes(unitId)) ||
    (!!reach.managerOf && person.managerId === reach.managerOf)
  );
}
