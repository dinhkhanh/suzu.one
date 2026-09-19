import "server-only";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "../notifications/service";
import { can, type Grant, type Scope, type Target } from "./policy";
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

function toScope(scopeType: ScopeType, scopeId: string | null): Scope | null {
  if (scopeType === "group") return { type: "group" };
  return scopeId ? { type: scopeType, id: scopeId } : null;
}

/** The grants in force today. Unknown roles and broken scopes grant nothing. */
export async function loadGrants(personId: string, today: IsoDate = todayInVietnam()): Promise<Grant[]> {
  const rows = await db()
    .select()
    .from(schema.roleAssignment)
    .where(and(eq(schema.roleAssignment.personId, personId), lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  return rows.flatMap((row) => {
    const scope = toScope(row.scopeType, row.scopeId);
    const known = (ROLES as readonly string[]).includes(row.role);
    return scope && known ? [{ role: row.role as Role, scope }] : [];
  });
}

export type RoleAssignmentView = {
  id: string;
  personId: string;
  personName: string;
  workEmail: string | null;
  role: string;
  scopeType: ScopeType;
  scopeName: string | null;
  validFrom: string;
  validTo: string | null;
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
      scopeName: sql<string | null>`coalesce(${schema.entity.shortName}, ${schema.department.name}, ${schema.team.name})`,
      validFrom: schema.roleAssignment.validFrom,
      validTo: schema.roleAssignment.validTo,
      grantedByName: grantor.fullName,
    })
    .from(schema.roleAssignment)
    .innerJoin(schema.person, eq(schema.person.id, schema.roleAssignment.personId))
    .leftJoin(grantor, eq(grantor.id, schema.roleAssignment.grantedByPersonId))
    .leftJoin(schema.entity, and(eq(schema.roleAssignment.scopeType, "entity"), eq(schema.entity.id, schema.roleAssignment.scopeId)))
    .leftJoin(schema.department, and(eq(schema.roleAssignment.scopeType, "department"), eq(schema.department.id, schema.roleAssignment.scopeId)))
    .leftJoin(schema.team, and(eq(schema.roleAssignment.scopeType, "team"), eq(schema.team.id, schema.roleAssignment.scopeId)))
    .where(notEnded(todayInVietnam()))
    .orderBy(asc(schema.person.searchName), asc(schema.roleAssignment.role));
}

const SCOPE_TABLES = { entity: schema.entity, department: schema.department, team: schema.team } as const;

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
      department: () => db().select({ name: schema.department.name }).from(schema.department).where(eq(schema.department.id, grant.scopeId!)),
      team: () => db().select({ name: schema.team.name }).from(schema.team).where(eq(schema.team.id, grant.scopeId!)),
    };
    scopeName = (await named[grant.scopeType]())[0]?.name ?? "";
  }
  return { actor: actor?.fullName ?? "", role: grant.role, scopeType: grant.scopeType, scopeName };
}

/** Who to tell when the system itself needs attention. */
export async function listOwnerPersonIds(): Promise<string[]> {
  const today = todayInVietnam();
  const rows = await db()
    .select({ personId: schema.roleAssignment.personId })
    .from(schema.roleAssignment)
    .where(and(eq(schema.roleAssignment.role, "owner"), eq(schema.roleAssignment.scopeType, "group"), lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  return rows.map((row) => row.personId);
}

/**
 * Who holds `permission` over `target` today — e.g. the HR people to warn about someone's contract.
 * Reads every grant in force: fine for a company-sized table, and it keeps `can()` the one rule.
 */
export async function listPeopleHolding(permission: Exclude<Permission, "*">, target: Target, options: { today?: IsoDate; /** false = only roles that name the permission: routine notices skip the owners, whose "*" covers everything. */ includeWildcard?: boolean } = {}): Promise<string[]> {
  const { today = todayInVietnam(), includeWildcard = true } = options;
  const rows = await db()
    .select()
    .from(schema.roleAssignment)
    .where(and(lte(schema.roleAssignment.validFrom, today), notEnded(today)));
  const grantsByPerson = new Map<string, Grant[]>();
  for (const row of rows) {
    const scope = toScope(row.scopeType, row.scopeId);
    if (!scope || !(ROLES as readonly string[]).includes(row.role)) continue;
    if (!includeWildcard && ROLE_DEFINITIONS[row.role as Role].permissions.includes("*")) continue;
    grantsByPerson.set(row.personId, [...(grantsByPerson.get(row.personId) ?? []), { role: row.role as Role, scope }]);
  }
  return [...grantsByPerson].filter(([personId, grants]) => can({ personId, workforceType: null, grants }, permission, target)).map(([personId]) => personId);
}
