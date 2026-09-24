import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { toSearchKey } from "@/lib/text";
import { emailDomain, normalizeEmail, type PersonAccessState } from "../auth/sign-in-policy";

export type PersonRow = typeof schema.person.$inferSelect;

// The person row sits in the shared cache (personal tier): every request reads the signed-in
// person by email, and the pages about a person read them by id. One entry per person under each
// name, plus the directory of names; every writer of `person` in this file and elsewhere (core-hr,
// the org-unit move whose trigger rewrites `org_unit_path`) calls `invalidatePeople` with the rows
// it touched, so a suspension or a move is seen on the very next request.
const personKey = (personId: string) => `person:${personId}`;
const personByEmailKey = (email: string) => `person:email:${email}`;
const NAMES_KEY = "person:names";
/** Core HR's view of a person (`getPersonView`), dropped with the row it is built on. */
export const personViewKey = (personId: string) => `person:view:${personId}`;

/**
 * After a write to `person` (inside the transaction is fine: the stale marker holds readers off
 * the cache until the commit lands). Pass the row before and after when its email changed.
 */
export async function invalidatePeople(people: readonly Pick<PersonRow, "id" | "workEmail">[]): Promise<void> {
  const keys = people.flatMap((person) => [personKey(person.id), personViewKey(person.id), ...(person.workEmail ? [personByEmailKey(person.workEmail)] : [])]);
  await invalidate(NAMES_KEY, ...new Set(keys));
}

export async function findPersonByEmail(email: string): Promise<PersonRow | undefined> {
  const workEmail = normalizeEmail(email);
  // An unknown address is not stored (`undefined` never is): the next sign-in with it asks again.
  return cached(personByEmailKey(workEmail), TTL.personal, async () => {
    const [row] = await db().select().from(schema.person).where(eq(schema.person.workEmail, workEmail)).limit(1);
    return row;
  });
}

export function accessStateOf(person: PersonRow | undefined): PersonAccessState {
  return person?.status ?? "none";
}

/** First sign-in of an address listed in BOOTSTRAP_OWNER_EMAILS: create the person and the group-wide Owner grant. */
export async function createBootstrapOwner(input: { email: string; name: string }): Promise<PersonRow> {
  return db().transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.person)
      .values({
        fullName: input.name,
        searchName: toSearchKey(input.name),
        workEmail: normalizeEmail(input.email),
        workforceType: "employee",
        status: "active",
      })
      .returning();
    await tx.insert(schema.roleAssignment).values({ personId: created.id, role: "owner", scopeType: "group" });
    await invalidatePeople([created]);
    return created;
  });
}

export type PersonIdentity = { fullName: string; workEmail: string | null };

// A work email is a sign-in credential (FR-PLT-04), so it must sit in an allowed Workspace domain
// and belong to one person only.
async function cleanIdentity(tx: Tx, input: PersonIdentity, exceptPersonId?: string) {
  const workEmail = input.workEmail ? normalizeEmail(input.workEmail) : null;
  if (workEmail) {
    if (!env().allowedWorkspaceDomains.includes(emailDomain(workEmail))) throw new ActionError("work_email_domain");
    const [taken] = await tx
      .select({ id: schema.person.id })
      .from(schema.person)
      .where(and(eq(schema.person.workEmail, workEmail), exceptPersonId ? ne(schema.person.id, exceptPersonId) : undefined))
      .limit(1);
    if (taken) throw new ActionError("work_email_taken");
    // Reserved until its owner signs in: the first sign-in creates the person *and* the Owner grant,
    // and would skip the grant if a person with this address already existed.
    if (env().bootstrapOwnerEmails.includes(workEmail) && !exceptPersonId) throw new ActionError("work_email_reserved");
  }
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  return { fullName, searchName: toSearchKey(fullName), workEmail };
}

export async function createPerson(tx: Tx, input: PersonIdentity & { status: PersonRow["status"] }): Promise<PersonRow> {
  const identity = await cleanIdentity(tx, input);
  const [created] = await tx.insert(schema.person).values({ ...identity, status: input.status }).returning();
  await invalidatePeople([created]);
  return created;
}

export async function updatePersonIdentity(tx: Tx, personId: string, input: PersonIdentity): Promise<PersonRow> {
  const identity = await cleanIdentity(tx, input, personId);
  const [before] = await tx.select({ id: schema.person.id, workEmail: schema.person.workEmail }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  const [updated] = await tx.update(schema.person).set({ ...identity, updatedAt: new Date() }).where(eq(schema.person.id, personId)).returning();
  await invalidatePeople(before ? [before, updated] : [updated]);
  return updated;
}

// Where the person sits today. Core HR owns the effective-dated history and mirrors the row in
// force onto `person`, which is what sign-in and RBAC read. The unit is the only placement written:
// `org_unit_path`, `department_id` and `team_id` follow from it in the database.
export type PersonPlacement = Pick<PersonRow, "workforceType" | "primaryEntityId" | "orgUnitId" | "managerId">;

// Read lazily: a test that stubs the schema must still be able to import this module.
const identity = () => ({ id: schema.person.id, workEmail: schema.person.workEmail });

export async function setPersonPlacement(tx: Tx, personId: string, placement: PersonPlacement): Promise<void> {
  const rows = await tx.update(schema.person).set({ ...placement, updatedAt: new Date() }).where(eq(schema.person.id, personId)).returning(identity());
  await invalidatePeople(rows);
}

/** Pre-boarding people become active on their start date; only the daily roll-over calls this. */
export async function activatePerson(tx: Tx, personId: string): Promise<void> {
  const rows = await tx.update(schema.person).set({ status: "active", updatedAt: new Date() }).where(and(eq(schema.person.id, personId), eq(schema.person.status, "preboarding"))).returning(identity());
  await invalidatePeople(rows);
}

export async function findPersonById(personId: string): Promise<PersonRow | undefined> {
  return cached(personKey(personId), TTL.personal, async () => {
    const [row] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
    return row;
  });
}

/** Names only (public_internal), for manager pickers. One entry for the whole directory. */
export async function listPersonNames(): Promise<{ id: string; fullName: string }[]> {
  return cached(NAMES_KEY, TTL.reference, () =>
    db()
      .select({ id: schema.person.id, fullName: schema.person.fullName })
      .from(schema.person)
      .where(ne(schema.person.status, "offboarded"))
      .orderBy(asc(schema.person.searchName)),
  );
}

/** Would making `managerId` the manager of `personId` close a loop in the reporting line? */
export async function wouldCreateReportingLoop(tx: Tx, personId: string, managerId: string): Promise<boolean> {
  let cursor: string | null = managerId;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === personId) return true;
    const [row] = await tx.select({ managerId: schema.person.managerId }).from(schema.person).where(eq(schema.person.id, cursor)).limit(1);
    cursor = row?.managerId ?? null;
  }
  return false;
}

/** The person confirmed the first-sign-in guide. The first confirmation stands; returns whether this one was it. */
export async function completeWelcome(personId: string): Promise<boolean> {
  const rows = await db()
    .update(schema.person)
    .set({ welcomeCompletedAt: new Date() })
    .where(and(eq(schema.person.id, personId), isNull(schema.person.welcomeCompletedAt)))
    .returning(identity());
  await invalidatePeople(rows);
  return rows.length > 0;
}
