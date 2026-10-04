import "server-only";
import { and, arrayOverlaps, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { cached } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";

// Reads that also run inside someone else's transaction (approver resolution) take the executor.
type Executor = Tx | ReturnType<typeof db>;
import { notify } from "../notifications/service";
import { listOrgUnits } from "../org/service";
import { ALL_GRANTS_KEY, GRANTS_TTL, grantsKey, invalidateGrants } from "./grants-cache";
import { can, type Grant, type Scope, scopeCovers, type Target } from "./policy";
import { type Permission, ROLE_DEFINITIONS, ROLES, type Role } from "./roles";

export type RoleAssignmentRow = typeof schema.roleAssignment.$inferSelect;
export type ScopeType = RoleAssignmentRow["scopeType"];

const notEnded = (today: IsoDate) => or(isNull(schema.roleAssignment.validTo), gte(schema.roleAssignment.validTo, today));

/** Does this person hold any role grant, in force now or starting later? */
export async function holdsRoleGrants(personId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.roleAssignment.id })
    .from(schema.roleAssignment)
    .where(and(eq(schema.roleAssignment.personId, personId), notEnded(todayInVietnam())))
    .limit(1);
  return !!row;
}

// `covers` is only needed where a target names one unit without its chain; a target carrying the
// whole path (a person) matches a unit grant on any ancestor without it.
function toScope(scopeType: ScopeType, scopeId: string | null, covers: ReadonlyMap<string, string[]> = new Map()): Scope | null {
  if (scopeType === "group") return { type: "group" };
  if (!scopeId) return null;
  return scopeType === "unit" ? { type: "unit", id: scopeId, covers: covers.get(scopeId) } : { type: scopeType, id: scopeId };
}

// Every request loads the signed-in person's grants, so today's rows sit in the shared cache.
// Every write to `role_assignment` below drops the holder's entry (`invalidateGrants`, which lives
// with the keys in grants-cache.ts), and the short TTL bounds anything written behind the app's
// back (a seed, a manual fix).
export { invalidateGrants };

type RoleAssignmentRowCached = typeof schema.roleAssignment.$inferSelect;

