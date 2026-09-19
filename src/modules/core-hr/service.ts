import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { toSearchKey } from "@/lib/text";
import { featureEnabled } from "@/modules/platform/flags/service";
import { notify, queueEmail } from "@/modules/platform/notifications/service";
import { listBranches, listDepartments, listTeams } from "@/modules/platform/org/service";
import { activatePerson, createPerson, listPersonNames, type PersonRow, setPersonPlacement, updatePersonIdentity, wouldCreateReportingLoop } from "@/modules/platform/people/service";
import { can, matchesReach, type Principal, readableTier, type Target, tierReach, type TierReach } from "@/modules/platform/rbac/policy";
import { type Tier, tierRank } from "@/modules/platform/rbac/roles";
import { periodOn, planAssignmentChange } from "./engine/assignment-plan";
import { defaultCodeScheme, formatEmployeeCode, normalizeEmployeeCode } from "./engine/employee-code";

export type WorkforceType = PersonRow["workforceType"];
export type PersonStatus = PersonRow["status"];
type ProfileRow = typeof schema.personProfile.$inferSelect;

const PAGE_SIZE = 50;

/**
 * Is the People module switched on for this person? People who manage HR data or the system itself
 * always see it, so they can load and check the data before the pilot starts. Visibility only:
 * what anyone may read or change inside is still decided by RBAC.
 */
export async function peopleModuleOpen(user: { person: PersonRow; principal: Principal }): Promise<boolean> {
  if (can(user.principal, "person:manage") || can(user.principal, "org:manage")) return true;
  return featureEnabled("people", user.person);
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

// A person's latest employment and the primary assignment in force today. People who have not
// started yet get their first assignment; people who have left keep their last one.
function placementOn(today: IsoDate) {
  const e = db()
    .select()
    .from(schema.employment)
    .where(eq(schema.employment.personId, schema.person.id))
    .orderBy(desc(schema.employment.startDate))
    .limit(1)
    .as("e");
  const a = db()
    .select()
    .from(schema.assignment)
    .where(
      and(
        eq(schema.assignment.employmentId, e.id),
        eq(schema.assignment.kind, "primary"),
        sql`${schema.assignment.validFrom} <= greatest(${today}::date, ${e.startDate})`,
      ),
    )
    .orderBy(desc(schema.assignment.validFrom))
    .limit(1)
    .as("a");
  return { e, a };
}

type Placement = ReturnType<typeof placementOn>;

function reachCondition(reach: TierReach, { e, a }: Placement, selfId: string | null): SQL | undefined {
  if (reach.all) return undefined;
  const clauses: (SQL | undefined)[] = [
    selfId ? eq(schema.person.id, selfId) : undefined,
    reach.entityIds.length ? inArray(e.entityId, reach.entityIds) : undefined,
    reach.departmentIds.length ? inArray(a.departmentId, reach.departmentIds) : undefined,
    reach.teamIds.length ? inArray(a.teamId, reach.teamIds) : undefined,
    reach.managerOf ? eq(a.managerId, reach.managerOf) : undefined,
  ];
  return or(...clauses) ?? sql`false`;
}

export type PeopleFilters = {
  q?: string;
  entityId?: string;
  departmentId?: string;
  workforceType?: WorkforceType;
  // Defaults to "active". Anything else is personal-tier information.
  status?: PersonStatus | "all";
  page?: number;
};

export type PeopleListRow = {
  id: string;
  fullName: string;
  workEmail: string | null;
  employeeCode: string | null;
  entityName: string | null;
  departmentName: string | null;
  positionName: string | null;
  managerName: string | null;
  // null when the viewer may only see this person's directory entry.
  workforceType: WorkforceType | null;
  status: PersonStatus | null;
};

export async function listPeople(principal: Principal, filters: PeopleFilters): Promise<{ rows: PeopleListRow[]; total: number; pageSize: number }> {
  const placement = placementOn(todayInVietnam());
  const { e, a } = placement;
  const manager = alias(schema.person, "manager");
  const personalReach = tierReach(principal, "personal");
  const status = filters.status ?? "active";
  const needsPersonalTier = filters.workforceType !== undefined || status !== "active";
  const q = filters.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;

  const where = and(
    reachCondition(tierReach(principal, "public_internal"), placement, principal.personId),
    needsPersonalTier ? reachCondition(personalReach, placement, principal.personId) : undefined,
    status === "all" ? undefined : eq(schema.person.status, status),
    filters.workforceType ? eq(a.workforceType, filters.workforceType) : undefined,
    filters.entityId ? eq(e.entityId, filters.entityId) : undefined,
    filters.departmentId ? eq(a.departmentId, filters.departmentId) : undefined,
    pattern
      ? or(ilike(schema.person.searchName, `%${toSearchKey(q!).replace(/[\\%_]/g, "\\$&")}%`), ilike(schema.person.workEmail, pattern), ilike(e.employeeCode, pattern))
      : undefined,
  );

  const page = Math.max(1, filters.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        id: schema.person.id,
        fullName: schema.person.fullName,
        workEmail: schema.person.workEmail,
        status: schema.person.status,
        employeeCode: e.employeeCode,
        entityId: e.entityId,
        entityName: schema.entity.shortName,
        departmentId: a.departmentId,
        departmentName: schema.department.name,
        teamId: a.teamId,
        positionName: schema.position.name,
        managerId: a.managerId,
        managerName: manager.fullName,
        workforceType: a.workforceType,
      })
      .from(schema.person)
      .leftJoinLateral(e, sql`true`)
      .leftJoinLateral(a, sql`true`)
      .leftJoin(schema.entity, eq(schema.entity.id, e.entityId))
      .leftJoin(schema.department, eq(schema.department.id, a.departmentId))
      .leftJoin(schema.position, eq(schema.position.id, a.positionId))
      .leftJoin(manager, eq(manager.id, a.managerId))
      .where(where)
      // Vietnamese convention: sort by given name, the last word (DR-08).
      .orderBy(sql`substring(${schema.person.searchName} from '[^ ]+$')`, asc(schema.person.searchName))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().select({ total: count() }).from(schema.person).leftJoinLateral(e, sql`true`).leftJoinLateral(a, sql`true`).where(where),
  ]);

  return {
    total,
    pageSize: PAGE_SIZE,
    rows: rows.map((row) => {
      const personal = row.id === principal.personId || matchesReach(personalReach, row);
      return {
        id: row.id,
        fullName: row.fullName,
        workEmail: row.workEmail,
        employeeCode: row.employeeCode,
        entityName: row.entityName,
        departmentName: row.departmentName,
        positionName: row.positionName,
        managerName: row.managerName,
        workforceType: personal ? row.workforceType : null,
        status: personal ? row.status : null,
      };
    }),
  };
}

