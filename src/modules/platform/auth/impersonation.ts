// Seeing the app as somebody else (FR-PLT-40): the adapter. The rules are in impersonation-policy.ts
// and `canImpersonate`; this file knows the session row and the person behind a target.
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { findPersonById, type PersonRow } from "../people/service";
import type { ImpersonationTarget } from "../rbac/policy";
import { loadGrants } from "../rbac/service";

/**
 * The person behind an id as a policy target, with their own grants — what `canImpersonate` asks
 * about. Null for nobody, and for anyone who could not sign in themselves: a borrowed session must
 * never show more than the real one would.
 */
export async function impersonationTargetOf(personId: string): Promise<{ person: PersonRow; target: ImpersonationTarget } | null> {
  const person = await findPersonById(personId);
  if (!person || person.status !== "active") return null;
  return { person, target: targetOf(person, await loadGrants(person.id)) };
}

export const targetOf = (person: PersonRow, grants: ImpersonationTarget["grants"]): ImpersonationTarget => ({
  personId: person.id,
  entityId: person.primaryEntityId,
  unitPath: person.orgUnitPath,
  managerId: person.managerId,
  grants,
});

export async function startImpersonation(sessionId: string, personId: string, at: Date = new Date()): Promise<void> {
  await db().update(schema.session).set({ impersonatePersonId: personId, impersonatedAt: at }).where(eq(schema.session.id, sessionId));
}

export async function stopImpersonation(sessionId: string): Promise<void> {
  await db().update(schema.session).set({ impersonatePersonId: null, impersonatedAt: null }).where(eq(schema.session.id, sessionId));
}