async function grantRowsOf(personId: string, today: IsoDate, executor: Executor | undefined): Promise<RoleAssignmentRowCached[]> {
  const inForce = (row: RoleAssignmentRowCached) => row.validFrom <= today && (row.validTo === null || row.validTo >= today);
  if (executor || today !== todayInVietnam()) {
    return (executor ?? db()).select().from(schema.roleAssignment).where(and(eq(schema.roleAssignment.personId, personId), lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  }
  // Cached: every grant not yet ended, so one that starts later today is still in the entry.
  const rows = await cached(grantsKey(personId), GRANTS_TTL, () => db().select().from(schema.roleAssignment).where(and(eq(schema.roleAssignment.personId, personId), notEnded(today))));
  return rows.filter(inForce);
}

/**
 * The grants in force today. Unknown roles and broken scopes grant nothing.
 * A unit grant is widened here, once, to the unit and everything below it (FR-PLT-16), so every
 * later check can ask about one unit without walking the tree again. Pass an executor to read
 * inside a transaction; without one the rows and the tree come from the shared cache.
 */
export async function loadGrants(personId: string, today: IsoDate = todayInVietnam(), executor?: Executor): Promise<Grant[]> {
  const rows = await grantRowsOf(personId, today, executor);
  const unitIds = rows.flatMap((row) => (row.scopeType === "unit" && row.scopeId ? [row.scopeId] : []));
  const covers = new Map<string, string[]>();
  if (unitIds.length) {
    const units = executor ? await executor.select({ id: schema.orgUnit.id, path: schema.orgUnit.path }).from(schema.orgUnit).where(arrayOverlaps(schema.orgUnit.path, unitIds)) : await listOrgUnits();
    for (const granted of unitIds) covers.set(granted, units.flatMap((unit) => (unit.path.includes(granted) ? [unit.id] : [])));
  }
  return rows.flatMap((row) => {
    const scope = toScope(row.scopeType, row.scopeId, covers);
    const known = (ROLES as readonly string[]).includes(row.role);
    return scope && known ? [{ role: row.role as Role, scope }] : [];
  });
}

/**
 * `loadGrants` for many people at once, in a fixed number of queries however many they are: one
 * pass over `role_assignment` and one over the unit tree, instead of a round trip per person.
 * People with no grant are in the map with an empty list. Inside a transaction pass the executor,
 * and everything is read there.
 */
export async function loadGrantsOfPeople(personIds: readonly string[], today: IsoDate = todayInVietnam(), executor?: Executor): Promise<Map<string, Grant[]>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, Grant[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const rows = await (executor ?? db())
    .select()
    .from(schema.roleAssignment)
    .where(and(inArray(schema.roleAssignment.personId, ids), lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  const unitIds = [...new Set(rows.flatMap((row) => (row.scopeType === "unit" && row.scopeId ? [row.scopeId] : [])))];
  const covers = new Map<string, string[]>();
  if (unitIds.length) {
    const units = executor ? await executor.select({ id: schema.orgUnit.id, path: schema.orgUnit.path }).from(schema.orgUnit).where(arrayOverlaps(schema.orgUnit.path, unitIds)) : await listOrgUnits();
    for (const granted of unitIds) covers.set(granted, units.flatMap((unit) => (unit.path.includes(granted) ? [unit.id] : [])));
  }
  for (const row of rows) {
    const scope = toScope(row.scopeType, row.scopeId, covers);
    const known = (ROLES as readonly string[]).includes(row.role);
    if (scope && known) result.get(row.personId)?.push({ role: row.role as Role, scope });
  }
  return result;
}

export type RoleAssignmentView = {
  id: string;
  personId: string;
  personName: string;
  workEmail: string | null;
  role: string;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeName: string | null;
  validFrom: string;
  validTo: string | null;
  grantedByPersonId: string | null;
  grantedByName: string | null;
};

/** Every grant that is in force or still to come, for the access admin screen. */
export async function listRoleAssignments(): Promise<RoleAssignmentView[]> {
  const grantor = alias(schema.person, "grantor");
  return db()
    .select({
      id: schema.roleAssignment.id,
      personId: schema.person.id,
      personName: schema.person.fullName,
      workEmail: schema.person.workEmail,
      role: schema.roleAssignment.role,
      scopeType: schema.roleAssignment.scopeType,
      scopeId: schema.roleAssignment.scopeId,
      scopeName: sql<string | null>`coalesce(${schema.entity.shortName}, ${schema.orgUnit.name})`,
      validFrom: schema.roleAssignment.validFrom,
      validTo: schema.roleAssignment.validTo,
      grantedByPersonId: schema.roleAssignment.grantedByPersonId,
      grantedByName: grantor.fullName,
    })
    .from(schema.roleAssignment)
    .innerJoin(schema.person, eq(schema.person.id, schema.roleAssignment.personId))
    .leftJoin(grantor, eq(grantor.id, schema.roleAssignment.grantedByPersonId))
    .leftJoin(schema.entity, and(eq(schema.roleAssignment.scopeType, "entity"), eq(schema.entity.id, schema.roleAssignment.scopeId)))
    .leftJoin(schema.orgUnit, and(eq(schema.roleAssignment.scopeType, "unit"), eq(schema.orgUnit.id, schema.roleAssignment.scopeId)))
    .where(notEnded(todayInVietnam()))
    .orderBy(asc(schema.person.searchName), asc(schema.roleAssignment.role));
}

const SCOPE_TABLES = { entity: schema.entity, unit: schema.orgUnit } as const;

export type GrantInput = { personId: string; role: Role; scopeType: ScopeType; scopeId: string | null; validFrom: IsoDate; validTo: IsoDate | null };

export async function grantRole(input: GrantInput, actorPersonId: string): Promise<RoleAssignmentRow> {
  if (input.validTo && input.validTo < input.validFrom) throw new ActionError("grant_dates");
  const scopeId = input.scopeType === "group" ? null : input.scopeId;
  if (input.scopeType !== "group") {
    if (!scopeId) throw new ActionError("scope_required");
    const table = SCOPE_TABLES[input.scopeType];
    const [scope] = await db().select({ id: table.id }).from(table).where(eq(table.id, scopeId)).limit(1);
    if (!scope) throw new ActionError("scope_not_found");
  }

  const [person] = await db().select().from(schema.person).where(eq(schema.person.id, input.personId)).limit(1);
  if (!person || person.status === "offboarded") throw new ActionError("person_not_found");
  // A role is only ever used by signing in, and sign-in needs a work email.
  if (!person.workEmail) throw new ActionError("person_has_no_access");

  const [duplicate] = await db()
    .select({ id: schema.roleAssignment.id })
    .from(schema.roleAssignment)
    .where(
      and(
        eq(schema.roleAssignment.personId, input.personId),
        eq(schema.roleAssignment.role, input.role),
        eq(schema.roleAssignment.scopeType, input.scopeType),
        scopeId ? eq(schema.roleAssignment.scopeId, scopeId) : isNull(schema.roleAssignment.scopeId),
        notEnded(input.validFrom),
      ),
    )
    .limit(1);
  if (duplicate) throw new ActionError("grant_exists");

  const [created] = await db()
    .insert(schema.roleAssignment)
    .values({ personId: input.personId, role: input.role, scopeType: input.scopeType, scopeId, validFrom: input.validFrom, validTo: input.validTo, grantedByPersonId: actorPersonId })
    .returning();
  await invalidateGrants(created.personId);
  await notify({ recipients: [created.personId], kind: "security.role_granted", params: { ...(await describeGrant(created, actorPersonId)), validFrom: created.validFrom } });
  return created;
}

/** Ends a grant as of yesterday, so it stops working on the very next request. History stays. */
export async function revokeRole(id: string, actorPersonId: string): Promise<{ before: RoleAssignmentRow; after: RoleAssignmentRow }> {
  const today = todayInVietnam();
  const change = await db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.roleAssignment).where(eq(schema.roleAssignment.id, id)).limit(1).for("update");
    if (!before || (before.validTo && before.validTo < today)) throw new ActionError("grant_not_found");

    if (before.role === "owner" && before.scopeType === "group" && before.validFrom <= today) {
      // The system must never be left with nobody able to grant roles.
      const owners = await tx
        .select({ id: schema.roleAssignment.id })
        .from(schema.roleAssignment)
        .where(and(eq(schema.roleAssignment.role, "owner"), eq(schema.roleAssignment.scopeType, "group"), lte(schema.roleAssignment.validFrom, today), notEnded(today)))
        .for("update");
      if (owners.length <= 1) throw new ActionError("last_owner");
    }

    const [after] = await tx
      .update(schema.roleAssignment)
      .set({ validTo: addDays(today, -1) })
      .where(eq(schema.roleAssignment.id, id))
      .returning();
    return { before, after };
  });
  await invalidateGrants(change.after.personId);
  await notify({ recipients: [change.after.personId], kind: "security.role_revoked", params: await describeGrant(change.after, actorPersonId) });
  return change;
}

// Params for the grant/revoke notifications; role and scope type are put into words when shown.
async function describeGrant(grant: RoleAssignmentRow, actorPersonId: string) {
  const [actor] = await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, actorPersonId)).limit(1);
  let scopeName = "";
  if (grant.scopeType !== "group" && grant.scopeId) {
    const named = {
      entity: () => db().select({ name: schema.entity.shortName }).from(schema.entity).where(eq(schema.entity.id, grant.scopeId!)),
      unit: () => db().select({ name: schema.orgUnit.name }).from(schema.orgUnit).where(eq(schema.orgUnit.id, grant.scopeId!)),
    };
    scopeName = (await named[grant.scopeType]())[0]?.name ?? "";
  }
  return { actor: actor?.fullName ?? "", role: grant.role, scopeType: grant.scopeType, scopeName };
}

