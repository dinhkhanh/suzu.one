// Who may see and do what with goals (and, from week 2, KPI scores). Pure.
//
// Group, entity, department and team goals are `public_internal`: everyone on the staff sees
// them — alignment is the point of OKRs. Collaborators do not (they get no directory either).
// An individual's goals and scores are **personal tier**: the person, every manager above them in
// the reporting line (direct or skip-level, FR-PRF-08), holders of `performance:read` or
// `performance:manage` whose grant covers the person — and never colleagues.
import { can, matchesReach, permissionReach, type Principal, type Target } from "../platform/rbac/policy";
import type { GoalLevel } from "./enums";

/** A person as the policy needs them: where they sit and who is above them, nearest manager first. */
export type PersonContext = Target & { personId: string; chainAbove: readonly string[] };

export type GoalParties = {
  level: GoalLevel;
  entityId: string | null;
  departmentId: string | null;
  teamId: string | null;
  ownerPersonId: string | null;
  /** The person an individual goal belongs to; null for unit goals. */
  person: PersonContext | null;
};

/** Everyone above `personId` in the reporting line, nearest first. Safe against loops in the data. */
export function chainAbove(managerOf: ReadonlyMap<string, string | null>, personId: string): string[] {
  const chain: string[] = [];
  const seen = new Set([personId]);
  for (let cursor = managerOf.get(personId) ?? null; cursor && !seen.has(cursor); cursor = managerOf.get(cursor) ?? null) {
    chain.push(cursor);
    seen.add(cursor);
  }
  return chain;
}

/** Where a unit goal sits, as an RBAC target. The group's goals take a group-wide grant (`{}`). */
export function unitTarget(goal: Pick<GoalParties, "level" | "entityId" | "departmentId" | "teamId">): Target {
  switch (goal.level) {
    case "entity":
      return { entityId: goal.entityId };
    case "department":
      return { departmentId: goal.departmentId, entityId: goal.entityId };
    case "team":
      return { teamId: goal.teamId, departmentId: goal.departmentId, entityId: goal.entityId };
    default:
      return {};
  }
}

const isSelf = (principal: Principal, person: PersonContext) => !!principal.personId && principal.personId === person.personId;
const isAbove = (principal: Principal, person: PersonContext) => !!principal.personId && person.chainAbove.includes(principal.personId);

/** HR for this person. */
export const canManagePerformanceOf = (principal: Principal, person: PersonContext): boolean => can(principal, "performance:manage", person);

/** Personal-tier performance data of one person: their goals, check-ins and KPI scores. */
export const canReadPerformanceOf = (principal: Principal, person: PersonContext): boolean => isSelf(principal, person) || isAbove(principal, person) || can(principal, "performance:read", person) || canManagePerformanceOf(principal, person);

export function canSeeGoal(principal: Principal, goal: GoalParties): boolean {
  if (goal.level === "individual") return !!goal.person && canReadPerformanceOf(principal, goal.person);
  return principal.workforceType !== "collaborator" || (!!principal.personId && goal.ownerPersonId === principal.personId);
}

/** Create, edit, add key results, re-parent, activate, cancel. */
export function canEditGoal(principal: Principal, goal: GoalParties): boolean {
  if (goal.level === "individual") return !!goal.person && (isSelf(principal, goal.person) || isAbove(principal, goal.person) || canManagePerformanceOf(principal, goal.person));
  const target = unitTarget(goal);
  return can(principal, "performance:goals", target) || can(principal, "performance:manage", target);
}

/** The weekly check-in: whoever is accountable for the goal, or whoever may edit it. */
export const canCheckIn = (principal: Principal, goal: GoalParties): boolean => (!!principal.personId && goal.ownerPersonId === principal.personId) || canEditGoal(principal, goal);

/**
 * Closing freezes the figure the bonus is later computed from, so nobody closes their own
 * individual goal: a manager above them or HR does. Unit goals: whoever may edit them.
 */
export function canCloseGoal(principal: Principal, goal: GoalParties): boolean {
  if (goal.level === "individual") return !!goal.person && (isAbove(principal, goal.person) || canManagePerformanceOf(principal, goal.person));
  return canEditGoal(principal, goal);
}

/** Taking a frozen figure back is HR's alone, and audited. */
export const canReopenGoal = (principal: Principal, goal: GoalParties): boolean => can(principal, "performance:manage", goal.level === "individual" ? (goal.person ?? {}) : unitTarget(goal));

/** The list form of `canReadPerformanceOf`: whose individual goals and scores the principal reads. */
export function readablePeople(principal: Principal, people: Iterable<PersonContext>): Set<string> {
  const reaches = [permissionReach(principal, "performance:read"), permissionReach(principal, "performance:manage")];
  const readable = new Set<string>();
  for (const person of people) {
    if (isSelf(principal, person) || isAbove(principal, person) || reaches.some((reach) => matchesReach(reach, person))) readable.add(person.personId);
  }
  return readable;
}

/** The units the principal may set goals for — what the "new goal" form offers. Navigation only; the action re-checks. */
export const canSetUnitGoals = (principal: Principal): boolean => can(principal, "performance:goals") || can(principal, "performance:manage");