export type OrgChartPerson = { id: string; fullName: string; sortKey: string; managerId: string | null; positionName: string | null; departmentName: string | null; entityName: string | null; dottedManagerName: string | null };

/**
 * Active people with their reporting line today — directory-tier fields only, so the same chart is
 * safe for every employee. With an entity, managers employed elsewhere fall outside the selection
 * and their reports head their own branches (engine/org-tree.ts).
 */
export async function listOrgChartPeople(principal: Principal, entityId?: string): Promise<OrgChartPerson[]> {
  const placement = placementOn(todayInVietnam());
  const { e, a } = placement;
  const dottedManager = alias(schema.person, "dotted_manager");
  return db()
    .select({
      id: schema.person.id,
      fullName: schema.person.fullName,
      // Given name first, as in the people list (DR-08).
      sortKey: sql<string>`substring(${schema.person.searchName} from '[^ ]+$') || ' ' || ${schema.person.searchName}`,
      managerId: a.managerId,
      positionName: schema.position.name,
      departmentName: schema.department.name,
      entityName: schema.entity.shortName,
      dottedManagerName: dottedManager.fullName,
    })
    .from(schema.person)
    .leftJoinLateral(e, sql`true`)
    .leftJoinLateral(a, sql`true`)
    .leftJoin(schema.entity, eq(schema.entity.id, e.entityId))
    .leftJoin(schema.department, eq(schema.department.id, a.departmentId))
    .leftJoin(schema.position, eq(schema.position.id, a.positionId))
    .leftJoin(dottedManager, eq(dottedManager.id, a.dottedManagerId))
    .where(and(reachCondition(tierReach(principal, "public_internal"), placement, principal.personId), eq(schema.person.status, "active"), entityId ? eq(e.entityId, entityId) : undefined));
}

