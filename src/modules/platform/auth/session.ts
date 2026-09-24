import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { findPersonByEmail, type PersonRow } from "../people/service";
import type { Principal } from "../rbac/policy";
import { loadGrants } from "../rbac/service";
import { auth } from "./auth";
import { clientIpFrom } from "./client-ip";
import { type Preferences, preferencesOf } from "./preferences";

const toDate = (value: unknown): Date | null => (value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null);

export type CurrentUser = {
  userId: string;
  /** The session row behind this request, and when its holder last proved who they are (step-up, FR-PLT-06). */
  sessionId: string;
  reauthAt: Date | null;
  email: string;
  name: string;
  image: string | null;
  person: PersonRow;
  /** The language and theme kept on the account; `null` where this person never chose. */
  preferences: Preferences;
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
    sessionId: session.session.id,
    reauthAt: toDate((session.session as { reauthAt?: unknown }).reauthAt),
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    person,
    preferences: preferencesOf(session.user),
    principal: {
      personId: person.id,
      workforceType: person.workforceType,
      grants: await loadGrants(person.id),
    },
    request: {
      ipAddress: clientIpFrom(requestHeaders),
      userAgent: requestHeaders.get("user-agent"),
    },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  return (await getCurrentUser()) ?? redirect("/sign-in");
}
