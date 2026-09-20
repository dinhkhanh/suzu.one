// Who may write a template, and who may make a document from it. Pure.
//
// Two rules, and the second is the one that matters:
//   · Writing templates is HR's: `person:manage`, group-wide for a group template.
//   · Generating a document takes `person:manage` over the *subject* AND the template's tier over
//     that subject. The second half is not a nicety. A confirmation letter that prints a salary
//     is a compensation-tier document, and a line manager or an HR officer without the
//     compensation tier is refused it — with exactly the answer they would get if it did not
//     exist, so the refusal itself tells them nothing.
import { can, canReadTier, type Principal, type Target } from "../platform/rbac/policy";
import type { Tier } from "../platform/rbac/roles";

export type SubjectTarget = Target & { personId: string };

/** Writing and editing the template library. A group template (no entity) takes a group-wide grant. */
export const canManageTemplates = (principal: Principal, entityId?: string | null): boolean => can(principal, "person:manage", entityId ? { entityId } : {});

/** Reading the library — the same people who write it; a template body is not for general reading. */
export const canReadTemplates = (principal: Principal): boolean => can(principal, "person:manage");

/**
 * May this person make this document about that person?
 *
 * Both halves are required. `person:manage` says they keep the subject's records; `canReadTier`
 * says they may see facts of this sensitivity about them. A salary-confirmation letter therefore
 * needs the compensation tier over the subject — which, per the tier rules, line managers never
 * have — and an employment-confirmation letter needs only the personal tier.
 */
export const canGenerate = (principal: Principal, subject: SubjectTarget, tier: Tier): boolean => can(principal, "person:manage", subject) && canReadTier(principal, subject, tier);

/**
 * May this person re-open a document that was made earlier? The same test, re-run now — never
 * "they generated it once, so they may have it again". A tier taken away takes the paper with it.
 */
export const canOpenDocument = canGenerate;
