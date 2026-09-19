import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { findPersonByEmail, type PersonRow } from "../people/service";
import type { Principal } from "../rbac/policy";
import { loadGrants } from "../rbac/service";
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