/** Where a person sits today, as an authorization target. */
export async function getPersonTarget(personId: string, executor: Tx | ReturnType<typeof db> = db()): Promise<(Target & { personId: string }) | null> {
  const { e, a } = placementOn(todayInVietnam());
  const [row] = await executor
    .select({ personId: schema.person.id, entityId: e.entityId, departmentId: a.departmentId, teamId: a.teamId, managerId: a.managerId })
    .from(schema.person)
    .leftJoinLateral(e, sql`true`)
    .leftJoinLateral(a, sql`true`)
    .where(eq(schema.person.id, personId))
    .limit(1);
  return row ?? null;
}

export type AssignmentView = {
  id: string;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  workforceType: WorkforceType;
  branchId: string | null;
  branchName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  positionName: string | null;
  jobLevel: string | null;
  managerId: string | null;
  managerName: string | null;
  dottedManagerId: string | null;
  dottedManagerName: string | null;
  workLocation: string | null;
  changeReason: string | null;
};

export type PersonView = {
  tier: Tier;
  canManage: boolean;
  id: string;
  fullName: string;
  workEmail: string | null;
  employeeCode: string | null;
  entityId: string | null;
  entityName: string | null;
  // The assignment in force today; only its directory fields are filled below the personal tier.
  current: Pick<AssignmentView, "departmentName" | "teamName" | "positionName" | "managerId" | "managerName"> | null;
  personal: {
    status: PersonStatus;
    startDate: IsoDate | null;
    seniorityDate: IsoDate | null;
    endDate: IsoDate | null;
    profile: Omit<ProfileRow, "personId" | "createdAt" | "updatedAt"> | null;
    current: AssignmentView | null;
    history: AssignmentView[];
  } | null;
};

/** One person, shaped by what the viewer's tier allows. null = the viewer may not see them at all. */
export async function getPersonView(principal: Principal, personId: string): Promise<PersonView | null> {
  const target = await getPersonTarget(personId);
  if (!target) return null;
  const tier = readableTier(principal, target);
  if (!tier) return null;

  const [person] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  const [employment] = await db()
    .select({ row: schema.employment, entityName: schema.entity.shortName })
    .from(schema.employment)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.employment.entityId))
    .where(eq(schema.employment.personId, personId))
    .orderBy(desc(schema.employment.startDate))
    .limit(1);

  const history = employment ? await loadAssignments(employment.row.id) : [];
  // Same rule as placementOn(): history is newest first, so this is the latest row already in force.
  const today = todayInVietnam();
  const asOf = employment && employment.row.startDate > today ? employment.row.startDate : today;
  const current = history.find((row) => row.validFrom <= asOf) ?? null;

  const seesPersonal = tierRank(tier) >= tierRank("personal");
  // Former and future colleagues are not part of the directory.
  if (!seesPersonal && person.status !== "active") return null;

  let personal: PersonView["personal"] = null;
  if (seesPersonal) {
    const [profile] = await db().select(PROFILE_FIELDS).from(schema.personProfile).where(eq(schema.personProfile.personId, personId)).limit(1);
    personal = {
      status: person.status,
      startDate: employment?.row.startDate ?? null,
      seniorityDate: employment?.row.seniorityDate ?? null,
      endDate: employment?.row.endDate ?? null,
      profile: profile ?? null,
      current,
      history,
    };
  }

  return {
    tier,
    canManage: can(principal, "person:manage", target),
    id: person.id,
    fullName: person.fullName,
    workEmail: person.workEmail,
    employeeCode: employment?.row.employeeCode ?? null,
    entityId: employment?.row.entityId ?? null,
    entityName: employment?.entityName ?? null,
    current: current && {
      departmentName: current.departmentName,
      teamName: current.teamName,
      positionName: current.positionName,
      managerId: current.managerId,
      managerName: current.managerName,
    },
    personal,
  };
}

