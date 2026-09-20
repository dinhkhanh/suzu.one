// Who may see and do what with goals (and, from week 2, KPI scores). Pure.
//
// Group, entity, department and team goals are `public_internal`: everyone on the staff sees
// them — alignment is the point of OKRs. Collaborators do not (they get no directory either).
// An individual's goals and scores are **personal tier**: the person, every manager above them in
// the reporting line (direct or skip-level, FR-PRF-08), holders of `performance:read` or
// `performance:manage` whose grant covers the person — and never colleagues.
import { can, entityReach, matchesReach, permissionReach, type Principal, type Target } from "../platform/rbac/policy";
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

// ── KPIs (week 2) ───────────────────────────────────────────────────────────────────────────
// Targets, actuals and scores are personal tier, read like individual goals
// (`canReadPerformanceOf`). What differs is who writes: the figures decide a bonus (SRS D13).

/** The library and the group-wide position templates are shared by every entity: a group-wide grant only. */
export const canManageKpiLibrary = (principal: Principal): boolean => can(principal, "performance:manage", {});

/** A position's template: the group's set (entity null) or one entity's own. */
export const canManagePositionKpis = (principal: Principal, entityId: string | null): boolean => can(principal, "performance:manage", entityId ? { entityId } : {});

/** Which KPIs someone is measured on, with what weight and target: HR over that person — and, like the actuals, never one's own. */
export const canManageAssignmentsOf = (principal: Principal, person: PersonContext): boolean => !isSelf(principal, person) && canManagePerformanceOf(principal, person);

/**
 * Entering an actual: a manager above the person, or HR over them — and never the person
 * themself, whatever they hold (HR, a department head, even the owner's "*"): nobody marks their
 * own work. Someone without a manager gets their figures from HR.
 */
export const canEnterActualsFor = (principal: Principal, person: PersonContext): boolean => !isSelf(principal, person) && (isAbove(principal, person) || canManagePerformanceOf(principal, person));

/** Closing a month stores the scores of one entity. */
export const canCloseKpiMonth = (principal: Principal, entityId: string): boolean => can(principal, "performance:manage", { entityId });

/** Taking stored scores back: group-wide HR only, with a reason. */
export const canReopenKpiMonth = (principal: Principal): boolean => can(principal, "performance:manage", {});

/** HR's KPI administration — navigation only; each screen re-checks. */
export const canOpenKpiAdmin = (principal: Principal): boolean => can(principal, "performance:manage");

/** The owner dashboard: whole entities (or the group), not a department or a reporting line. */
export function overviewReach(principal: Principal): { all: true } | { all: false; entityIds: string[] } {
  const read = entityReach(principal, "performance:read");
  const manage = entityReach(principal, "performance:manage");
  if (read.all || manage.all) return { all: true };
  return { all: false, entityIds: [...new Set([...read.entityIds, ...manage.entityIds])] };
}
export const canOpenOverview = (principal: Principal): boolean => {
  const reach = overviewReach(principal);
  return reach.all || reach.entityIds.length > 0;
};

// ── The final yearly result (FR-PRF-09, Phase 8 week 2) ─────────────────────────────────────
// A result is a score, a band and a multiplier — **personal tier, like every other figure in this
// module**. It is not compensation: what the multiplier is worth in VND is decided in payroll and
// never leaves it, which is why a line manager may read the band of somebody in their line and
// still see nothing of the money. A test holds that line.

/**
 * Reading one person's result. Before it is published only the people who may already read their
 * performance data see it — their line, HR, the owner. Publishing adds the person themself, which
 * `canReadPerformanceOf` grants anyway; the `published` flag is what a screen shows them.
 */
export const canReadResultOf = (principal: Principal, person: PersonContext): boolean => canReadPerformanceOf(principal, person);

/** Computing and recomputing a year for the people in scope: HR over them. */
export const canComputeResults = (principal: Principal, entityId: string | null): boolean => can(principal, "performance:manage", entityId ? { entityId } : {});

/** Locking and publishing a settled result: HR over the person. */
export const canSettleResultOf = (principal: Principal, person: PersonContext): boolean => canManagePerformanceOf(principal, person);

/**
 * Overriding a result, and deciding the weighting version it is combined by: the owner's alone
 * (SRS D13 — "the owner can override it with a recorded reason"). HR proposes; nobody else decides.
 */
export const canDecidePerformanceRules = (principal: Principal): boolean => can(principal, "performance:decide", {});
export const canOverrideResult = canDecidePerformanceRules;

/** Proposing a weighting version: group-wide HR, like the KPI library. */
export const canProposeWeighting = (principal: Principal): boolean => can(principal, "performance:manage", {});

/** Is there a results screen for this viewer at all? Navigation only — the page checks again. */
export const canOpenResults = (principal: Principal): boolean => !!principal.personId;

// ── 1:1 notes and review outcomes (FR-PRF-04, 06 — Phase 8 week 3) ──────────────────────────

type MeetingParties = { managerPersonId: string; person: PersonContext };

/**
 * Who may **open** a 1:1 about somebody: a manager above them in the reporting line, or HR over
 * them. Not a colleague — found over HTTP in week 3: checking only "am I the manager named on the
 * row?" let anybody name themselves the manager of anyone and start a record about them.
 */
export const canHoldOneOnOneWith = (principal: Principal, person: PersonContext): boolean => isAbove(principal, person) || canManagePerformanceOf(principal, person);

/**
 * Who may write an existing meeting: the manager whose meeting it is (they keep it even if the
 * reporting line moves under them afterwards), or HR over the person. The subject never writes it.
 */
export const canWriteOneOnOne = (principal: Principal, meeting: MeetingParties): boolean => (!!principal.personId && principal.personId === meeting.managerPersonId && !isSelf(principal, meeting.person)) || canManagePerformanceOf(principal, meeting.person);

/**
 * Reading the shared half: the two people in the meeting, anyone above the subject in the
 * reporting line, and HR. A colleague never.
 */
export const canReadOneOnOne = (principal: Principal, meeting: MeetingParties): boolean => canWriteOneOnOne(principal, meeting) || canReadPerformanceOf(principal, meeting.person);

/**
 * The manager's private notes. **Not the subject, ever** — that is the whole point of the column —
 * and not HR either: it is one manager's thinking, not a record about the person.
 */
export const canReadOneOnOnePrivate = (principal: Principal, meeting: MeetingParties): boolean => !!principal.personId && principal.personId === meeting.managerPersonId;

/** Raising a promotion, a development plan or a PIP off a settled result: the chain above, or HR. */
export const canRaiseOutcome = (principal: Principal, person: PersonContext): boolean => isAbove(principal, person) || canManagePerformanceOf(principal, person);

/** Accepting or rejecting one is HR's — they are the desk that acts on it. */
export const canDecideOutcome = (principal: Principal, person: PersonContext): boolean => canManagePerformanceOf(principal, person);

/** The person sees what was decided about them, once it has been decided. */
export const canSeeOutcome = (principal: Principal, person: PersonContext): boolean => canReadPerformanceOf(principal, person);