// ── Who holds what ──────────────────────────────────────────────────────────────────────────
//
// The questions below are asked of the whole table, not of one person: every grant not yet ended
// sits in the shared cache under one key, in a fixed order, and each caller filters it. Inside a
// transaction — or for another day than today — the rows are read where the caller reads.

type GrantRow = Pick<RoleAssignmentRow, "personId" | "role" | "scopeType" | "scopeId" | "validFrom" | "validTo">;
/** The columns the lookups need, in a fixed order: the stored array is the same whoever stored it. */
function readGrantRows(from: Executor, condition: ReturnType<typeof and>): Promise<GrantRow[]> {
  const { id, personId, role, scopeType, scopeId, validFrom, validTo } = schema.roleAssignment;
  return from.select({ personId, role, scopeType, scopeId, validFrom, validTo }).from(schema.roleAssignment).where(condition).orderBy(asc(personId), asc(id));
}

/** A transaction reads its own rows; the pool itself, or no executor at all, may be answered from the cache. */
const inTransaction = (executor: Executor | undefined): executor is Executor => !!executor && executor !== db();

async function grantRowsInForce(today: IsoDate, executor: Executor | undefined): Promise<GrantRow[]> {
  if (inTransaction(executor) || today !== todayInVietnam()) return readGrantRows(executor ?? db(), and(lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  // Cached: every grant not yet ended, so one that starts later today is still in the entry.
  const rows = await cached(ALL_GRANTS_KEY, GRANTS_TTL, () => readGrantRows(db(), notEnded(today)));
  return rows.filter((row) => row.validFrom <= today && (row.validTo === null || row.validTo >= today));
}

/**
 * The target with the whole chain above every unit it names (`org_unit.path`). A caller may name
 * one unit alone — a team's department, a hiring request's team — and the grant that answers for
 * it may sit on any unit above: the heads above a unit inherit the same rights over it
 * (FR-PLT-16). `loadGrants` gives a signed-in person's grants their subtree; the rows read here
 * are bare, so the tree is put on the target's side instead — the same question, asked once per
 * call rather than once per grant. A target that already carries its chain (a person) is unchanged.
 */
async function withUnitChain(target: Target, executor: Executor | undefined): Promise<Target> {
  const named = [...new Set(target.unitPath ?? [])];
  if (named.length === 0) return target;
  const units = inTransaction(executor)
    ? await executor.select({ path: schema.orgUnit.path }).from(schema.orgUnit).where(inArray(schema.orgUnit.id, named))
    : (await listOrgUnits()).filter((unit) => named.includes(unit.id));
  return { ...target, unitPath: [...new Set([...units.flatMap((unit) => unit.path), ...named])] };
}

const hasUnitGrant = (rows: readonly GrantRow[]) => rows.some((row) => row.scopeType === "unit");

/** Who to tell when the system itself needs attention. */
export async function listOwnerPersonIds(executor?: Executor): Promise<string[]> {
  const rows = await grantRowsInForce(todayInVietnam(), executor);
  return rows.filter((row) => row.role === "owner" && row.scopeType === "group").map((row) => row.personId);
}

/**
 * Who holds `permission` over `target` today — e.g. the HR people to warn about someone's contract.
 * Reads every grant in force: fine for a company-sized table, and it keeps `can()` the one rule.
 * A unit the target names is answered for by a grant on that unit or on any unit above it.
 */
export async function listPeopleHolding(permission: Exclude<Permission, "*">, target: Target, options: { today?: IsoDate; /** false = only roles that name the permission: routine notices skip the owners, whose "*" covers everything. */ includeWildcard?: boolean; executor?: Executor } = {}): Promise<string[]> {
  const { today = todayInVietnam(), includeWildcard = true, executor } = options;
  const rows = await grantRowsInForce(today, executor);
  const where = hasUnitGrant(rows) ? await withUnitChain(target, executor) : target;
  const grantsByPerson = new Map<string, Grant[]>();
  for (const row of rows) {
    const scope = toScope(row.scopeType, row.scopeId);
    if (!scope || !(ROLES as readonly string[]).includes(row.role)) continue;
    if (!includeWildcard && ROLE_DEFINITIONS[row.role as Role].permissions.includes("*")) continue;
    grantsByPerson.set(row.personId, [...(grantsByPerson.get(row.personId) ?? []), { role: row.role as Role, scope }]);
  }
  return [...grantsByPerson].filter(([personId, grants]) => can({ personId, workforceType: null, grants }, permission, where)).map(([personId]) => personId);
}

/**
 * Who holds `role` with a scope that covers `target` today — for approval steps that name a role
 * (FR-PLT-20). "The department head of this team" is whoever holds the role on the team's unit or
 * on any unit above it.
 */
export async function listPeopleWithRole(role: Role, target: Target, executor?: Executor): Promise<string[]> {
  const rows = (await grantRowsInForce(todayInVietnam(), executor)).filter((row) => row.role === role);
  const where = hasUnitGrant(rows) ? await withUnitChain(target, executor) : target;
  return [...new Set(rows.filter((row) => {
    const scope = toScope(row.scopeType, row.scopeId);
    return !!scope && scopeCovers(scope, where);
  }).map((row) => row.personId))];
}

/**
 * Runs inside the caller's transaction, so the caller calls `invalidateGrants` once it commits.
 * Ends every grant a person holds as of `lastDay` (someone leaving the company): grants in force
 * stop after that day, grants that would only start later never start. Returns what was changed
 * so a cancelled termination can put it back. Refuses to remove the last group owner.
 */
export async function endRoleGrantsOf(tx: Executor, personId: string, lastDay: IsoDate): Promise<{ ended: { id: string; validTo: IsoDate | null }[] }> {
  const grants = await tx.select().from(schema.roleAssignment).where(and(eq(schema.roleAssignment.personId, personId), notEnded(addDays(lastDay, 1))));
  if (grants.some((grant) => grant.role === "owner" && grant.scopeType === "group")) {
    const owners = await tx.selectDistinct({ personId: schema.roleAssignment.personId }).from(schema.roleAssignment).where(and(eq(schema.roleAssignment.role, "owner"), eq(schema.roleAssignment.scopeType, "group"), notEnded(addDays(lastDay, 1))));
    if (owners.every((owner) => owner.personId === personId)) throw new ActionError("last_owner");
  }
  for (const grant of grants) {
    // A grant that has not started yet is closed the day before it would: never in force, history kept.
    await tx.update(schema.roleAssignment).set({ validTo: grant.validFrom > lastDay ? addDays(grant.validFrom, -1) : lastDay }).where(eq(schema.roleAssignment.id, grant.id));
  }
  return { ended: grants.map((grant) => ({ id: grant.id, validTo: grant.validTo })) };
}

/** Undoes `endRoleGrantsOf` for a termination that was called off. */
export async function restoreRoleGrants(tx: Executor, ended: { id: string; validTo: IsoDate | null }[]): Promise<void> {
  for (const grant of ended) await tx.update(schema.roleAssignment).set({ validTo: grant.validTo }).where(eq(schema.roleAssignment.id, grant.id));
}