const PROFILE_FIELDS = {
  dateOfBirth: schema.personProfile.dateOfBirth,
  gender: schema.personProfile.gender,
  maritalStatus: schema.personProfile.maritalStatus,
  nationality: schema.personProfile.nationality,
  phone: schema.personProfile.phone,
  personalEmail: schema.personProfile.personalEmail,
  permanentAddress: schema.personProfile.permanentAddress,
  currentAddress: schema.personProfile.currentAddress,
};

// Newest first.
async function loadAssignments(employmentId: string): Promise<AssignmentView[]> {
  const manager = alias(schema.person, "manager");
  const dottedManager = alias(schema.person, "dotted_manager");
  return db()
    .select({
      id: schema.assignment.id,
      validFrom: schema.assignment.validFrom,
      validTo: schema.assignment.validTo,
      workforceType: schema.assignment.workforceType,
      branchId: schema.assignment.branchId,
      branchName: schema.branch.name,
      departmentId: schema.assignment.departmentId,
      departmentName: schema.department.name,
      teamId: schema.assignment.teamId,
      teamName: schema.team.name,
      positionName: schema.position.name,
      jobLevel: schema.assignment.jobLevel,
      managerId: schema.assignment.managerId,
      managerName: manager.fullName,
      dottedManagerId: schema.assignment.dottedManagerId,
      dottedManagerName: dottedManager.fullName,
      workLocation: schema.assignment.workLocation,
      changeReason: schema.assignment.changeReason,
    })
    .from(schema.assignment)
    .leftJoin(schema.branch, eq(schema.branch.id, schema.assignment.branchId))
    .leftJoin(schema.department, eq(schema.department.id, schema.assignment.departmentId))
    .leftJoin(schema.team, eq(schema.team.id, schema.assignment.teamId))
    .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .leftJoin(manager, eq(manager.id, schema.assignment.managerId))
    .leftJoin(dottedManager, eq(dottedManager.id, schema.assignment.dottedManagerId))
    .where(and(eq(schema.assignment.employmentId, employmentId), eq(schema.assignment.kind, "primary")))
    .orderBy(desc(schema.assignment.validFrom));
}

export async function listPositionNames(): Promise<string[]> {
  const rows = await db().select({ name: schema.position.name }).from(schema.position).orderBy(asc(schema.position.searchName));
  return rows.map((row) => row.name);
}

/** Choices for the placement fields. Names only: nothing here is above the directory tier. */
export async function loadPlacementOptions(entityId?: string) {
  const [departments, teams, branches, positions, people] = await Promise.all([listDepartments(), listTeams(), listBranches(), listPositionNames(), listPersonNames()]);
  return {
    departments: departments.filter((row) => row.isActive && (row.entityId === null || !entityId || row.entityId === entityId)).map(({ id, name }) => ({ id, name })),
    teams: teams.filter((row) => row.isActive).map(({ id, name, departmentId }) => ({ id, name, departmentId })),
    branches: branches.filter((row) => row.isActive && (!entityId || row.entityId === entityId)).map(({ id, name, entityId }) => ({ id, name, entityId })),
    positions,
    people,
  };
}

// Two people saving at once can both pass the friendly checks below; the database constraints
// have the last word, and their violations should read the same as the checks do.
const CONSTRAINT_ERRORS: Record<string, string> = {
  person_work_email_unique: "work_email_taken",
  employment_entity_code_key: "employee_code_taken",
  employment_no_overlap: "employment_overlap",
  assignment_primary_no_overlap: "assignment_conflict",
  contract_entity_number_key: "contract_number_taken",
};

export async function inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db().transaction(work);
  } catch (error) {
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      const details = cause as { constraint_name?: string; constraint?: string };
      const known = CONSTRAINT_ERRORS[details.constraint_name ?? details.constraint ?? ""];
      if (known) throw new ActionError(known);
    }
    throw error;
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────────────────────

export type ProfileInput = Omit<ProfileRow, "personId" | "createdAt" | "updatedAt">;

