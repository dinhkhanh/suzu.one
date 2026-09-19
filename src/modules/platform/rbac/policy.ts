// Pure authorization rules: role × scope × sensitivity tier (SRS §2.2). No I/O.
import { ROLE_DEFINITIONS, type Permission, type Role, type Tier, tierRank } from "./roles";

export type Scope =
  | { type: "group" }
  | { type: "entity"; id: string }
  | { type: "department"; id: string }
  | { type: "team"; id: string };

export type Grant = { role: Role; scope: Scope };

export type Principal = {
  personId: string | null;
  workforceType: "employee" | "probation" | "intern" | "part_time" | "collaborator" | "advisor" | null;
  grants: readonly Grant[];
};

// Where the thing being accessed sits in the organisation. Omit fields that do not apply.
export type Target = {
  entityId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  // For person-shaped resources.
  personId?: string | null;
  managerId?: string | null;
};

function scopeCovers(scope: Scope, target: Target): boolean {
  switch (scope.type) {
    case "group":
      return true;
    case "entity":
      return target.entityId === scope.id;
    case "department":
      return target.departmentId === scope.id;
    case "team":
      return target.teamId === scope.id;
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
 * does the principal hold `permission` over? Department and team grants cover no whole entity.
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
  | { all: false; entityIds: string[]; departmentIds: string[]; teamIds: string[]; managerOf: string | null };

export function tierReach(principal: Principal, tier: Tier): TierReach {
  if (tier === "public_internal" && principal.workforceType !== "collaborator") return { all: true };

  const reach = { all: false as const, entityIds: [] as string[], departmentIds: [] as string[], teamIds: [] as string[], managerOf: null as string | null };
  if (tierRank(tier) <= tierRank("personal")) reach.managerOf = principal.personId;

  for (const grant of principal.grants) {
    const definition = ROLE_DEFINITIONS[grant.role];
    const readsPeople = definition.permissions.includes("*") || definition.permissions.includes("person:read");
    if (!readsPeople || tierRank(definition.maxTier) < tierRank(tier)) continue;
    if (grant.scope.type === "group") return { all: true };
    if (grant.scope.type === "entity") reach.entityIds.push(grant.scope.id);
    if (grant.scope.type === "department") reach.departmentIds.push(grant.scope.id);
    if (grant.scope.type === "team") reach.teamIds.push(grant.scope.id);
  }
  return reach;
}

export function matchesReach(reach: TierReach, person: Target): boolean {
  if (reach.all) return true;
  return (
    (!!person.entityId && reach.entityIds.includes(person.entityId)) ||
    (!!person.departmentId && reach.departmentIds.includes(person.departmentId)) ||
    (!!person.teamId && reach.teamIds.includes(person.teamId)) ||
    (!!reach.managerOf && person.managerId === reach.managerOf)
  );
}
