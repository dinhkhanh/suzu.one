// Pure sign-in rules (SRS FR-PLT-02..05). No I/O, so every branch is unit-tested.

export type SignInIdentity = {
  email: string;
  emailVerified: boolean;
  // Google's verified hosted-domain claim; undefined for personal Gmail accounts.
  hostedDomain: string | undefined;
};

export type PersonAccessState = "active" | "preboarding" | "suspended" | "offboarded" | "none";

export type SignInRejection =
  | "email_not_verified"
  | "not_a_workspace_account"
  | "domain_not_allowed"
  | "not_provisioned"
  | "access_revoked";

export type SignInDecision = { allowed: true; bootstrapOwner: boolean } | { allowed: false; reason: SignInRejection };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function decideSignIn(input: {
  identity: SignInIdentity;
  allowedDomains: readonly string[];
  bootstrapOwnerEmails: readonly string[];
  personState: PersonAccessState;
}): SignInDecision {
  const { identity, allowedDomains, bootstrapOwnerEmails, personState } = input;
  const email = normalizeEmail(identity.email);

  if (!identity.emailVerified) return { allowed: false, reason: "email_not_verified" };

  // The hosted-domain claim is what proves Workspace membership. The email's own domain can be
  // a secondary or alias domain of the workspace, so both must be on the allowlist.
  const hostedDomain = identity.hostedDomain?.toLowerCase();
  if (!hostedDomain) return { allowed: false, reason: "not_a_workspace_account" };
  if (!allowedDomains.includes(hostedDomain) || !allowedDomains.includes(emailDomain(email))) {
    return { allowed: false, reason: "domain_not_allowed" };
  }

  // Belonging to an allowed domain grants nothing by itself (FR-ACL-02): the person must be provisioned.
  if (personState === "suspended" || personState === "offboarded") {
    return { allowed: false, reason: "access_revoked" };
  }
  const bootstrapOwner = bootstrapOwnerEmails.includes(email);
  if (personState === "none" && !bootstrapOwner) return { allowed: false, reason: "not_provisioned" };

  return { allowed: true, bootstrapOwner };
}