export type PlacementInput = {
  workforceType: WorkforceType;
  branchId: string | null;
  departmentId: string | null;
  teamId: string | null;
  positionName: string | null;
  jobLevel: string | null;
  managerId: string | null;
  dottedManagerId: string | null;
  workLocation: string | null;
};

export type HireInput = {
  fullName: string;
  workEmail: string | null;
  profile: ProfileInput;
  entityId: string;
  // Blank = take the next number from the entity's scheme.
  employeeCode: string | null;
  startDate: IsoDate;
  seniorityDate: IsoDate | null;
  placement: PlacementInput;
};

export async function hirePerson(input: HireInput, actorPersonId: string) {
  return inTransaction((tx) => hireInTransaction(tx, input, actorPersonId));
}

/** The one code path that puts a person on the books — the hire form and the bulk import both end here. */
export async function hireInTransaction(tx: Tx, input: HireInput, actorPersonId: string) {
  const [entity] = await tx.select().from(schema.entity).where(eq(schema.entity.id, input.entityId)).limit(1);
  if (!entity?.isActive) throw new ActionError("entity_not_found");
  const values = await resolvePlacement(tx, input.placement, { entityId: entity.id, personId: null });

  const person = await createPerson(tx, {
    fullName: input.fullName,
    workEmail: input.workEmail,
    status: input.startDate > todayInVietnam() ? "preboarding" : "active",
  });
  await tx.insert(schema.personProfile).values({ personId: person.id, ...input.profile });

  const employeeCode = input.employeeCode ? normalizeEmployeeCode(input.employeeCode) : await allocateEmployeeCode(tx, entity);
  if (await employeeCodeExists(tx, entity.id, employeeCode)) throw new ActionError("employee_code_taken");
  const [employment] = await tx
    .insert(schema.employment)
    .values({ personId: person.id, entityId: entity.id, employeeCode, startDate: input.startDate, seniorityDate: input.seniorityDate ?? input.startDate })
    .returning();
  const [assignment] = await tx
    .insert(schema.assignment)
    .values({ ...values, employmentId: employment.id, validFrom: input.startDate, createdByPersonId: actorPersonId })
    .returning();

  await setPersonPlacement(tx, person.id, {
    workforceType: values.workforceType,
    primaryEntityId: entity.id,
    departmentId: values.departmentId,
    teamId: values.teamId,
    managerId: values.managerId,
  });
  return { person, employment, assignment };
}

export async function updatePersonBasics(personId: string, input: { fullName: string; workEmail: string | null; profile: ProfileInput }) {
  return inTransaction(async (tx) => {
    const [before] = await tx.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
    if (!before) throw new ActionError("person_not_found");
    const [profileBefore] = await tx.select().from(schema.personProfile).where(eq(schema.personProfile.personId, personId)).limit(1);

    const person = await updatePersonIdentity(tx, personId, input);
    if (before.workEmail && before.workEmail !== person.workEmail) {
      // Whoever holds the new address now sees this person's self-service pages, so the old
      // address is told too: that is where the real owner would still be reading.
      const params = { oldEmail: before.workEmail, newEmail: person.workEmail ?? "—" };
      await queueEmail(before.workEmail, "security.work_email_changed", params, tx);
      await notify({ recipients: [personId], kind: "security.work_email_changed", params, link: `/people/${personId}` }, tx);
    }
    const [profile] = await tx
      .insert(schema.personProfile)
      .values({ personId, ...input.profile })
      .onConflictDoUpdate({ target: schema.personProfile.personId, set: { ...input.profile, updatedAt: new Date() } })
      .returning();
    return { before: { person: before, profile: profileBefore ?? null }, after: { person, profile } };
  });
}

