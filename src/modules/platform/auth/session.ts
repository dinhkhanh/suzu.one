import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { findPersonByEmail, type PersonRow } from "../people/service";
import { canImpersonate, type Principal } from "../rbac/policy";
import { loadGrants } from "../rbac/service";
import { auth } from "./auth";
import { clientIpFrom } from "./client-ip";
import { impersonationTargetOf } from "./impersonation";
import { impersonatedReauthAt, isImpersonationLive } from "./impersonation-policy";
import { type Preferences, preferencesOf } from "./preferences";

const toDate = (value: unknown): Date | null => (value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null);

export type CurrentUser = {
  /** The account that signed in — always the real one, whoever the session is looking through. */
  userId: string;
  /** The session row behind this request, and when its holder last proved who they are (step-up, FR-PLT-06). */
  sessionId: string;
  reauthAt: Date | null;
  email: string;
  name: string;
  image: string | null;
  /** Whose pages these are: the signed-in person, or the one they are seeing the app as. */
  person: PersonRow;
  /** The language and theme kept on the account; `null` where this person never chose. */
  preferences: Preferences;
  principal: Principal;
  /**
   * Set while the session sees the app as `person` (FR-PLT-40): the real person behind it, and
   * their own grants — what the impersonation may not exceed. Everything done is theirs: the audit
   * log keeps their account on every entry, and `person` only names whose behalf it was on.
   */
  impersonator: { personId: string; fullName: string; principal: Principal } | null;
  request: { ipAddress: string | null; userAgent: string | null };
};

/**
 * The signed-in person with their grants, or null. Re-checks the person's status on every
 * request, so suspending or offboarding someone locks them out at once (FR-PLT-05).
 *
 * A session that is seeing the app as somebody else (FR-PLT-40) comes back as that person, with
 * that person's grants — after the right to do so is checked again here, against the real person's
 * grants of this moment and the target's status of this moment. A revoked grant, a suspended target
 * or the end of the window quietly ends it; nothing on the session row is trusted on its own.
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

  const row = session.session as { reauthAt?: unknown; impersonatePersonId?: unknown; impersonatedAt?: unknown };
  const reauthAt = toDate(row.reauthAt);
  const principal: Principal = { personId: person.id, workforceType: person.workforceType, grants: await loadGrants(person.id) };
  const borrowed = await borrowedIdentity(principal, row);

  return {
    userId: session.user.id,
    sessionId: session.session.id,
    reauthAt: borrowed ? impersonatedReauthAt(principal, borrowed.target, reauthAt) : reauthAt,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    person: borrowed?.person ?? person,
    preferences: preferencesOf(session.user),
    principal: borrowed ? { personId: borrowed.person.id, workforceType: borrowed.person.workforceType, grants: borrowed.target.grants } : principal,
    impersonator: borrowed ? { personId: person.id, fullName: person.fullName, principal } : null,
    request: {
      ipAddress: clientIpFrom(requestHeaders),
      userAgent: requestHeaders.get("user-agent"),
    },
  };
});

async function borrowedIdentity(principal: Principal, row: { impersonatePersonId?: unknown; impersonatedAt?: unknown }) {
  if (typeof row.impersonatePersonId !== "string" || !isImpersonationLive(toDate(row.impersonatedAt))) return null;
  const found = await impersonationTargetOf(row.impersonatePersonId);
  return found && canImpersonate(principal, found.target) ? found : null;
}

export async function requireUser(): Promise<CurrentUser> {
  return (await getCurrentUser()) ?? redirect("/sign-in");
}
