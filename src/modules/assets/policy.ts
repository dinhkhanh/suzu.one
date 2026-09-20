// Who may see and do what in the asset register. Pure.
//
// The shape of it, and why:
//   · The **register** — every thing the group owns and who has it — is `asset:manage` over the
//     asset's entity. Deny by default (CLAUDE.md): a colleague has no business browsing the list
//     of everyone's equipment, and nothing about their own work needs it.
//   · **What one person holds** is part of that person's record, at the personal tier in substance:
//     they always see it themselves, and whoever may `person:manage` them sees it too. Without
//     that, HR could not run the offboarding step that collects a leaver's equipment, since HR
//     holds no `asset:manage` in the role catalogue as it stands.
//   · **The money** — what the thing cost and who sold it — is narrower still: `asset:manage` or
//     `report:read` over the owning entity. The person holding the laptop does not see its price,
//     and that is the line the tests are drawn along.
import { can, entityReach, type Principal, type Target } from "../platform/rbac/policy";

export type AssetTarget = { entityId: string };
export type HolderTarget = Target & { personId: string };

// No entity at all means "anywhere" — `can()` reads an *absent* target that way, while `{}` is a
// target that nothing covers. The difference is what separates a navigation check from a data one.
const over = (entityId: string | null | undefined) => (entityId ? { entityId } : undefined);

/** Without an entity: "anywhere at all" — navigation only, never data. */
export const canReadRegister = (principal: Principal, entityId?: string): boolean => can(principal, "asset:manage", over(entityId));

/** Register, edit, assign, take back, retire. The same authority that reads the register runs it. */
export const canManageAssets = (principal: Principal, entityId?: string): boolean => can(principal, "asset:manage", over(entityId));

/**
 * What the thing cost and who supplied it. Kept apart from the register itself so that the person
 * holding a camera can be shown the camera without being shown the invoice — that is the whole
 * distinction, and it is the one the tests are drawn along.
 *
 * It once also admitted `report:read`, on the reasoning that finance needs the asset base for the
 * books. Exercising the pages over HTTP showed that limb was unreachable: `canViewAsset` never
 * opens an asset to a `report:read` holder, so the rule promised an access nobody could take. A
 * predicate that cannot fire is worse than an absent one, because it reads like a decision. If
 * finance is to see the asset base, that is a decision about the *register*, not about this rule.
 */
export const canReadAssetMoney = (principal: Principal, entityId?: string): boolean => can(principal, "asset:manage", over(entityId));

/** The equipment one person holds: their own, or someone whose record you keep. */
export const canReadPersonAssets = (principal: Principal, person: HolderTarget): boolean =>
  (!!principal.personId && principal.personId === person.personId) || canReadRegister(principal, person.entityId ?? undefined) || can(principal, "person:manage", person);

/** One asset's page: the register's readers, and whoever is holding it right now. */
export const canViewAsset = (principal: Principal, asset: AssetTarget, holderPersonId: string | null): boolean =>
  canReadRegister(principal, asset.entityId) || (!!principal.personId && holderPersonId === principal.personId);

/**
 * Only the person a thing was handed to confirms they received it (FR-AST-02). Not the storekeeper
 * on their behalf — a handover nobody acknowledged is exactly what the confirmation is there to
 * catch. A team's or an office's asset has nobody to confirm, so nothing is asked of anyone.
 */
export const canConfirmHandover = (principal: Principal, holderPersonId: string | null): boolean => !!principal.personId && !!holderPersonId && holderPersonId === principal.personId;

/** The category library belongs to the group: changing it takes a group-wide grant. */
export const canManageCategories = (principal: Principal): boolean => can(principal, "asset:manage", {});

/** The list form of `canReadRegister`: whose entities' assets the principal may read. */
export function assetReach(principal: Principal): { all: true } | { all: false; entityIds: string[] } {
  return entityReach(principal, "asset:manage");
}
