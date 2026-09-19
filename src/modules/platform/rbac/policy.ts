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