export async function changeAssignment(personId: string, input: { validFrom: IsoDate; changeReason: string | null; placement: PlacementInput }, actorPersonId: string) {
  return inTransaction(async (tx) => {
    const [employment] = await tx
      .select()
      .from(schema.employment)
      .where(eq(schema.employment.personId, personId))
      .orderBy(desc(schema.employment.startDate))
      .limit(1)
      .for("update");
    if (!employment) throw new ActionError("no_employment");

    const existing = await tx
      .select()
      .from(schema.assignment)
      .where(and(eq(schema.assignment.employmentId, employment.id), eq(schema.assignment.kind, "primary")));
    const plan = planAssignmentChange(employment, existing, input.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`assignment_${plan.reason}`);

    const values = { ...(await resolvePlacement(tx, input.placement, { entityId: employment.entityId, personId })), changeReason: input.changeReason };
    let before: typeof schema.assignment.$inferSelect | null = null;
    let after: typeof schema.assignment.$inferSelect;
    if (plan.kind === "replace") {
      before = existing.find((row) => row.id === plan.id) ?? null;
      [after] = await tx.update(schema.assignment).set({ ...values, updatedAt: new Date() }).where(eq(schema.assignment.id, plan.id)).returning();
    } else {
      if (plan.kind === "succeed") {
        before = existing.find((row) => row.id === plan.closeId) ?? null;
        await tx.update(schema.assignment).set({ validTo: plan.closeOn, updatedAt: new Date() }).where(eq(schema.assignment.id, plan.closeId));
      }
      [after] = await tx
        .insert(schema.assignment)
        .values({ ...values, employmentId: employment.id, validFrom: input.validFrom, validTo: employment.endDate, createdByPersonId: actorPersonId })
        .returning();
    }

    // Mirror the assignment in force today onto the person; a future-dated change leaves it alone.
    const rows = await tx
      .select()
      .from(schema.assignment)
      .where(and(eq(schema.assignment.employmentId, employment.id), eq(schema.assignment.kind, "primary")));
    const today = todayInVietnam();
    const inForce = periodOn(rows, today > employment.startDate ? today : employment.startDate);
    if (inForce) {
      await setPersonPlacement(tx, personId, {
        workforceType: inForce.workforceType,
        primaryEntityId: employment.entityId,
        departmentId: inForce.departmentId,
        teamId: inForce.teamId,
        managerId: inForce.managerId,
      });
    }
    return { employment, before, after };
  });
}

/**
 * Brings `person` (what sign-in and RBAC read) up to date with the assignment in force on `today`:
 * future-dated changes that have now started, and new starters whose first day has come.
 */
export async function rollOverPlacements(today: IsoDate): Promise<{ placementsUpdated: number; peopleActivated: number }> {
  const { e, a } = placementOn(today);
  const stale = await db()
    .select({
      personId: schema.person.id,
      activate: sql<boolean>`${schema.person.status} = 'preboarding' and ${e.startDate} <= ${today}::date`,
      moved: sql<boolean>`(${schema.person.workforceType}, ${schema.person.primaryEntityId}, ${schema.person.departmentId}, ${schema.person.teamId}, ${schema.person.managerId}) is distinct from (${a.workforceType}, ${e.entityId}, ${a.departmentId}, ${a.teamId}, ${a.managerId})`,
      placement: { workforceType: a.workforceType, primaryEntityId: e.entityId, departmentId: a.departmentId, teamId: a.teamId, managerId: a.managerId },
    })
    .from(schema.person)
    .innerJoinLateral(e, sql`true`)
    .innerJoinLateral(a, sql`true`);

  let placementsUpdated = 0;
  let peopleActivated = 0;
  for (const row of stale) {
    if (!row.moved && !row.activate) continue;
    await db().transaction(async (tx) => {
      if (row.moved) await setPersonPlacement(tx, row.personId, row.placement);
      if (row.activate) await activatePerson(tx, row.personId);
    });
    if (row.moved) placementsUpdated++;
    if (row.activate) peopleActivated++;
  }
  return { placementsUpdated, peopleActivated };
}

