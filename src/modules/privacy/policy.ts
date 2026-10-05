// Who may do what with the privacy tools (NFR-PRV-03, 04). Pure.
import { can, canReadTier, type Principal, type Target } from "@/modules/platform/rbac/policy";

type PersonTarget = Target & { personId: string };

/**
 * Exporting or answering for one's own data is the person's alone: never while seeing the app as
 * somebody else, whose data it would then be (FR-PLT-40). The compensation in the file is guarded
 * by the step-up, not here.
 */
export function canActForOwnData(user: { impersonator: unknown }): boolean {
  return !user.impersonator;
}

/** The retention list: whoever keeps people's records somewhere (`person:manage`). Rows are narrowed to their reach. */
export function canSeeRetentionList(principal: Principal): boolean {
  return can(principal, "person:manage");
}

/**
 * Anonymising a former employee: HR authority over them and the right to read their restricted
 * records — what goes includes ID scans and health checks — and never oneself.
 */
export function canAnonymise(principal: Principal, person: PersonTarget | null): boolean {
  return !!person && principal.personId !== person.personId && can(principal, "person:manage", person) && canReadTier(principal, person, "restricted");
}
