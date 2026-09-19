import "server-only";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import { findPersonByEmail, type PersonRow } from "../people/service";
import type { Grant, Principal, Scope } from "../rbac/policy";
import { ROLES, type Role } from "../rbac/roles";
import { auth } from "./auth";

export type CurrentUser = {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  person: PersonRow;
  principal: Principal;
  request: { ipAddress: string | null; userAgent: string | null };
};

function toScope(scopeType: "group" | "entity" | "department" | "team", scopeId: string | null): Scope | null {
  if (scopeType === "group") return { type: "group" };
  return scopeId ? { type: scopeType, id: scopeId } : null;
}

async function loadGrants(personId: string): Promise<Grant[]> {
  const today = sql`current_date`;
  const rows = await db()
    .select()
    .from(schema.roleAssignment)
    .where(
      and(
        eq(schema.roleAssignment.personId, personId),
        lte(schema.roleAssignment.validFrom, today),
        or(isNull(schema.roleAssignment.validTo), gte(schema.roleAssignment.validTo, today)),
      ),
    );
  return rows.flatMap((row) => {
    const scope = toScope(row.scopeType, row.scopeId);
    const known = (ROLES as readonly string[]).includes(row.role);
    return scope && known ? [{ role: row.role as Role, scope }] : [];
  });
}

/**
 * The signed-in person with their grants, or null. Re-checks the person's status on every
 * request, so suspending or offboarding someone locks them out at once (FR-PLT-05).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const requestHeaders = await headers();
  const session = await auth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const person = await findPersonByEmail(session.user.email);
  if (!person || person.status === "suspended" || person.status === "offboarded") {
    await auth().api.revokeSessions({ headers: requestHeaders }).catch(() => undefined);
    return null;
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    person,
    principal: {
      personId: person.id,
      workforceType: person.workforceType,
      grants: await loadGrants(person.id),
    },
    request: {
      ipAddress: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: requestHeaders.get("user-agent"),
    },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  return (await getCurrentUser()) ?? redirect("/sign-in");
}