// Checks that the pieces of a placement belong together and turns the position name into a row.
async function resolvePlacement(tx: Tx, input: PlacementInput, context: { entityId: string; personId: string | null }) {
  if (input.teamId) {
    const [team] = await tx.select().from(schema.team).where(eq(schema.team.id, input.teamId)).limit(1);
    if (!team || team.departmentId !== input.departmentId) throw new ActionError("team_not_in_department");
  }
  if (input.departmentId) {
    const [department] = await tx.select().from(schema.department).where(eq(schema.department.id, input.departmentId)).limit(1);
    if (!department || (department.entityId !== null && department.entityId !== context.entityId)) throw new ActionError("department_not_in_entity");
  }
  if (input.branchId) {
    const [branch] = await tx.select().from(schema.branch).where(eq(schema.branch.id, input.branchId)).limit(1);
    if (!branch || branch.entityId !== context.entityId) throw new ActionError("branch_not_in_entity");
  }
  for (const managerId of [input.managerId, input.dottedManagerId]) {
    if (!managerId) continue;
    if (managerId === context.personId) throw new ActionError("manager_is_self");
    const [manager] = await tx.select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.id, managerId)).limit(1);
    if (!manager) throw new ActionError("manager_not_found");
  }
  if (input.managerId && context.personId && (await wouldCreateReportingLoop(tx, context.personId, input.managerId))) {
    throw new ActionError("manager_loop");
  }

  const { positionName, ...rest } = input;
  return { ...rest, positionId: positionName ? await findOrCreatePosition(tx, positionName) : null };
}

async function findOrCreatePosition(tx: Tx, name: string): Promise<string> {
  const cleaned = name.trim().replace(/\s+/g, " ");
  const searchName = toSearchKey(cleaned);
  await tx.insert(schema.position).values({ name: cleaned, searchName }).onConflictDoNothing({ target: schema.position.searchName });
  const [row] = await tx.select({ id: schema.position.id }).from(schema.position).where(eq(schema.position.searchName, searchName)).limit(1);
  return row.id;
}

async function employeeCodeExists(tx: Tx, entityId: string, employeeCode: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.employment.id })
    .from(schema.employment)
    .where(and(eq(schema.employment.entityId, entityId), eq(schema.employment.employeeCode, employeeCode)))
    .limit(1);
  return !!row;
}

// The UPDATE takes a row lock, so two concurrent hires never get the same number. Numbers HR
// already used by hand are skipped.
async function allocateEmployeeCode(tx: Tx, entity: { id: string; code: string }): Promise<string> {
  await tx
    .insert(schema.employeeCodeScheme)
    .values({ entityId: entity.id, ...defaultCodeScheme(entity.code) })
    .onConflictDoNothing({ target: schema.employeeCodeScheme.entityId });
  for (let attempt = 0; attempt < 1000; attempt++) {
    const [scheme] = await tx
      .update(schema.employeeCodeScheme)
      .set({ nextNumber: sql`${schema.employeeCodeScheme.nextNumber} + 1`, updatedAt: new Date() })
      .where(eq(schema.employeeCodeScheme.entityId, entity.id))
      .returning();
    const employeeCode = formatEmployeeCode(scheme, scheme.nextNumber - 1);
    if (!(await employeeCodeExists(tx, entity.id, employeeCode))) return employeeCode;
  }
  throw new ActionError("employee_code_exhausted");
}

// ── Saved views ─────────────────────────────────────────────────────────────────────────────

export type SavedViewRow = typeof schema.savedView.$inferSelect;

export async function listSavedViews(ownerPersonId: string, list: string): Promise<SavedViewRow[]> {
  return db()
    .select()
    .from(schema.savedView)
    .where(and(eq(schema.savedView.ownerPersonId, ownerPersonId), eq(schema.savedView.list, list)))
    .orderBy(asc(schema.savedView.name));
}

export async function saveView(ownerPersonId: string, input: { list: string; name: string; filters: Record<string, string> }): Promise<SavedViewRow> {
  const [row] = await db()
    .insert(schema.savedView)
    .values({ ownerPersonId, ...input })
    .onConflictDoUpdate({ target: [schema.savedView.ownerPersonId, schema.savedView.list, schema.savedView.name], set: { filters: input.filters } })
    .returning();
  return row;
}

export async function deleteSavedView(ownerPersonId: string, id: string): Promise<SavedViewRow | null> {
  const [row] = await db()
    .delete(schema.savedView)
    .where(and(eq(schema.savedView.id, id), eq(schema.savedView.ownerPersonId, ownerPersonId)))
    .returning();
  return row ?? null;
}
